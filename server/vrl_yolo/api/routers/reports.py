from __future__ import annotations

import base64
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import Response

from vrl_yolo.api.schemas import ReportRequest
from vrl_yolo.engine.reports import (
    ClassifyPredictionRecord,
    DetectBoxRecord,
    ReportItem,
    ReportPayload,
    generate_csv,
    generate_pdf,
    generate_xlsx,
)

router = APIRouter(prefix="/reports", tags=["reports"])


def _to_payload(body: ReportRequest, *, include_images: bool) -> ReportPayload:
    """Translate the wire-shape ReportRequest into the engine's ReportPayload.

    `include_images` controls whether base64 thumbnails are decoded — CSV
    and XLSX never need them, PDF does. Decoding 20 base64 images per
    request is cheap, but skipping it when it's wasted avoids both the
    CPU cost and a load of empty BytesIO frames in the engine.
    """
    items: list[ReportItem] = []
    for raw in body.items:
        image_bytes: bytes | None = None
        if include_images and raw.image_b64:
            try:
                image_bytes = base64.b64decode(raw.image_b64, validate=True)
            except Exception:  # noqa: BLE001 — a bad sample shouldn't fail the report
                image_bytes = None

        items.append(
            ReportItem(
                filename=raw.filename,
                inference_ms=raw.inference_ms,
                boxes=tuple(
                    DetectBoxRecord(class_name=b.class_name, conf=b.conf)
                    for b in raw.boxes
                )
                if body.task == "detect"
                else None,
                counts_per_class=dict(raw.counts_per_class)
                if body.task == "detect"
                else None,
                top1=ClassifyPredictionRecord(
                    class_name=raw.top1.class_name, conf=raw.top1.conf
                )
                if body.task == "classify" and raw.top1
                else None,
                top5=tuple(
                    ClassifyPredictionRecord(class_name=p.class_name, conf=p.conf)
                    for p in raw.top5
                )
                if body.task == "classify"
                else None,
                image_bytes=image_bytes,
            )
        )

    return ReportPayload(
        task=body.task,
        model=body.model,
        items=tuple(items),
        review_threshold=body.review_threshold,
        detect_per_class=body.detect_per_class,
        classify_per_class=body.classify_per_class,
        classify_flagged_count=body.classify_flagged_count,
    )


def _filename_stem(payload: ReportPayload) -> str:
    """Sanitised filename root: vrl-yolo-{task}-{YYYYmmdd-HHMMSS}."""
    when = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    return f"vrl-yolo-{payload.task}-{when}"


@router.post("/csv")
def report_csv(body: ReportRequest) -> Response:
    if not body.items:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="empty report — at least one item required",
        )
    payload = _to_payload(body, include_images=False)
    data = generate_csv(payload)
    name = f"{_filename_stem(payload)}.csv"
    return Response(
        content=data,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )


@router.post("/xlsx")
def report_xlsx(body: ReportRequest) -> Response:
    if not body.items:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="empty report — at least one item required",
        )
    payload = _to_payload(body, include_images=False)
    data = generate_xlsx(payload)
    name = f"{_filename_stem(payload)}.xlsx"
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )


@router.post("/pdf")
def report_pdf(body: ReportRequest) -> Response:
    if not body.items:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="empty report — at least one item required",
        )
    payload = _to_payload(body, include_images=True)
    data = generate_pdf(payload)
    name = f"{_filename_stem(payload)}.pdf"
    return Response(
        content=data,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )
