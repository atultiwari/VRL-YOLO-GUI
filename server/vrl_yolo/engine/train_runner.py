"""Subprocess entry point for Ultralytics training (detect + classify).

Invoked by the parent FastAPI process as::

    python -m vrl_yolo.engine.train_runner \
        --dataset /abs/path/to/dataset-uuid \
        --model yolo26n.pt \
        --task detect \
        --project /abs/path/to/training \
        --name <job_id> \
        --epochs 50 \
        --imgsz 640 \
        --batch 8 \
        --device mps

We deliberately run training in a child process rather than a thread
because Ultralytics' DataLoader workers and PyTorch's backward pass
hold the GIL for long stretches — uvicorn's request loop would freeze.
Sub-processing also gives us a clean cancellation path: the parent
sends SIGTERM and the whole training tree dies with it.

Protocol: this script writes line-delimited JSON to **stdout** so the
parent's reader thread can deserialize as it goes. Each event payload
carries a sentinel `_VRL_EVENT: true` key so we can interleave events
with Ultralytics' own prints (which are useful as a scrolling log in
the UI) — the parent treats every other stdout line as a `log` event.

Events:

- ``start`` — first event, fired before `model.train()` returns.
  ``{"type":"start","model":"yolo26n.pt","task":"detect","epochs":50, ...}``
- ``epoch`` — per epoch. Carries whichever metrics the task exposes:
  detect → box/cls/dfl loss + mAP50/mAP50-95; classify → loss + top-1/top-5.
  ``{"type":"epoch","epoch":3,"epoch_total":50,"metrics":{...}}``
- ``complete`` — final event on success.
  ``{"type":"complete","best_pt":"/abs/path","metrics":{...}}``
- ``error`` — emitted before non-zero exit on any exception. Includes
  a `traceback` field so the parent can show the user something useful.
"""

from __future__ import annotations

import argparse
import traceback
from pathlib import Path
from typing import Any

from vrl_yolo.engine._runner_common import (
    extract_metrics,
    stdout_emitter as _emit,
)


def _resolve_data_arg(task: str, dataset_root: Path) -> str:
    """Return the `data=` argument Ultralytics expects for `task`.

    Detect: path to data.yaml (Roboflow / plain YOLO layout, validated by
    the wizard's split helper).

    Classify: path to the ImageFolder root containing `train/<class>/*`
    and (recommended) `val/<class>/*`. Ultralytics 8.x accepts the root
    directly — no data.yaml — and probes for `train/`, `val/`, `test/`.
    """
    if task == "classify":
        return str(dataset_root)
    data_yaml = dataset_root / "data.yaml"
    if not data_yaml.is_file():
        raise FileNotFoundError(f"data.yaml not found in {dataset_root}")
    return str(data_yaml)


def main() -> int:
    parser = argparse.ArgumentParser(description="VRL YOLO GUI — training runner")
    parser.add_argument("--dataset", required=True, help="dataset root containing data.yaml or ImageFolder")
    parser.add_argument("--model", required=True, help="starting checkpoint .pt path or shorthand")
    parser.add_argument(
        "--task",
        default="detect",
        choices=("detect", "classify"),
        help="Ultralytics task — drives the data= argument shape and metric keys.",
    )
    parser.add_argument("--project", required=True, help="output root for Ultralytics")
    parser.add_argument("--name", required=True, help="run name (also our job_id)")
    parser.add_argument("--epochs", type=int, default=50)
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--batch", type=int, default=8)
    parser.add_argument(
        "--device",
        default=None,
        help="`cuda`, `mps`, or `cpu`. Omit to let Ultralytics pick.",
    )
    args = parser.parse_args()

    dataset_root = Path(args.dataset)
    try:
        data_arg = _resolve_data_arg(args.task, dataset_root)
    except FileNotFoundError as exc:
        _emit("error", message=str(exc))
        return 2

    _emit(
        "start",
        dataset=str(dataset_root),
        model=args.model,
        task=args.task,
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=args.batch,
        device=args.device,
    )

    try:
        # Heavy imports stay inside main() so `--help` doesn't pay them.
        from ultralytics import YOLO
    except ImportError as exc:
        _emit(
            "error",
            message=f"ultralytics not installed: {exc}",
            traceback=traceback.format_exc(),
        )
        return 2

    try:
        yolo = YOLO(args.model)

        def on_fit_epoch_end(trainer: Any) -> None:
            # `on_fit_epoch_end` fires after BOTH the training loss step
            # and the validation pass for the epoch, so metrics are
            # populated. `on_train_epoch_end` would only have the loss.
            metrics_dict: dict = dict(getattr(trainer, "metrics", {}) or {})
            try:
                epoch_current = int(getattr(trainer, "epoch", 0)) + 1
            except Exception:  # noqa: BLE001
                epoch_current = 0
            _emit(
                "epoch",
                epoch=epoch_current,
                epoch_total=int(args.epochs),
                metrics=extract_metrics(metrics_dict, task=args.task),
            )

        yolo.add_callback("on_fit_epoch_end", on_fit_epoch_end)

        results = yolo.train(
            data=data_arg,
            epochs=int(args.epochs),
            imgsz=int(args.imgsz),
            batch=int(args.batch),
            project=str(args.project),
            name=str(args.name),
            device=args.device,
            verbose=True,
            # `exist_ok=True` is intentional: the parent JobManager
            # pre-creates `<project>/<name>/` so it can hold log + event
            # files alongside Ultralytics' output. Without this flag,
            # Ultralytics treats the existing dir as a name collision
            # and auto-suffixes to `<name>2` — which breaks the parent's
            # `best.pt` lookup. Each job gets a fresh UUID, so we're
            # not actually risking a resume-from-checkpoint here.
            exist_ok=True,
        )

        # Locate best.pt — Ultralytics writes it under <project>/<name>/weights/.
        best_pt = Path(args.project) / args.name / "weights" / "best.pt"
        final_metrics: dict[str, float | None] = {}
        try:
            final_metrics = extract_metrics(
                dict(getattr(results, "results_dict", {}) or {}),
                task=args.task,
            )
        except Exception:  # noqa: BLE001
            pass
        _emit(
            "complete",
            best_pt=str(best_pt) if best_pt.is_file() else None,
            metrics=final_metrics,
        )
        return 0
    except KeyboardInterrupt:
        _emit("cancelled", message="cancelled by parent (SIGTERM)")
        return 130
    except BaseException as exc:  # noqa: BLE001
        _emit(
            "error",
            message=str(exc),
            traceback=traceback.format_exc(),
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
