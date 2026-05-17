"""Subprocess entry point for Ultralytics training.

Invoked by the parent FastAPI process as::

    python -m vrl_yolo.engine.train_runner \
        --dataset /abs/path/to/dataset-uuid \
        --model yolo26n.pt \
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
  ``{"type":"start","model":"yolo26n.pt","epochs":50, ...}``
- ``epoch`` — per epoch. Carries the latest box/cls/dfl loss and (after
  the first validation pass) mAP50 + mAP50-95.
  ``{"type":"epoch","epoch":3,"epoch_total":50,"metrics":{...}}``
- ``complete`` — final event on success.
  ``{"type":"complete","best_pt":"/abs/path","metrics":{...}}``
- ``error`` — emitted before non-zero exit on any exception. Includes
  a `traceback` field so the parent can show the user something useful.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import traceback
from pathlib import Path
from typing import Any


def _emit(event_type: str, **fields: Any) -> None:
    """One JSON line on stdout. Sentinel key distinguishes from Ultralytics prints."""
    payload = {"_VRL_EVENT": True, "type": event_type, "ts": time.time(), **fields}
    sys.stdout.write(json.dumps(payload, default=str) + "\n")
    sys.stdout.flush()


def _safe_get(d: dict, key: str) -> float | None:
    """Coerce a metric value into a JSON-friendly float, or None."""
    v = d.get(key)
    if v is None:
        return None
    try:
        # Torch tensors → .item(); numpy scalars also work via float()
        if hasattr(v, "item"):
            v = v.item()
        return float(v)
    except (TypeError, ValueError):
        return None


# Ultralytics metric keys vary slightly by version (`metrics/mAP50(B)` in
# 8.4, `metrics/mAP_0.5` in some older variants). We probe several names.
_METRIC_KEYS = {
    "box_loss": ("train/box_loss",),
    "cls_loss": ("train/cls_loss",),
    "dfl_loss": ("train/dfl_loss",),
    "mAP50": ("metrics/mAP50(B)", "metrics/mAP_0.5"),
    "mAP50_95": ("metrics/mAP50-95(B)", "metrics/mAP_0.5:0.95"),
}


def _extract_metrics(metrics_dict: dict) -> dict[str, float | None]:
    """Map Ultralytics' metric names → our stable wire keys."""
    out: dict[str, float | None] = {}
    for our_key, candidates in _METRIC_KEYS.items():
        value: float | None = None
        for c in candidates:
            v = _safe_get(metrics_dict, c)
            if v is not None:
                value = v
                break
        out[our_key] = value
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description="VRL YOLO GUI — training runner")
    parser.add_argument("--dataset", required=True, help="dataset root containing data.yaml")
    parser.add_argument("--model", required=True, help="starting checkpoint .pt path or shorthand")
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
    data_yaml = dataset_root / "data.yaml"
    if not data_yaml.is_file():
        _emit("error", message=f"data.yaml not found in {dataset_root}")
        return 2

    _emit(
        "start",
        dataset=str(dataset_root),
        model=args.model,
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
                metrics=_extract_metrics(metrics_dict),
            )

        yolo.add_callback("on_fit_epoch_end", on_fit_epoch_end)

        results = yolo.train(
            data=str(data_yaml),
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
            final_metrics = _extract_metrics(
                dict(getattr(results, "results_dict", {}) or {})
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
