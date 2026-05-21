"""Training job manager — spawns + supervises Ultralytics training subprocesses.

P4b ships single-tenant local training. One `JobManager` lives on
`app.state.job_manager`; it tracks running + finished `TrainingJob`s
keyed by uuid hex, supervises each one's subprocess (Popen + reader
thread), and exposes a small surface for the route layer:

- ``start(dataset_root, model_name, epochs, imgsz, batch)``: spawn a
  fresh job. Returns the `TrainingJob` immediately (status=`running`);
  events arrive asynchronously as the subprocess emits them.
- ``get(job_id)``: read-only snapshot for HTTP GET and WS handshake.
- ``cancel(job_id)``: send SIGTERM to the process group; the reader
  thread observes the exit + flips status to `cancelled`.
- ``save_to_library(job_id, registry)``: copy `best.pt` into the user
  models directory + refresh the registry so /models picks it up.

The subprocess protocol lives in `engine/train_runner.py` — every JSON
line tagged `_VRL_EVENT: true` is one of our typed events; every other
stdout line is a raw log line we surface unchanged in the UI.
"""

from __future__ import annotations

import json
import os
import shutil
import signal
import subprocess
import sys
import threading
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from slugify import slugify as _slugify_lib

from vrl_yolo.engine.colab import (
    ColabConnectError,
    ColabSession,
    connect as colab_connect,
    fetch_best_pt as colab_fetch_best_pt,
    request_cancel as colab_request_cancel,
)
from vrl_yolo.engine.event_log import EventLog
from vrl_yolo.engine.hardware import detect_accelerator
from vrl_yolo.engine.history_db import HistoryDb
from vrl_yolo.engine.registry import ModelRegistry

# Path to the desktop entry script. In dev mode JobManager passes this
# explicitly to python so subprocess.Popen can invoke it with positional
# args; in frozen mode the bundled binary auto-runs main.py and this
# value isn't used.
#
# training.py lives at <repo>/server/vrl_yolo/engine/training.py, so
# parents[3] is the repo root.
_MAIN_PY = Path(__file__).resolve().parents[3] / "src-pyloid" / "main.py"

JobStatus = Literal["queued", "running", "completed", "failed", "cancelled"]
JobTask = Literal["detect", "classify"]


def _slugify_run_name(name: str) -> str:
    """Filesystem-safe slug, preserving Unicode for non-Latin names.

    Returns the empty string for input that slugifies to nothing
    (e.g. pure punctuation). Callers fall back to the legacy
    ``trained-<job_id[:8]>.pt`` naming in that case.

    `allow_unicode=True` keeps Devanagari / Han / Cyrillic / etc.
    characters intact instead of transliterating to ASCII — that's
    the F2 decision to support clinicians naming runs in their own
    script. `lowercase=False` preserves case (script-significant in
    some languages; harmless for ASCII).
    """
    return _slugify_lib(
        name.strip(),
        max_length=80,
        word_boundary=True,
        allow_unicode=True,
        lowercase=False,
    )


def _default_run_name(task: JobTask, dataset_id: str, when: datetime) -> str:
    """Auto-generated training-run name per F2 §1 decision 1.

    Format: ``<Task> · <dataset-id-stub> · YYYY-MM-DD HH:MM``.

    ``when`` is whatever the caller passes — usually
    ``datetime.now(timezone.utc)`` from ``JobManager.start()``. The
    backend formats in *local* system TZ via ``astimezone()`` so
    the placeholder matches a wall clock. UI-driven calls
    pre-compute the name client-side using the user's preferred TZ
    from settings; this fallback only fires for direct API callers
    that send an empty name.
    """
    task_label = "Detect" if task == "detect" else "Classify"
    stub = dataset_id[:8]
    local = when.astimezone()
    return f"{task_label} · {stub} · {local:%Y-%m-%d %H:%M}"

# Fields that flow through the metrics wire shape — kept as a single flat
# dataclass so the existing TrainingMetrics schema stays one Pydantic model
# rather than a discriminated union per task. None means "not applicable
# to this task" OR "not produced yet this epoch"; the frontend reads
# whichever subset matches the job's task.
_METRIC_FIELDS: tuple[str, ...] = (
    # detect-only
    "box_loss",
    "cls_loss",
    "dfl_loss",
    "mAP50",
    "mAP50_95",
    # classify-only
    "loss",
    "top1",
    "top5",
)


@dataclass
class JobMetrics:
    # detect
    box_loss: float | None = None
    cls_loss: float | None = None
    dfl_loss: float | None = None
    mAP50: float | None = None
    mAP50_95: float | None = None
    # classify
    loss: float | None = None
    top1: float | None = None
    top5: float | None = None

    def update(self, raw: dict[str, float | None]) -> None:
        for key in _METRIC_FIELDS:
            v = raw.get(key)
            if v is not None:
                setattr(self, key, v)

    def to_json(self) -> dict[str, float | None]:
        return {key: getattr(self, key) for key in _METRIC_FIELDS}


@dataclass
class TrainingJob:
    job_id: str
    dataset_root: Path
    model: str
    task: JobTask
    epochs_total: int
    imgsz: int
    batch: int
    accelerator_kind: str
    output_dir: Path
    started_at: datetime
    status: JobStatus = "queued"
    # Human-readable name + free-text description (F2). Stored as
    # plain strings (`""` means "not set" — JobManager.start() fills
    # the default before construction, so user-facing code sees a
    # non-empty name everywhere).
    name: str = ""
    description: str = ""
    epoch_current: int = 0
    finished_at: datetime | None = None
    error_message: str | None = None
    best_pt: Path | None = None
    metrics: JobMetrics = field(default_factory=JobMetrics)
    events: list[dict] = field(default_factory=list)
    _process: subprocess.Popen | None = None
    # Set for Colab-backed jobs only. Mutually exclusive with `_process`:
    # local jobs have a subprocess + None session; Colab jobs have a
    # session + None subprocess.
    _colab_session: ColabSession | None = None
    # Set by the cancel path on Colab jobs so the reader thread breaks
    # out of any backoff sleep or read loop cleanly. None for local jobs.
    _reader_stop_event: threading.Event | None = None
    # F3 — per-run sidecar writer for events.jsonl. None when running
    # outside of a JobManager (some tests build TrainingJobs by hand).
    _event_log: EventLog | None = None
    # F3 — persistent history db. None for hand-built jobs / tests.
    # Updated on every terminal event so /train/history reflects state.
    _history: HistoryDb | None = None
    _lock: threading.Lock = field(default_factory=threading.Lock)

    @property
    def is_colab(self) -> bool:
        return self._colab_session is not None

    def append_event(self, event: dict) -> None:
        """Append + react to a single stdout event from the runner."""
        with self._lock:
            self.events.append(event)
            etype = event.get("type")
            if etype == "epoch":
                self.epoch_current = int(event.get("epoch", self.epoch_current))
                self.metrics.update(event.get("metrics") or {})
            elif etype == "complete":
                best = event.get("best_pt")
                if best:
                    self.best_pt = Path(best)
                self.metrics.update(event.get("metrics") or {})
                self.status = "completed"
                self.finished_at = datetime.now(timezone.utc)
            elif etype == "error":
                self.status = "failed"
                self.error_message = str(event.get("message") or "training failed")
                self.finished_at = datetime.now(timezone.utc)
            elif etype == "cancelled":
                self.status = "cancelled"
                self.error_message = str(
                    event.get("message") or "training cancelled"
                )
                self.finished_at = datetime.now(timezone.utc)

        # F3: persist outside the lock so disk IO doesn't stall other
        # threads that need to read snapshot(). EventLog has its own
        # internal lock for write serialisation.
        if self._event_log is not None:
            self._event_log.append(event)

        # F3: on terminal events, flush snapshot to history + close/gzip
        # the sidecar so the file is ready for replay immediately.
        terminal = self.status in {"completed", "failed", "cancelled"}
        if terminal:
            if self._history is not None:
                try:
                    self._history.update_status_from_snapshot(
                        self.job_id, self.snapshot()
                    )
                except Exception:  # noqa: BLE001
                    # History updates are best-effort — never let them
                    # break the in-memory event flow.
                    pass
            if self._event_log is not None:
                # Background thread so a slow gzip doesn't block the
                # reader thread that called us.
                threading.Thread(
                    target=self._event_log.close_and_compress,
                    name=f"event-log-gzip-{self.job_id[:8]}",
                    daemon=True,
                ).start()

    def snapshot(self) -> dict:
        with self._lock:
            return {
                "job_id": self.job_id,
                "name": self.name,
                "description": self.description,
                "status": self.status,
                "dataset_id": self.dataset_root.name,
                "model": self.model,
                "task": self.task,
                "epochs_total": self.epochs_total,
                "epoch_current": self.epoch_current,
                "started_at": self.started_at.isoformat(),
                "finished_at": self.finished_at.isoformat()
                if self.finished_at
                else None,
                "accelerator_kind": self.accelerator_kind,
                "output_dir": str(self.output_dir),
                "metrics": self.metrics.to_json(),
                "error_message": self.error_message,
                "best_pt": str(self.best_pt) if self.best_pt else None,
            }

    def events_since(self, since_index: int) -> list[dict]:
        with self._lock:
            if since_index >= len(self.events):
                return []
            return list(self.events[since_index:])


class JobManager:
    """Process supervisor for in-flight training runs.

    One instance per FastAPI app (lives on `app.state.job_manager`).
    Thread-safe: subprocess reader threads append events under `job._lock`;
    HTTP handlers read snapshots under the same lock.
    """

    def __init__(
        self,
        *,
        storage_root: Path,
        history: HistoryDb | None = None,
    ) -> None:
        self._training_root = storage_root / "training"
        self._training_root.mkdir(parents=True, exist_ok=True)
        self._jobs: dict[str, TrainingJob] = {}
        self._jobs_lock = threading.Lock()
        # F3: optional persistent history. None is allowed so tests
        # that don't care about history don't have to wire one up.
        self._history = history

    @property
    def training_root(self) -> Path:
        return self._training_root

    def list_jobs(self) -> list[TrainingJob]:
        with self._jobs_lock:
            return list(self._jobs.values())

    def get(self, job_id: str) -> TrainingJob | None:
        with self._jobs_lock:
            return self._jobs.get(job_id)

    def list_active_jobs_for_dataset(self, dataset_id: str) -> list[TrainingJob]:
        """F4: jobs whose dataset_root.name matches AND status is alive.

        Used by `DELETE /api/datasets/{id}` to refuse with 409 when a
        running or queued job is still using the dataset. Completed /
        failed / cancelled jobs don't block delete — their reference
        is historical (F3 dataset_missing flag handles them).
        """
        with self._jobs_lock:
            return [
                j
                for j in self._jobs.values()
                if j.dataset_root.name == dataset_id
                and j.status in {"queued", "running"}
            ]

    def start(
        self,
        *,
        dataset_root: Path,
        model_path: str,
        task: JobTask,
        epochs: int,
        imgsz: int,
        batch: int,
        name: str = "",
        description: str = "",
    ) -> TrainingJob:
        """Spawn a training subprocess + reader thread.

        `model_path` is whatever the registry hands us — usually an
        absolute `.pt` path for bundled / user / trained models. Falling
        through to a bare name (e.g. `"yolo26n.pt"`) is also fine;
        Ultralytics auto-downloads it from the CDN.

        `task` decides the shape Ultralytics expects in `data=`:
        detect needs a `data.yaml` at the dataset root; classify points
        at the ImageFolder root with `train/<class>/*`.

        ``name`` and ``description`` (F2) are optional run metadata.
        Empty name falls back to ``_default_run_name(task, dataset_id,
        started_at)`` so every job has a human-readable label even
        when the caller didn't supply one.
        """
        if not dataset_root.is_dir():
            raise FileNotFoundError(f"dataset root not found: {dataset_root}")
        if task == "detect":
            if not (dataset_root / "data.yaml").is_file():
                raise ValueError(
                    f"dataset {dataset_root.name} has no data.yaml — split it first"
                )
        elif task == "classify":
            train_dir = dataset_root / "train"
            if not train_dir.is_dir():
                raise ValueError(
                    f"dataset {dataset_root.name} has no train/ subdir — "
                    "classify needs an ImageFolder layout (train/<class>/...)"
                )
            class_dirs = [p for p in train_dir.iterdir() if p.is_dir()]
            if not class_dirs:
                raise ValueError(
                    f"dataset {dataset_root.name} has no class subdirectories "
                    "under train/ — expected train/<class-name>/*.jpg"
                )

        job_id = uuid.uuid4().hex
        output_dir = self._training_root / job_id
        output_dir.mkdir(parents=True, exist_ok=True)

        accelerator = detect_accelerator()
        device_arg = None if accelerator.kind == "cpu" else accelerator.kind

        started_at = datetime.now(timezone.utc)
        final_name = name.strip() or _default_run_name(
            task, dataset_root.name, started_at
        )

        job = TrainingJob(
            job_id=job_id,
            dataset_root=dataset_root,
            model=Path(model_path).name,
            task=task,
            epochs_total=epochs,
            imgsz=imgsz,
            batch=batch,
            accelerator_kind=accelerator.kind,
            output_dir=output_dir,
            started_at=started_at,
            status="running",
            name=final_name,
            description=description.strip(),
        )
        # F3: open the per-run event sidecar before any event flows.
        job._event_log = EventLog.for_run(output_dir)
        # F3: hand the job a reference to the history db so terminal
        # events can flush state directly (no manager round-trip).
        job._history = self._history
        # F3: persistent history row, start-time snapshot.
        if self._history is not None:
            self._history.insert_run(
                job_id=job_id,
                name=job.name,
                description=job.description,
                task=task,
                dataset_id=dataset_root.name,
                dataset_snapshot=None,  # populated later via update_status if needed
                base_model=Path(model_path).name,
                epochs_total=epochs,
                imgsz=imgsz,
                batch=batch,
                accelerator_kind=accelerator.kind,
                device_arg=device_arg,
                started_at=started_at,
                status="running",
            )

        # CRITICAL: in a frozen PyInstaller .app, `sys.executable` is the
        # bundle's main binary and the bootloader IGNORES `-m module` —
        # it just re-runs the bundled entry script. v0.8.3 had that bug:
        # `[sys.executable, "-m", "vrl_yolo.engine.train_runner", ...]`
        # booted a second Pyloid window instead of the training runner,
        # and the parent JobManager waited forever for events that
        # never arrived.
        #
        # Instead, we invoke the SAME entry script (main.py) with the
        # training args as positional argv, and set
        # `VRL_YOLO_GUI_SUBPROCESS=train_runner` in the env (via
        # `_child_env()`). The entry script's `_maybe_dispatch_subprocess()`
        # reads that env var at boot and runs `train_runner.main()`
        # directly, skipping the Pyloid / uvicorn boot entirely.
        #
        # Dev vs frozen cmd shape:
        #   - Frozen: `[sys.executable, ...args]` — sys.executable IS
        #     the bundled binary that auto-runs main.py.
        #   - Dev: `[sys.executable, str(main_py_path), ...args]` —
        #     sys.executable is python3.11 and needs an explicit script.
        if getattr(sys, "frozen", False):
            entry_args: list[str] = []
        else:
            if not _MAIN_PY.is_file():
                raise RuntimeError(
                    f"src-pyloid/main.py not found at {_MAIN_PY}; "
                    "cannot spawn training subprocess in dev mode"
                )
            entry_args = [str(_MAIN_PY)]

        cmd = [
            sys.executable,
            *entry_args,
            "--dataset",
            str(dataset_root),
            "--model",
            str(model_path),
            "--task",
            task,
            "--project",
            str(self._training_root),
            "--name",
            job_id,
            "--epochs",
            str(epochs),
            "--imgsz",
            str(imgsz),
            "--batch",
            str(batch),
        ]
        if device_arg is not None:
            cmd += ["--device", device_arg]

        # New session/process group so `cancel()` can kill the whole tree
        # (Ultralytics spawns DataLoader workers + sometimes a tqdm thread).
        popen_kwargs: dict[str, Any] = {
            "stdout": subprocess.PIPE,
            "stderr": subprocess.STDOUT,
            "bufsize": 1,
            "text": True,
            "env": _child_env(),
        }
        if os.name == "posix":
            popen_kwargs["start_new_session"] = True
        else:
            popen_kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP  # type: ignore[attr-defined]

        try:
            process = subprocess.Popen(cmd, **popen_kwargs)
        except OSError as exc:
            job.status = "failed"
            job.error_message = f"failed to spawn trainer: {exc}"
            job.finished_at = datetime.now(timezone.utc)
            with self._jobs_lock:
                self._jobs[job_id] = job
            return job

        job._process = process

        with self._jobs_lock:
            self._jobs[job_id] = job

        reader = threading.Thread(
            target=_reader_loop,
            args=(job, process),
            name=f"train-reader-{job_id[:8]}",
            daemon=True,
        )
        reader.start()
        return job

    def start_colab_job(
        self,
        tunnel_url: str,
        *,
        name: str = "",
        description: str = "",
    ) -> TrainingJob:
        """Connect to a Colab worker, seed a TrainingJob, spawn a WS reader.

        The remote session does the actual training; we just translate
        its event stream into ``job.events`` so ``/train/run`` and the
        existing WebSocket fan-out work unchanged.

        ``name`` and ``description`` (F2) are optional run metadata.
        Empty name falls back to ``_default_run_name(task, dataset_id,
        started_at)`` — same fallback shape as the local ``start()``
        path so Colab jobs get the same human-readable defaults.

        Raises ``ColabConnectError`` (re-raised from ``colab.connect``)
        on URL / pre-flight failures so the route layer can surface a
        clean 400.
        """
        session = colab_connect(tunnel_url)
        init = session.initial_status

        # Heavy imports stay here so the module load path doesn't pay
        # for websockets unless someone actually starts a Colab job.
        from vrl_yolo.engine.colab_reader import spawn_colab_reader

        job_id = uuid.uuid4().hex
        output_dir = self._training_root / job_id
        output_dir.mkdir(parents=True, exist_ok=True)

        # No real dataset path on disk — synthesise a marker that snapshot()
        # can surface as `dataset_id` for display. The frontend treats this
        # as informational; no file IO ever touches it.
        synthetic_root = Path(f"colab/{job_id[:8]}")

        # Map remote status to our local JobStatus vocabulary.
        status_map: dict[str, JobStatus] = {
            "starting": "running",
            "running": "running",
            "done": "completed",
            "cancelled": "cancelled",
            "error": "failed",
        }
        seeded_status: JobStatus = status_map.get(init.status, "running")

        started_at = datetime.now(timezone.utc)
        final_name = name.strip() or _default_run_name(
            init.task,  # type: ignore[arg-type]
            synthetic_root.name,
            started_at,
        )

        job = TrainingJob(
            job_id=job_id,
            dataset_root=synthetic_root,
            model=init.model,
            task=init.task,  # type: ignore[arg-type]
            epochs_total=init.epochs_total,
            imgsz=init.imgsz,
            batch=init.batch,
            accelerator_kind="colab",
            output_dir=output_dir,
            started_at=started_at,
            status=seeded_status,
            epoch_current=init.epoch,
            name=final_name,
            description=description.strip(),
        )
        job._colab_session = session
        job._reader_stop_event = threading.Event()
        # F3: per-run sidecar + history-row insert. Same hooks as the
        # local-training path so /train/history shows Colab runs too.
        job._event_log = EventLog.for_run(output_dir)
        job._history = self._history
        if self._history is not None:
            self._history.insert_run(
                job_id=job_id,
                name=job.name,
                description=job.description,
                task=init.task,
                dataset_id=synthetic_root.name,
                dataset_snapshot=None,
                base_model=init.model,
                epochs_total=init.epochs_total,
                imgsz=init.imgsz,
                batch=init.batch,
                accelerator_kind="colab",
                device_arg=None,
                started_at=started_at,
                status=seeded_status,
            )

        if init.error_message and init.status == "error":
            job.error_message = init.error_message

        with self._jobs_lock:
            self._jobs[job_id] = job

        # Reader thread streams /events?token=... → job.append_event,
        # auto-reconnecting on transient drops; honours stop_event for
        # clean cancellation.
        spawn_colab_reader(job, session, stop_event=job._reader_stop_event)

        return job

    def cancel(self, job_id: str) -> bool:
        """Stop a running job. Returns True if a cancel was issued.

        Branch by job kind: local jobs get SIGTERM to the subprocess
        group; Colab jobs get a best-effort ``POST /cancel`` to the
        tunnel. Either way the runner emits a terminal event that the
        reader thread observes + writes into the job status.
        """
        job = self.get(job_id)
        if job is None:
            return False
        with job._lock:
            if job.status not in {"queued", "running"}:
                return False
            proc = job._process
            session = job._colab_session

        if session is not None:
            # Two parallel paths: tell the remote runner to stop (so it
            # emits a clean `cancelled` event over WS), AND signal the
            # local reader thread so it breaks out of any backoff sleep
            # if the tunnel is already down. Either path on its own is
            # insufficient: the remote could be unreachable, or the
            # reader could be mid-read of a stale message stream.
            stop_event = job._reader_stop_event
            if stop_event is not None:
                stop_event.set()
            colab_request_cancel(session)
            return True

        if proc is None:
            return False
        try:
            if os.name == "posix":
                os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
            else:
                proc.send_signal(signal.CTRL_BREAK_EVENT)  # type: ignore[attr-defined]
        except (ProcessLookupError, OSError):
            # Process already gone — let the reader thread handle the
            # status flip when stdout closes.
            return True
        # The reader thread observes process exit and flips status; we
        # don't override it here so the final state ("cancelled" vs
        # "completed" if the process raced past SIGTERM) is accurate.
        return True

    def update_metadata(
        self,
        job_id: str,
        *,
        name: str | None = None,
        description: str | None = None,
    ) -> TrainingJob:
        """Edit a run's name + description.

        F2 shipped this gated to ``status in {queued, running}`` because
        completed-run edits had nowhere durable to live. F3 unlocks
        completed runs by routing them through ``HistoryDb``:

        - **Live job (queued/running)**: edit the in-memory
          ``TrainingJob`` and mirror the change to the history row so
          ``/train/run``'s WS snapshot reflects it instantly.
        - **Terminal job, in-memory entry gone or status terminal**:
          edit through ``HistoryDb.update_metadata`` only. The
          in-memory job (if still around) gets mirrored too so any
          open snapshot reader sees the new value.

        Raises KeyError when neither in-memory nor history has the id.

        Field semantics (unchanged from F2):
        - ``None`` = leave as-is.
        - Empty ``description`` = clear.
        - Empty ``name`` = reset to the auto-generated default.
        """
        job = self.get(job_id)

        # Compute the "live name" replacement value once so both paths
        # match: empty name → default-name from the job's start-time
        # context (in-memory job preferred; falls back to history row).
        def _resolved_name() -> str | None:
            if name is None:
                return None
            stripped = name.strip()
            if stripped:
                return stripped[:200]
            if job is not None:
                return _default_run_name(
                    job.task, job.dataset_root.name, job.started_at
                )
            # Job's gone from memory; let HistoryDb regenerate with
            # whatever it has stored.
            if self._history is not None:
                row = self._history.get(job_id)
                if row is not None:
                    try:
                        when = datetime.fromisoformat(row.started_at)
                    except ValueError:
                        when = datetime.now(timezone.utc)
                    return _default_run_name(
                        row.task, row.dataset_id, when  # type: ignore[arg-type]
                    )
            return ""  # fall-through; HistoryDb will coerce to "(unnamed)"

        resolved_name = _resolved_name()
        resolved_desc = (
            None
            if description is None
            else description.strip()[:2000]
        )

        # Live-job edit (status running or queued).
        if job is not None and job.status in {"queued", "running"}:
            with job._lock:
                if resolved_name is not None:
                    job.name = resolved_name
                if resolved_desc is not None:
                    job.description = resolved_desc
            if self._history is not None:
                self._history.update_metadata(
                    job_id, name=resolved_name, description=resolved_desc
                )
            return job

        # Terminal-job edit: history is the source of truth.
        if self._history is None:
            # No history wired up (older callers / tests) — surface as
            # KeyError so callers see a 404 rather than a silent no-op.
            raise KeyError(job_id)
        updated_row = self._history.update_metadata(
            job_id, name=resolved_name, description=resolved_desc
        )
        if updated_row is None and job is None:
            raise KeyError(job_id)
        # Mirror to the still-resident in-memory job so any open
        # snapshot reader (a slow client polling getTrainingJob) sees
        # the new value.
        if job is not None:
            with job._lock:
                if resolved_name is not None:
                    job.name = resolved_name
                if resolved_desc is not None:
                    job.description = resolved_desc
        return job

    def save_to_library(
        self, job_id: str, *, registry: ModelRegistry
    ) -> Path:
        """Copy a completed job's best.pt into the user models directory.

        Filename derivation (F2):
        - Slugify the current ``job.name`` (preserves Unicode,
          replaces whitespace + punctuation with `-`, caps at 80
          chars).
        - On slug collision with an existing file in the destination
          dir, suffix with ``-<job_id[:8]>`` so neither file
          overwrites the other.
        - If the name slugifies to empty (pure punctuation), fall
          back to the legacy ``trained-<job_id[:8]>.pt`` naming.

        After the copy we trigger ``registry.scan()`` so the new
        model shows up in /models with ``source: "trained"``.
        """
        job = self.get(job_id)
        if job is None:
            raise KeyError(job_id)
        if job.status != "completed":
            raise ValueError(
                f"job is {job.status!r}; can only save completed runs to the library"
            )

        # For Colab jobs, the runner's `complete` event sets job.best_pt to
        # a Colab-side filesystem path (e.g. /content/vrl-yolo-gui-runs/...);
        # that file isn't reachable from the desktop. Download it through the
        # tunnel into output_dir/weights/ before the local copy below can run.
        if job._colab_session is not None:
            local_best = job.output_dir / "weights" / "best.pt"
            if not local_best.is_file():
                colab_fetch_best_pt(job._colab_session, local_best)
            job.best_pt = local_best

        if not job.best_pt or not job.best_pt.is_file():
            raise FileNotFoundError(
                "best.pt missing — was the training cancelled before the first save?"
            )
        # `registry._user_dir` is the canonical destination root; it's
        # subdivided by task so trained detect checkpoints land in
        # models/detect/ and trained classify checkpoints in
        # models/classify/ — matching how the registry discovers them.
        dest_dir = registry._user_dir / job.task  # type: ignore[attr-defined]
        dest_dir.mkdir(parents=True, exist_ok=True)

        slug = _slugify_run_name(job.name)
        if not slug:
            # Defensive: every job gets a default name in start(), so
            # this branch only fires if a caller patched name to a
            # punctuation-only string. Keeps the legacy filename so
            # /models still has *something* to render.
            run_label = f"trained-{job_id[:8]}.pt"
        else:
            run_label = f"{slug}.pt"
        dest = dest_dir / run_label
        if dest.exists():
            # Two completed runs picked the same slug (typical: both
            # accepted the auto-generated default and were started in
            # the same minute). Disambiguate so neither overwrites.
            stem = Path(run_label).stem
            run_label = f"{stem}-{job_id[:8]}.pt"
            dest = dest_dir / run_label
        shutil.copy2(job.best_pt, dest)
        registry.scan()
        # F3: remember which library checkpoint this run produced so
        # /train/history can show "✓ in library" + link to /models.
        if self._history is not None:
            try:
                self._history.set_library_path(job_id, dest)
            except Exception:  # noqa: BLE001
                pass
        return dest


def _child_env() -> dict[str, str]:
    """Subprocess env — force line-buffered stdout so events stream live.

    Also marks this child as a training-runner subprocess so the bundled
    `.app` binary's entry script dispatches to `train_runner.main()`
    instead of booting Pyloid. See `src-pyloid/main.py::_maybe_dispatch_subprocess`
    for the receiving side.
    """
    env = dict(os.environ)
    env["PYTHONUNBUFFERED"] = "1"
    # Suppress Ultralytics' first-run sentry telemetry prompt in CI / desktop
    # — it occasionally blocks waiting on stdin.
    env.setdefault("YOLO_OFFLINE", "true")
    env["VRL_YOLO_GUI_SUBPROCESS"] = "train_runner"
    return env


def _reader_loop(job: TrainingJob, process: subprocess.Popen) -> None:
    """Background thread: read child stdout, classify each line as event/log.

    The child marks structured events with `_VRL_EVENT: true`; everything
    else is treated as a free-form log line. Both end up in
    `job.events` so the WebSocket layer can replay the full history
    on reconnect.
    """
    assert process.stdout is not None
    for raw in iter(process.stdout.readline, ""):
        line = raw.rstrip("\n")
        if not line:
            continue
        event = _classify_line(line)
        job.append_event(event)
    # Subprocess exited — wait so returncode is set, then finalise the
    # status if the runner never sent a terminal event (e.g. SIGKILL).
    process.wait()
    with job._lock:
        if job.status == "running":
            if process.returncode == 0:
                job.status = "completed"
            elif process.returncode in (-signal.SIGTERM, 130, 143):
                job.status = "cancelled"
                if not job.error_message:
                    job.error_message = "cancelled (subprocess terminated)"
            else:
                job.status = "failed"
                if not job.error_message:
                    job.error_message = (
                        f"subprocess exited with code {process.returncode} "
                        "without an error event — check log lines above"
                    )
            job.finished_at = datetime.now(timezone.utc)


def _classify_line(line: str) -> dict:
    """Parse `line` as a JSON event if possible; otherwise wrap as a log entry."""
    if line.startswith("{") and line.endswith("}"):
        try:
            data = json.loads(line)
        except json.JSONDecodeError:
            data = None
        if isinstance(data, dict) and data.get("_VRL_EVENT"):
            data.pop("_VRL_EVENT", None)
            return data
    return {"type": "log", "ts": time.time(), "line": line}
