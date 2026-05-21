"""Training HTTP + WebSocket routes.

POST /api/training/start          — spawn a subprocess, return job_id.
GET  /api/training/{id}           — current job snapshot.
WS   /api/training/{id}/stream    — replay events + stream new ones.
POST /api/training/{id}/cancel    — SIGTERM the subprocess.
POST /api/training/{id}/save      — copy best.pt into the model library.

The WebSocket is the primary feedback channel; the GET endpoint is
for HTTP polling fallbacks and one-shot status checks.
"""

from __future__ import annotations

import asyncio
import json
import shutil
from datetime import timedelta
from pathlib import Path
from typing import Literal

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Query,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from fastapi.responses import StreamingResponse

from vrl_yolo.api.deps import get_history, get_job_manager, get_registry
from vrl_yolo.api.schemas import (
    ColabConnectRequest,
    ColabConnectResponse,
    ModelInfo,
    PurgeHistoryResponse,
    RerunHistoryResponse,
    StartTrainingRequest,
    StartTrainingResponse,
    TrainingHistoryDetailResponse,
    TrainingHistoryListResponse,
    TrainingHistoryRow,
    TrainingJobInfo,
    TrainingMetrics,
    TrainingStatus,
    UpdateTrainingMetadataRequest,
)
from vrl_yolo.engine.colab import ColabConnectError
from vrl_yolo.engine.event_log import EventLog
from vrl_yolo.engine.history_db import HistoryDb, HistoryRow, SortDir, SortKey
from vrl_yolo.engine.registry import ModelRegistry
from vrl_yolo.engine.training import JobManager, TrainingJob

router = APIRouter(prefix="/training", tags=["training"])


def _job_to_info(job: TrainingJob) -> TrainingJobInfo:
    snap = job.snapshot()
    return TrainingJobInfo(
        job_id=snap["job_id"],
        name=snap["name"],
        description=snap["description"],
        status=snap["status"],
        dataset_id=snap["dataset_id"],
        model=snap["model"],
        task=snap["task"],
        epochs_total=snap["epochs_total"],
        epoch_current=snap["epoch_current"],
        started_at=snap["started_at"],
        finished_at=snap["finished_at"],
        accelerator_kind=snap["accelerator_kind"],
        output_dir=snap["output_dir"],
        metrics=TrainingMetrics(**snap["metrics"]),
        error_message=snap["error_message"],
    )


def _record_to_info(record) -> ModelInfo:  # noqa: ANN001 — registry record
    # Keep this in sync with `routers/models.py::_record_to_info` — they
    # produce the same shape. The F2 manual-verification pass surfaced
    # a regression where F1 added `path` to ModelInfo but only updated
    # the copy in models.py; this one silently 500'd the save-to-library
    # route until covered by `test_save_to_library_route_returns_valid_model_info`.
    return ModelInfo(
        name=record.name,
        task=record.task,
        source=record.source,
        num_classes=record.num_classes,
        classes=record.classes,
        params=record.params,
        size_mb=round(record.size_mb, 2),
        path=str(record.path),
    )


def _history_row_to_schema(row: HistoryRow) -> TrainingHistoryRow:
    return TrainingHistoryRow(
        id=row.id,
        name=row.name,
        description=row.description,
        task=row.task,  # type: ignore[arg-type]
        dataset_id=row.dataset_id,
        dataset_missing=row.dataset_missing,
        base_model=row.base_model,
        epochs_total=row.epochs_total,
        epoch_current=row.epoch_current,
        imgsz=row.imgsz,
        batch=row.batch,
        accelerator_kind=row.accelerator_kind,  # type: ignore[arg-type]
        device_arg=row.device_arg,
        started_at=row.started_at,
        finished_at=row.finished_at,
        duration_s=row.duration_s,
        status=row.status,  # type: ignore[arg-type]
        error_message=row.error_message,
        best_pt_path=row.best_pt_path,
        library_path=row.library_path,
        final_metrics=TrainingMetrics(**row.final_metrics),
        dataset_snapshot=row.dataset_snapshot,
    )


def _history_row_to_job_info(row: HistoryRow) -> TrainingJobInfo:
    """Re-shape a HistoryRow as a TrainingJobInfo for the PATCH response.

    The PATCH route returns TrainingJobInfo for both live and terminal
    paths; when the live job is gone we build the same shape from the
    history record so callers don't see a schema change.
    """
    return TrainingJobInfo(
        job_id=row.id,
        name=row.name,
        description=row.description,
        status=row.status,  # type: ignore[arg-type]
        dataset_id=row.dataset_id,
        model=row.base_model,
        task=row.task,  # type: ignore[arg-type]
        epochs_total=row.epochs_total,
        epoch_current=row.epoch_current,
        started_at=row.started_at,
        finished_at=row.finished_at,
        accelerator_kind=row.accelerator_kind,  # type: ignore[arg-type]
        output_dir="",  # not surfaced for terminal rows
        metrics=TrainingMetrics(**row.final_metrics),
        error_message=row.error_message,
    )


@router.post(
    "/start",
    response_model=StartTrainingResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
def start_training(
    body: StartTrainingRequest,
    manager: JobManager = Depends(get_job_manager),
    registry: ModelRegistry = Depends(get_registry),
) -> StartTrainingResponse:
    """Spawn a training subprocess + return its job_id.

    The dataset must already exist on disk under
    `<storage_root>/datasets/<dataset_id>` (upload via the wizard). The
    model can be any name the registry knows about — bundled, imported,
    or trained-locally.
    """
    try:
        model_record = registry.get(body.model)
    except KeyError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"model {body.model!r} not found in registry",
        ) from exc

    dataset_root = (
        manager.training_root.parent / "datasets" / body.dataset_id
    )
    if not dataset_root.is_dir():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"dataset {body.dataset_id!r} not found on disk",
        )

    try:
        job = manager.start(
            dataset_root=dataset_root,
            model_path=str(model_record.path),
            task=model_record.task,
            epochs=body.epochs,
            imgsz=body.imgsz,
            batch=body.batch,
            name=body.name,
            description=body.description,
        )
    except (ValueError, FileNotFoundError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc

    return StartTrainingResponse(job_id=job.job_id)


@router.post(
    "/colab/connect",
    response_model=ColabConnectResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
def connect_colab_session(
    body: ColabConnectRequest,
    manager: JobManager = Depends(get_job_manager),
) -> ColabConnectResponse:
    """Validate a Colab tunnel URL + register a job that streams from it.

    The pre-flight ``GET /status`` happens inside ``manager.start_colab_job``
    (via ``engine/colab.py::connect``); on success the job's event
    stream is wired through the WS reader and ``/api/training/{id}/stream``
    works unchanged.
    """
    try:
        job = manager.start_colab_job(
            body.tunnel_url, name=body.name, description=body.description
        )
    except ColabConnectError as exc:
        # ColabConnectError already carries clinician-readable text.
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc
    return ColabConnectResponse(job_id=job.job_id)


# ---- F3: training history (declared BEFORE /{job_id} so the
# /history* literals beat the path-parameter match — FastAPI matches
# in registration order on the same router).


@router.get("/history", response_model=TrainingHistoryListResponse)
def list_training_history(
    task: Literal["detect", "classify"] | None = Query(None),
    status_filter: TrainingStatus | None = Query(None, alias="status"),
    dataset_id: str | None = Query(None),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    sort_by: SortKey = Query("started_at"),
    sort_dir: SortDir = Query("desc"),
    history: HistoryDb = Depends(get_history),
) -> TrainingHistoryListResponse:
    """List training history rows. Paginated; filterable by task/status/dataset."""
    rows, total = history.list(
        task=task,
        dataset_id=dataset_id,
        status=status_filter,
        limit=limit,
        offset=offset,
        sort_by=sort_by,
        sort_dir=sort_dir,
    )
    return TrainingHistoryListResponse(
        rows=[_history_row_to_schema(r) for r in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post("/history/purge", response_model=PurgeHistoryResponse)
def purge_training_history(
    older_than_days: int = Query(..., ge=1, le=3650),
    manager: JobManager = Depends(get_job_manager),
    history: HistoryDb = Depends(get_history),
) -> PurgeHistoryResponse:
    """Delete rows + sidecars whose started_at is older than the cutoff.

    Library checkpoints under models/<task>/ are NOT touched — they're
    separate user artifacts cleaned up via the F1 delete affordance on
    /models. Per-run output directories (`training/<id>/`) get removed
    along with the sidecar so disk usage actually drops.
    """
    deleted_ids = history.purge_older_than(timedelta(days=older_than_days))
    for jid in deleted_ids:
        run_dir = manager.training_root / jid
        if run_dir.is_dir():
            shutil.rmtree(run_dir, ignore_errors=True)
    return PurgeHistoryResponse(
        deleted_count=len(deleted_ids), deleted_ids=deleted_ids
    )


@router.get("/history/{job_id}", response_model=TrainingHistoryDetailResponse)
def get_training_history_row(
    job_id: str,
    history: HistoryDb = Depends(get_history),
) -> TrainingHistoryDetailResponse:
    row = history.get(job_id)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"history row {job_id!r} not found",
        )
    return TrainingHistoryDetailResponse(
        row=_history_row_to_schema(row),
        events_url=f"/api/training/history/{job_id}/events",
    )


@router.get("/history/{job_id}/events")
def stream_training_history_events(
    job_id: str,
    manager: JobManager = Depends(get_job_manager),
    history: HistoryDb = Depends(get_history),
) -> StreamingResponse:
    """Stream the run's events.jsonl(.gz) as NDJSON for chart replay.

    404 if the history row doesn't exist; empty stream if the row
    exists but the sidecar file is gone (e.g. ran out of disk).
    """
    if history.get(job_id) is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"history row {job_id!r} not found",
        )
    output_dir = manager.training_root / job_id

    def _iter():
        for event in EventLog.replay(output_dir):
            yield json.dumps(event) + "\n"

    return StreamingResponse(_iter(), media_type="application/x-ndjson")


@router.delete(
    "/history/{job_id}", status_code=status.HTTP_204_NO_CONTENT
)
def delete_training_history_row(
    job_id: str,
    delete_checkpoint: bool = Query(False),
    manager: JobManager = Depends(get_job_manager),
    history: HistoryDb = Depends(get_history),
) -> None:
    """Remove the history row + the per-run output directory.

    `delete_checkpoint=true` also removes the library checkpoint at
    `library_path` (a separate user-owned artifact under
    `models/<task>/`). Default is False — the confirmation modal on
    `/train/history` asks separately about the checkpoint.

    Also evicts any still-resident in-memory `TrainingJob` so a
    subsequent GET /api/training/{id} returns 404 cleanly.
    """
    row = history.get(job_id)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"history row {job_id!r} not found",
        )

    with manager._jobs_lock:  # noqa: SLF001 — same-package access
        manager._jobs.pop(job_id, None)

    history.delete(job_id)

    run_dir = manager.training_root / job_id
    if run_dir.is_dir():
        shutil.rmtree(run_dir, ignore_errors=True)

    if delete_checkpoint and row.library_path:
        try:
            Path(row.library_path).unlink()
        except (OSError, FileNotFoundError):
            pass


@router.post(
    "/history/{job_id}/rerun", response_model=RerunHistoryResponse
)
def rerun_training_history_row(
    job_id: str,
    history: HistoryDb = Depends(get_history),
) -> RerunHistoryResponse:
    """Return a prefill payload for the /train/configure wizard.

    Doesn't actually start a run — that requires the user to click
    through Start. For Colab rows we return the local-training shape
    (per PLAN-F3 decision 6); the user opens the Colab modal again
    from /train/configure if they want to re-run on Colab.
    """
    row = history.get(job_id)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"history row {job_id!r} not found",
        )
    return RerunHistoryResponse(
        dataset_id=row.dataset_id,
        dataset_missing=row.dataset_missing,
        model=row.base_model,
        task=row.task,  # type: ignore[arg-type]
        epochs=row.epochs_total,
        imgsz=row.imgsz,
        batch=row.batch,
        name=row.name,
        description=row.description,
    )


# ---- Per-job routes (after /history so the literals win) ---------------------


@router.get("/{job_id}", response_model=TrainingJobInfo)
def get_training_job(
    job_id: str,
    manager: JobManager = Depends(get_job_manager),
) -> TrainingJobInfo:
    job = manager.get(job_id)
    if job is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"job {job_id!r} not found",
        )
    return _job_to_info(job)


@router.patch("/{job_id}", response_model=TrainingJobInfo)
def update_training_metadata(
    job_id: str,
    body: UpdateTrainingMetadataRequest,
    manager: JobManager = Depends(get_job_manager),
    history: HistoryDb | None = Depends(get_history),
) -> TrainingJobInfo:
    """Edit a run's name + description (F2 + F3-unlocked).

    F2 shipped this gated to ``status in {queued, running}`` because
    completed-run edits had nowhere durable to live. F3 unlocked
    completed runs: the manager now routes terminal-state edits
    through the persistent history layer (`HistoryDb.update_metadata`)
    while still mirroring them to any in-memory snapshot reader.

    Returns the updated `TrainingJobInfo` whether the row lives in
    memory (`JobManager`) or only on disk (`HistoryDb`).
    """
    try:
        job = manager.update_metadata(
            job_id, name=body.name, description=body.description
        )
    except KeyError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"job {job_id!r} not found",
        ) from exc
    if job is not None:
        return _job_to_info(job)
    # Terminal-only path — fetch the row back from history. Should
    # always succeed here since update_metadata raised KeyError if
    # the row didn't exist, but be defensive.
    if history is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"job {job_id!r} not found",
        )
    row = history.get(job_id)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"job {job_id!r} not found",
        )
    return _history_row_to_job_info(row)
    return _job_to_info(job)


@router.post("/{job_id}/cancel", status_code=status.HTTP_204_NO_CONTENT)
def cancel_training_job(
    job_id: str,
    manager: JobManager = Depends(get_job_manager),
) -> None:
    job = manager.get(job_id)
    if job is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"job {job_id!r} not found",
        )
    manager.cancel(job_id)


@router.post("/{job_id}/save-to-library", response_model=ModelInfo)
def save_training_to_library(
    job_id: str,
    manager: JobManager = Depends(get_job_manager),
    registry: ModelRegistry = Depends(get_registry),
) -> ModelInfo:
    """Copy the run's best.pt into `<storage_root>/models/<task>/`.

    Destination is `models/detect/` or `models/classify/` depending on
    the job's task. Returns the newly-registered ModelInfo so the
    frontend can navigate straight to /predict with the trained model
    preselected.
    """
    try:
        dest = manager.save_to_library(job_id, registry=registry)
    except KeyError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)
        ) from exc
    except (ValueError, FileNotFoundError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc
    try:
        record = registry.get(dest.name)
    except KeyError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"copied {dest.name!r} but registry rescan didn't find it",
        ) from exc
    return _record_to_info(record)


@router.websocket("/{job_id}/stream")
async def stream_training(websocket: WebSocket, job_id: str) -> None:
    """Replay every event so far, then stream new events live.

    The runner appends events to `job.events`; this handler polls the
    list every ~300 ms. Polling (vs. a condition variable) keeps the
    code path simple — events arrive at most a couple of times per
    second per training run, so 300 ms latency is well under the
    perceptual floor for a clinical UI.
    """
    await websocket.accept()
    manager: JobManager = websocket.app.state.job_manager
    job = manager.get(job_id)
    if job is None:
        await websocket.send_json({"type": "error", "message": "job not found"})
        await websocket.close(code=1008)
        return

    # Tell the client how many events we already have so a reconnect can
    # display a coherent "X/Y events received" indicator.
    await websocket.send_json(
        {"type": "hello", "job_id": job_id, "status": job.status}
    )

    sent_count = 0
    try:
        while True:
            new_events = job.events_since(sent_count)
            for event in new_events:
                await websocket.send_json(event)
                sent_count += 1
            # Status from snapshot, not from the loop's last `event`, so
            # we stop reliably even when the terminal event got merged
            # into a batch with non-terminal events.
            current = job.snapshot()["status"]
            if current in {"completed", "failed", "cancelled"}:
                break
            await asyncio.sleep(0.3)
    except WebSocketDisconnect:
        # Client navigated away — nothing to clean up; the next reconnect
        # will replay from the start of `job.events`.
        return

    # Final terminal-status frame so clients can finalise the UI without
    # racing against the WebSocket close code.
    try:
        await websocket.send_json({"type": "closed", "status": current})
        await websocket.close()
    except Exception:  # noqa: BLE001 — close-time races aren't actionable
        pass


