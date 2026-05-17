from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status

from vrl_yolo.api.deps import get_engine
from vrl_yolo.api.schemas import DetectionResponse
from vrl_yolo.engine.inference import InferenceEngine, InferenceError

router = APIRouter(prefix="/inference", tags=["inference"])

# Server-side cap. The frontend sends 25 MB by default but a sloppy
# Roboflow export occasionally ships ~80 MB TIFFs from 40× scans.
MAX_BYTES = 200 * 1024 * 1024


@router.post("/single", response_model=DetectionResponse)
async def infer_single(
    image: UploadFile = File(...),
    model: str = Form(...),
    conf: float = Form(0.25),
    iou: float = Form(0.45),
    engine: InferenceEngine = Depends(get_engine),
) -> DetectionResponse:
    """Run a detection model on a single image.

    Classification branch lands in P2 and reuses this URL — the engine
    will dispatch by model.task, so the frontend just needs to call here
    with whatever model is selected.
    """
    raw = await image.read()
    if not raw:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="empty image upload"
        )
    if len(raw) > MAX_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"image exceeds {MAX_BYTES // (1024 * 1024)} MB cap",
        )

    try:
        result = engine.infer_single(
            image_bytes=raw,
            model_name=model,
            conf=conf,
            iou=iou,
        )
    except InferenceError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc

    # InferenceEngine.infer_single currently returns DetectionResult (P1).
    # Once P2 lands a classification path it will return a Union; until
    # then this cast keeps the response model honest.
    return DetectionResponse(**result.to_json())


@router.post("/batch")
def infer_batch() -> dict[str, object]:
    """Folder batch inference. Implemented in P3."""
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="batch inference lands in P3",
    )
