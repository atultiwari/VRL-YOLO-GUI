"""Ultralytics training driver for the Colab companion notebooks.

This is the Colab analogue of ``server/vrl_yolo/engine/train_runner.py``.
The wire-protocol layer is shared via ``_runner_common`` so the desktop
WebSocket consumer treats local and Colab events identically — same
event types, same metric keys, same payload shapes.

Where the local runner spawns a subprocess and emits JSON to stdout,
this runner stays in-process and pushes events into a ``ColabServer``
which then fans them out to subscribed WebSocket clients.

Cancellation: Ultralytics 8.x exposes ``trainer.stop = True`` via the
``on_train_epoch_end`` callback. We poll the server's cancel flag in
that callback and set ``stop`` when the user clicks Cancel in the
desktop UI, which translates to ``POST /cancel`` on the tunnel.
"""

from __future__ import annotations

import sys
import traceback
from pathlib import Path
from typing import Any, TypedDict

# When the notebook clones the repo and prepends `<repo>/server` to
# sys.path, this import resolves the shared wire-protocol module —
# see docs/PLAN-P6.md §4.3.
from vrl_yolo.engine._runner_common import extract_metrics  # noqa: E402

from .colab_server import ColabServer


class TrainConfig(TypedDict, total=False):
    """User-supplied config for a Colab training run."""

    dataset: str  # Drive path to dataset root (data.yaml dir, or ImageFolder root)
    model: str  # checkpoint shorthand (yolo26n.pt, etc.) or absolute path
    task: str  # "detect" | "classify"
    project: str  # Ultralytics output root (Colab-local; gets served via /best.pt)
    name: str  # run name (also the desktop's job_id)
    epochs: int
    imgsz: int
    batch: int
    device: str | None  # None = let Ultralytics pick (gpu vs cpu)


def _resolve_data_arg(task: str, dataset_root: Path) -> str:
    """Same shape as train_runner._resolve_data_arg — kept inline rather
    than re-exported so the local module stays self-contained."""
    if task == "classify":
        return str(dataset_root)
    data_yaml = dataset_root / "data.yaml"
    if not data_yaml.is_file():
        raise FileNotFoundError(f"data.yaml not found in {dataset_root}")
    return str(data_yaml)


def run_training(server: ColabServer, config: TrainConfig) -> int:
    """Execute the training run, emitting events through ``server``.

    Returns the exit code the local subprocess would have returned —
    not used by the notebook for control flow, but kept for parity so
    code that runs both runners has the same shape.
    """
    task = config.get("task", "detect")
    dataset_root = Path(config["dataset"]).expanduser().resolve()
    project = config["project"]
    name = config["name"]
    epochs = int(config.get("epochs", 50))

    try:
        data_arg = _resolve_data_arg(task, dataset_root)
    except FileNotFoundError as exc:
        server.publish_event("error", message=str(exc))
        return 2

    server.publish_event(
        "start",
        dataset=str(dataset_root),
        model=config["model"],
        task=task,
        epochs=epochs,
        imgsz=int(config.get("imgsz", 640)),
        batch=int(config.get("batch", 8)),
        device=config.get("device"),
    )

    try:
        from ultralytics import YOLO
    except ImportError as exc:
        server.publish_event(
            "error",
            message=f"ultralytics not installed: {exc}",
            traceback=traceback.format_exc(),
        )
        return 2

    try:
        yolo = YOLO(config["model"])

        def on_fit_epoch_end(trainer: Any) -> None:
            metrics_dict: dict = dict(getattr(trainer, "metrics", {}) or {})
            try:
                epoch_current = int(getattr(trainer, "epoch", 0)) + 1
            except Exception:  # noqa: BLE001
                epoch_current = 0
            server.publish_event(
                "epoch",
                epoch=epoch_current,
                epoch_total=epochs,
                metrics=extract_metrics(metrics_dict, task=task),
            )

        def on_train_epoch_end(trainer: Any) -> None:
            # Honor cancellation requests. Ultralytics checks `trainer.stop`
            # between epochs and raises StopTraining when it's True.
            if server.cancel_requested:
                try:
                    trainer.stop = True
                except Exception:  # noqa: BLE001 - older versions
                    pass

        yolo.add_callback("on_fit_epoch_end", on_fit_epoch_end)
        yolo.add_callback("on_train_epoch_end", on_train_epoch_end)

        results = yolo.train(
            data=data_arg,
            epochs=epochs,
            imgsz=int(config.get("imgsz", 640)),
            batch=int(config.get("batch", 8)),
            project=str(project),
            name=str(name),
            device=config.get("device"),
            verbose=True,
            exist_ok=True,
        )

        best_pt = Path(project) / name / "weights" / "best.pt"
        final_metrics: dict[str, float | None] = {}
        try:
            final_metrics = extract_metrics(
                dict(getattr(results, "results_dict", {}) or {}),
                task=task,
            )
        except Exception:  # noqa: BLE001
            pass

        if server.cancel_requested:
            server.publish_event(
                "cancelled",
                message="cancelled by desktop (POST /cancel)",
                best_pt=str(best_pt) if best_pt.is_file() else None,
            )
            return 130

        server.publish_event(
            "complete",
            best_pt=str(best_pt) if best_pt.is_file() else None,
            metrics=final_metrics,
        )
        return 0
    except KeyboardInterrupt:
        server.publish_event("cancelled", message="cancelled by KeyboardInterrupt")
        return 130
    except BaseException as exc:  # noqa: BLE001
        server.publish_event(
            "error",
            message=str(exc),
            traceback=traceback.format_exc(),
        )
        return 1


__all__ = ["TrainConfig", "run_training"]
