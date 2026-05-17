from __future__ import annotations

from fastapi import APIRouter, HTTPException, status

router = APIRouter(prefix="/training", tags=["training"])


@router.post("/start")
def start_training() -> dict[str, object]:
    """Kick off a training run. Detection lands in P4, classify in P5."""
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="training start lands in P4 (detect) / P5 (classify)",
    )
