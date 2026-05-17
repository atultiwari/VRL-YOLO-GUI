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

from vrl_yolo.engine.hardware import detect_accelerator
from vrl_yolo.engine.registry import ModelRegistry

JobStatus = Literal["queued", "running", "completed", "failed", "cancelled"]
JobTask = Literal["detect", "classify"]

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
    epoch_current: int = 0
    finished_at: datetime | None = None
    error_message: str | None = None
    best_pt: Path | None = None
    metrics: JobMetrics = field(default_factory=JobMetrics)
    events: list[dict] = field(default_factory=list)
    _process: subprocess.Popen | None = None
    _lock: threading.Lock = field(default_factory=threading.Lock)

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

    def snapshot(self) -> dict:
        with self._lock:
            return {
                "job_id": self.job_id,
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

    def __init__(self, *, storage_root: Path) -> None:
        self._training_root = storage_root / "training"
        self._training_root.mkdir(parents=True, exist_ok=True)
        self._jobs: dict[str, TrainingJob] = {}
        self._jobs_lock = threading.Lock()

    @property
    def training_root(self) -> Path:
        return self._training_root

    def list_jobs(self) -> list[TrainingJob]:
        with self._jobs_lock:
            return list(self._jobs.values())

    def get(self, job_id: str) -> TrainingJob | None:
        with self._jobs_lock:
            return self._jobs.get(job_id)

    def start(
        self,
        *,
        dataset_root: Path,
        model_path: str,
        task: JobTask,
        epochs: int,
        imgsz: int,
        batch: int,
    ) -> TrainingJob:
        """Spawn a training subprocess + reader thread.

        `model_path` is whatever the registry hands us — usually an
        absolute `.pt` path for bundled / user / trained models. Falling
        through to a bare name (e.g. `"yolo26n.pt"`) is also fine;
        Ultralytics auto-downloads it from the CDN.

        `task` decides the shape Ultralytics expects in `data=`:
        detect needs a `data.yaml` at the dataset root; classify points
        at the ImageFolder root with `train/<class>/*`.
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
            started_at=datetime.now(timezone.utc),
            status="running",
        )

        cmd = [
            sys.executable,
            "-m",
            "vrl_yolo.engine.train_runner",
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

    def cancel(self, job_id: str) -> bool:
        """Send SIGTERM to the subprocess group. Returns True if a cancel was issued."""
        job = self.get(job_id)
        if job is None:
            return False
        with job._lock:
            if job.status not in {"queued", "running"}:
                return False
            proc = job._process
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

    def save_to_library(
        self, job_id: str, *, registry: ModelRegistry
    ) -> Path:
        """Copy a completed job's best.pt into the user models directory.

        Filename: `<run-name>.pt` (which is the job_id) — keeps it
        unique. After copy we trigger `registry.scan()` so the new
        model shows up in /models with `source: "trained"`.
        """
        job = self.get(job_id)
        if job is None:
            raise KeyError(job_id)
        if job.status != "completed":
            raise ValueError(
                f"job is {job.status!r}; can only save completed runs to the library"
            )
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
        # Suffix the model name with a short job stub for traceability.
        run_label = f"trained-{job_id[:8]}.pt"
        dest = dest_dir / run_label
        shutil.copy2(job.best_pt, dest)
        registry.scan()
        return dest


def _child_env() -> dict[str, str]:
    """Subprocess env — force line-buffered stdout so events stream live."""
    env = dict(os.environ)
    env["PYTHONUNBUFFERED"] = "1"
    # Suppress Ultralytics' first-run sentry telemetry prompt in CI / desktop
    # — it occasionally blocks waiting on stdin.
    env.setdefault("YOLO_OFFLINE", "true")
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
