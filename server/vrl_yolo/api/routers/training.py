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
from pathlib import Path

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    WebSocket,
    WebSocketDisconnect,
    status,
)

from vrl_yolo.api.deps import get_job_manager, get_registry
from vrl_yolo.api.schemas import (
    ColabConnectRequest,
    ColabConnectResponse,
    ModelInfo,
    StartTrainingRequest,
    StartTrainingResponse,
    TrainingJobInfo,
    TrainingMetrics,
)
from vrl_yolo.engine.colab import ColabConnectError
from vrl_yolo.engine.registry import ModelRegistry
from vrl_yolo.engine.training import JobManager, TrainingJob

router = APIRouter(prefix="/training", tags=["training"])


def _job_to_info(job: TrainingJob) -> TrainingJobInfo:
    snap = job.snapshot()
    return TrainingJobInfo(
        job_id=snap["job_id"],
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
    return ModelInfo(
        name=record.name,
        task=record.task,
        source=record.source,
        num_classes=record.num_classes,
        classes=record.classes,
        params=record.params,
        size_mb=round(record.size_mb, 2),
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
        job = manager.start_colab_job(body.tunnel_url)
    except ColabConnectError as exc:
        # ColabConnectError already carries clinician-readable text.
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc
    return ColabConnectResponse(job_id=job.job_id)


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
