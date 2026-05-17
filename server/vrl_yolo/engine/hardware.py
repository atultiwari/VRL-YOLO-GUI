"""Accelerator detection.

Imported lazily — `torch` is in the `ml` extra and only sync'd when the user
actually runs Predict or Train. The Pyloid window can open without it.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


@dataclass(frozen=True)
class Accelerator:
    kind: Literal["cuda", "mps", "cpu"]
    name: str
    vram_gb: float | None = None


def detect_accelerator() -> Accelerator:
    """Probe `torch` for CUDA / MPS / CPU. Falls back to CPU if torch missing."""
    try:
        import torch
    except ImportError:
        return Accelerator(kind="cpu", name="CPU (torch not installed)")

    if torch.cuda.is_available():
        idx = torch.cuda.current_device()
        name = torch.cuda.get_device_name(idx)
        props = torch.cuda.get_device_properties(idx)
        return Accelerator(
            kind="cuda",
            name=name,
            vram_gb=round(props.total_memory / (1024**3), 1),
        )

    if getattr(torch.backends, "mps", None) is not None and torch.backends.mps.is_available():
        return Accelerator(kind="mps", name="Apple Silicon (MPS)")

    return Accelerator(kind="cpu", name="CPU")


def suggest_batch_size(acc: Accelerator, *, task: str = "detect", imgsz: int = 640) -> int:
    """Heuristic batch-size pick for YOLOv8/YOLO26 at the given image size.

    Numbers come from rough VRAM-vs-batch tables published in the
    Ultralytics docs + my own (Atul's) M-series Mac experiments — they're
    a starting point, not a guarantee. Users override on the configure
    page if they hit OOM.

    - CUDA: scale linearly with VRAM. 12+ GB → 16, 8 GB → 8, <6 GB → 4.
    - MPS: Apple unified memory is shared with the system, so we cap
      at 8 even on a high-mem M-series. Larger batches reliably trip
      the "MPS backend failed" assertion on long runs.
    - CPU: 2 is the sweet spot; bigger thrashes the page cache.

    For classification, double the recommendation (head only runs over
    pooled features — half the activations per sample).
    """
    if acc.kind == "cuda":
        vram = acc.vram_gb or 0
        if vram >= 12:
            base = 16
        elif vram >= 8:
            base = 8
        elif vram >= 6:
            base = 4
        else:
            base = 2
    elif acc.kind == "mps":
        base = 8 if imgsz <= 640 else 4
    else:
        base = 2

    if task == "classify":
        base *= 2

    return base

