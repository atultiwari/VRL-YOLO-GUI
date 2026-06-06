"""Explainability router — Eigen-CAM heatmaps for predictions (F6a).

`POST /api/inference/explain` mirrors `/inference/single`'s multipart
shape (re-upload the image; stateless — no "last result" coupling) and
returns a base64 RGBA heatmap the frontend overlays on the source image.
"""

from __future__ import annotations

import base64

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status

from vrl_yolo.api.deps import get_engine
from vrl_yolo.api.schemas import ExplainResponse
from vrl_yolo.engine.inference import InferenceEngine, InferenceError

router = APIRouter(prefix="/inference", tags=["inference"])

# Same server-side cap as /inference/single — a 40× scan TIFF can be large.
MAX_BYTES = 200 * 1024 * 1024


@router.post("/explain", response_model=ExplainResponse)
async def explain_inference(
    image: UploadFile = File(...),
    model: str = Form(...),
    mode: str = Form("image"),
    box_index: int | None = Form(None),
    conf: float = Form(0.25),
    iou: float = Form(0.45),
    engine: InferenceEngine = Depends(get_engine),
) -> ExplainResponse:
    """Eigen-CAM heatmap for one image.

    - `mode="image"` (default) — one image-level heatmap. For classify this
      is the only mode (Eigen-CAM is class-agnostic, so there is no
      per-class map).
    - `mode="box"` — detection-only; `box_index` selects which detection to
      explain, renormalized inside that box.
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
        result = engine.explain_single(
            image_bytes=raw,
            model_name=model,
            mode=mode,
            box_index=box_index,
            conf=conf,
            iou=iou,
        )
    except InferenceError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc

    return ExplainResponse(
        task=result.task,
        model=result.model,
        mode=result.mode,
        box_index=result.box_index,
        method=result.method,
        layer_used=result.layer_used,
        degraded=result.degraded,
        width=result.width,
        height=result.height,
        heatmap_png_b64=base64.b64encode(result.heatmap_png).decode("ascii"),
        peak=result.peak,
        mean=result.mean,
    )
