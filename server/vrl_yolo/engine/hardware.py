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
