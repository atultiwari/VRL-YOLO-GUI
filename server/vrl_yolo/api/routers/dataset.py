from __future__ import annotations

from fastapi import APIRouter, HTTPException, status

router = APIRouter(prefix="/datasets", tags=["datasets"])


@router.post("/inspect")
def inspect_dataset() -> dict[str, object]:
    """Inspect a dataset folder, detect task + format. Implemented in P4."""
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="dataset inspection lands in P4",
    )
