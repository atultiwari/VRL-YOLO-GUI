from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status

from vrl_yolo.api.deps import get_engine
from vrl_yolo.api.schemas import (
    ClassificationResponse,
    DetectionResponse,
    InferenceResponse,
)
from vrl_yolo.engine.inference import (
    ClassificationResult,
    DetectionResult,
    InferenceEngine,
    InferenceError,
)

router = APIRouter(prefix="/inference", tags=["inference"])

# Server-side cap. The frontend sends 25 MB by default but a sloppy
# Roboflow export occasionally ships ~80 MB TIFFs from 40× scans.
MAX_BYTES = 200 * 1024 * 1024


@router.post("/single", response_model=InferenceResponse)
async def infer_single(
    image: UploadFile = File(...),
    model: str = Form(...),
    conf: float = Form(0.25),
    iou: float = Form(0.45),
    engine: InferenceEngine = Depends(get_engine),
) -> DetectionResponse | ClassificationResponse:
    """Run a single image through whichever task the model declares.

    The engine dispatches on `model.task`:
    - **detect** → returns `DetectionResponse` (boxes + counts)
    - **classify** → returns `ClassificationResponse` (top-1 + top-5)

    `conf` and `iou` apply to detection NMS. For classify they're
    accepted for symmetry but the server returns the full top-5
    regardless — the frontend uses `conf` as a review-threshold for
    UI flagging.
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

    if isinstance(result, DetectionResult):
        return DetectionResponse(**result.to_json())
    if isinstance(result, ClassificationResult):
        return ClassificationResponse(**result.to_json())
    # Engine docstring promises Union[DetectionResult, ClassificationResult];
    # anything else means it grew a new task without updating this dispatch.
    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail=f"unhandled engine result type: {type(result).__name__}",
    )


@router.post("/batch")
def infer_batch() -> dict[str, object]:
    """Folder batch inference. Implemented in P3."""
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="batch inference lands in P3",
    )
