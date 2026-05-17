from __future__ import annotations

from fastapi import APIRouter, HTTPException, status

router = APIRouter(prefix="/reports", tags=["reports"])


@router.post("/pdf")
def report_pdf() -> dict[str, object]:
    """Render a PDF report. Implemented in P3."""
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="PDF reports land in P3",
    )


@router.post("/xlsx")
def report_xlsx() -> dict[str, object]:
    """Render an XLSX report. Implemented in P3."""
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="XLSX reports land in P3",
    )
