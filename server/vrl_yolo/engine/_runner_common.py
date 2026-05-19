"""Shared wire-protocol primitives for the training runners.

Both `train_runner.py` (local subprocess) and
`notebooks/_runtime/colab_runner.py` (Colab) emit the same JSON event
shape so the desktop's WebSocket consumer doesn't care where the events
originated. If Ultralytics renames a metric key between minor versions,
the fix lands here once instead of drifting silently between runners.

Wire shape — line-delimited JSON on stdout (local) or buffered for the
WebSocket fan-out (Colab):

- ``start``     — first event before `model.train()` returns.
- ``epoch``     — per-epoch metrics; payload keys are stable across tasks.
- ``complete``  — final event on success; carries best_pt path + final metrics.
- ``cancelled`` — emitted on SIGTERM / KeyboardInterrupt.
- ``error``     — non-zero exit; includes traceback for the desktop log.

Every payload carries the sentinel ``_VRL_EVENT: true`` so non-event
stdout (Ultralytics' own prints) can be passed through as ``log`` events.
"""

from __future__ import annotations

import json
import sys
import time
from typing import Any, Callable


EventEmitter = Callable[..., None]


def stdout_emitter(event_type: str, **fields: Any) -> None:
    """Default emitter: one JSON line on stdout, flushed immediately.

    Used by the local runner. The Colab runner passes its own emitter
    that pushes events into an asyncio queue for WebSocket fan-out.
    """
    payload = {"_VRL_EVENT": True, "type": event_type, "ts": time.time(), **fields}
    sys.stdout.write(json.dumps(payload, default=str) + "\n")
    sys.stdout.flush()


def safe_metric(d: dict, key: str) -> float | None:
    """Coerce a metric value into a JSON-friendly float, or None.

    Torch tensors expose `.item()`; numpy scalars cast via `float()`.
    Anything else returns None instead of crashing the runner.
    """
    v = d.get(key)
    if v is None:
        return None
    try:
        if hasattr(v, "item"):
            v = v.item()
        return float(v)
    except (TypeError, ValueError):
        return None


# Ultralytics metric keys vary between minor versions. We probe several
# names per logical key so the same wire shape survives 8.3 / 8.4 / 8.5+.
DETECT_METRIC_KEYS: dict[str, tuple[str, ...]] = {
    "box_loss": ("train/box_loss",),
    "cls_loss": ("train/cls_loss",),
    "dfl_loss": ("train/dfl_loss",),
    "mAP50": ("metrics/mAP50(B)", "metrics/mAP_0.5"),
    "mAP50_95": ("metrics/mAP50-95(B)", "metrics/mAP_0.5:0.95"),
}

# Classify head exposes a single training loss + two validation accuracies.
# Loss key was `train/loss` in 8.3 and is `train/cls_loss` in 8.4+.
CLASSIFY_METRIC_KEYS: dict[str, tuple[str, ...]] = {
    "loss": ("train/loss", "train/cls_loss"),
    "top1": ("metrics/accuracy_top1",),
    "top5": ("metrics/accuracy_top5",),
}


def extract_metrics(metrics_dict: dict, *, task: str) -> dict[str, float | None]:
    """Map Ultralytics' metric names → our stable wire keys."""
    key_map = CLASSIFY_METRIC_KEYS if task == "classify" else DETECT_METRIC_KEYS
    out: dict[str, float | None] = {}
    for our_key, candidates in key_map.items():
        value: float | None = None
        for c in candidates:
            v = safe_metric(metrics_dict, c)
            if v is not None:
                value = v
                break
        out[our_key] = value
    return out
