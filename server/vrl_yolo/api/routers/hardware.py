from __future__ import annotations

from fastapi import APIRouter, Query

from vrl_yolo.api.schemas import HardwareInfo
from vrl_yolo.engine.hardware import detect_accelerator, suggest_batch_size

router = APIRouter(prefix="/hardware", tags=["hardware"])


@router.get("", response_model=HardwareInfo)
def get_hardware(
    task: str = Query("detect", description="Task to size for (`detect` or `classify`)."),
    imgsz: int = Query(640, description="Training image size — drives the batch-size heuristic."),
) -> HardwareInfo:
    """Detect the accelerator + return a starting-point batch size.

    Driven by the configure page in /train. Result is cached upstream by
    TanStack Query — the underlying torch probe only fires once per
    process lifetime (see `InferenceEngine.accelerator`'s lazy property).
    """
    acc = detect_accelerator()
    return HardwareInfo(
        kind=acc.kind,
        name=acc.name,
        vram_gb=acc.vram_gb,
        suggested_batch_size=suggest_batch_size(acc, task=task, imgsz=imgsz),
    )
