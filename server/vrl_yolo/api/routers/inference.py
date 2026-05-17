from __future__ import annotations

from fastapi import APIRouter, HTTPException, status

router = APIRouter(prefix="/inference", tags=["inference"])


@router.post("/single")
def infer_single() -> dict[str, object]:
    """Single image inference. Detection branch lands in P1, classify in P2."""
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="single-image inference lands in P1 (detect) / P2 (classify)",
    )


@router.post("/batch")
def infer_batch() -> dict[str, object]:
    """Folder batch inference. Implemented in P3."""
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="batch inference lands in P3",
    )
