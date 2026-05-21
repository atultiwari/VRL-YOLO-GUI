"""F3 — Persistent training history.

Tests cover the HistoryDb + EventLog layers as units, then the
JobManager+HistoryDb integration, then the route layer end-to-end.
Synthetic fixtures (no subprocess spawn, no ultralytics) — the suite
runs in <1 s.

Run: ``uv run pytest tests/test_history.py -q``
"""

from __future__ import annotations

import gzip
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from vrl_yolo.api.deps import get_history, get_job_manager, get_registry
from vrl_yolo.api.routers import training as training_router
from vrl_yolo.engine.event_log import EventLog
from vrl_yolo.engine.history_db import HistoryDb
from vrl_yolo.engine.registry import ModelRegistry
from vrl_yolo.engine.training import JobManager, TrainingJob


# ---- fixtures ----------------------------------------------------------------


def _make_job(
    *,
    job_id: str,
    name: str = "Run",
    description: str = "",
    status: str = "running",
    task: str = "detect",
    dataset_id: str = "ds-aaaa1111",
    output_dir: Path | None = None,
    started_at: datetime | None = None,
    best_pt: Path | None = None,
) -> TrainingJob:
    started = started_at or datetime(2026, 5, 21, 14, 30, tzinfo=timezone.utc)
    return TrainingJob(
        job_id=job_id,
        dataset_root=Path(dataset_id),
        model="yolo26n.pt",
        task=task,  # type: ignore[arg-type]
        epochs_total=50,
        imgsz=640,
        batch=8,
        accelerator_kind="cpu",
        output_dir=output_dir or Path("/tmp/out"),
        started_at=started,
        status=status,  # type: ignore[arg-type]
        name=name,
        description=description,
        best_pt=best_pt,
    )


@pytest.fixture
def history_db(tmp_path: Path) -> HistoryDb:
    db = HistoryDb(
        db_path=tmp_path / "training.db",
        datasets_root=tmp_path / "datasets",
    )
    db.migrate()
    return db


@pytest.fixture
def manager(tmp_path: Path, history_db: HistoryDb) -> JobManager:
    return JobManager(storage_root=tmp_path, history=history_db)


@pytest.fixture
def registry(tmp_path: Path) -> ModelRegistry:
    bundled = tmp_path / "bundled"
    user = tmp_path / "models"
    bundled.mkdir(parents=True)
    user.mkdir(parents=True)
    reg = ModelRegistry(bundled_dir=bundled, user_dir=user)
    reg.scan = lambda: []  # type: ignore[assignment]
    return reg


@pytest.fixture
def client(
    manager: JobManager, registry: ModelRegistry, history_db: HistoryDb
) -> TestClient:
    app = FastAPI()
    app.include_router(training_router.router, prefix="/api")
    app.dependency_overrides[get_job_manager] = lambda: manager
    app.dependency_overrides[get_registry] = lambda: registry
    app.dependency_overrides[get_history] = lambda: history_db
    return TestClient(app)


# ---- schema + migrations -----------------------------------------------------


def test_migrate_seeds_schema_on_fresh_db(tmp_path: Path) -> None:
    db_path = tmp_path / "training.db"
    db = HistoryDb(db_path)
    db.migrate()
    with sqlite3.connect(str(db_path)) as conn:
        version = conn.execute(
            "SELECT version FROM schema_version"
        ).fetchone()[0]
        tables = {
            row[0]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )
        }
    assert version == 1
    assert "training_runs" in tables
    assert "schema_version" in tables


def test_migrate_is_idempotent(history_db: HistoryDb) -> None:
    # Calling migrate twice on an already-up-to-date schema should no-op.
    history_db.migrate()
    history_db.migrate()  # second call must not fail


# ---- HistoryDb writers -------------------------------------------------------


def _insert_default(
    db: HistoryDb,
    *,
    job_id: str = "abc123",
    task: str = "detect",
    dataset_id: str = "ds-1",
    started: datetime | None = None,
    status: str = "running",
    name: str = "test run",
) -> None:
    db.insert_run(
        job_id=job_id,
        name=name,
        description="",
        task=task,
        dataset_id=dataset_id,
        dataset_snapshot=None,
        base_model="yolo26n.pt",
        epochs_total=10,
        imgsz=640,
        batch=8,
        accelerator_kind="cpu",
        device_arg=None,
        started_at=started or datetime.now(timezone.utc),
        status=status,
    )


def test_insert_run_then_get_returns_row(history_db: HistoryDb) -> None:
    _insert_default(history_db, job_id="job-1", name="My Run")
    row = history_db.get("job-1")
    assert row is not None
    assert row.id == "job-1"
    assert row.name == "My Run"
    assert row.status == "running"


def test_update_status_from_snapshot_persists_final_state(
    history_db: HistoryDb,
) -> None:
    _insert_default(history_db, job_id="job-2")
    snapshot = {
        "status": "completed",
        "epoch_current": 50,
        "finished_at": "2026-05-21T15:00:00+00:00",
        "error_message": None,
        "best_pt": "/storage/training/job-2/weights/best.pt",
        "metrics": {"top1": 0.92, "top5": 0.99},
    }
    history_db.update_status_from_snapshot("job-2", snapshot)
    row = history_db.get("job-2")
    assert row is not None
    assert row.status == "completed"
    assert row.epoch_current == 50
    assert row.finished_at == "2026-05-21T15:00:00+00:00"
    assert row.best_pt_path == "/storage/training/job-2/weights/best.pt"
    assert row.final_metrics["top1"] == 0.92
    assert row.duration_s is not None


def test_set_library_path_updates_only_that_column(
    history_db: HistoryDb,
) -> None:
    _insert_default(history_db, job_id="job-3", name="keep this")
    history_db.set_library_path("job-3", Path("/models/detect/keep-this.pt"))
    row = history_db.get("job-3")
    assert row is not None
    assert row.library_path == "/models/detect/keep-this.pt"
    assert row.name == "keep this"  # untouched


def test_update_metadata_on_history_row(history_db: HistoryDb) -> None:
    _insert_default(history_db, job_id="job-4", name="orig")
    updated = history_db.update_metadata(
        "job-4", name="renamed", description="why"
    )
    assert updated is not None
    assert updated.name == "renamed"
    assert updated.description == "why"


def test_update_metadata_unknown_returns_none(history_db: HistoryDb) -> None:
    assert history_db.update_metadata("nope", name="x") is None


def test_delete_removes_row(history_db: HistoryDb) -> None:
    _insert_default(history_db, job_id="job-5")
    assert history_db.delete("job-5") is True
    assert history_db.get("job-5") is None
    assert history_db.delete("job-5") is False  # second delete is no-op


# ---- HistoryDb readers + filters --------------------------------------------


def test_list_paginates(history_db: HistoryDb) -> None:
    for i in range(7):
        _insert_default(
            history_db,
            job_id=f"job-{i}",
            started=datetime(2026, 5, i + 1, tzinfo=timezone.utc),
        )
    rows_page1, total = history_db.list(limit=3, offset=0)
    rows_page2, _ = history_db.list(limit=3, offset=3)
    assert total == 7
    assert len(rows_page1) == 3
    assert len(rows_page2) == 3
    # default sort = started_at DESC → newest first
    assert rows_page1[0].id == "job-6"
    assert rows_page2[0].id == "job-3"


def test_list_filter_by_task(history_db: HistoryDb) -> None:
    _insert_default(history_db, job_id="a", task="detect")
    _insert_default(history_db, job_id="b", task="classify")
    rows, total = history_db.list(task="classify")
    assert total == 1
    assert rows[0].id == "b"


def test_list_filter_by_status(history_db: HistoryDb) -> None:
    _insert_default(history_db, job_id="a", status="running")
    _insert_default(history_db, job_id="b", status="completed")
    rows, total = history_db.list(status="completed")
    assert total == 1
    assert rows[0].id == "b"


def test_list_filter_by_dataset(history_db: HistoryDb) -> None:
    _insert_default(history_db, job_id="a", dataset_id="ds-alpha")
    _insert_default(history_db, job_id="b", dataset_id="ds-beta")
    rows, total = history_db.list(dataset_id="ds-beta")
    assert total == 1
    assert rows[0].id == "b"


def test_list_sort_by_name(history_db: HistoryDb) -> None:
    _insert_default(history_db, job_id="a", name="Zebra")
    _insert_default(history_db, job_id="b", name="apple")
    rows, _ = history_db.list(sort_by="name", sort_dir="asc")
    # NOCASE collation: apple < Zebra
    assert [r.id for r in rows] == ["b", "a"]


def test_dataset_missing_flag(tmp_path: Path) -> None:
    datasets_root = tmp_path / "datasets"
    (datasets_root / "ds-exists").mkdir(parents=True)
    db = HistoryDb(tmp_path / "training.db", datasets_root=datasets_root)
    db.migrate()
    _insert_default(db, job_id="present", dataset_id="ds-exists")
    _insert_default(db, job_id="missing", dataset_id="ds-gone")
    p = db.get("present")
    m = db.get("missing")
    assert p is not None and m is not None
    assert p.dataset_missing is False
    assert m.dataset_missing is True


# ---- purge ------------------------------------------------------------------


def test_purge_older_than_deletes_old_rows(history_db: HistoryDb) -> None:
    now = datetime.now(timezone.utc)
    _insert_default(
        history_db,
        job_id="old",
        started=now - timedelta(days=45),
    )
    _insert_default(
        history_db,
        job_id="recent",
        started=now - timedelta(days=2),
    )
    deleted = history_db.purge_older_than(timedelta(days=30))
    assert deleted == ["old"]
    assert history_db.get("old") is None
    assert history_db.get("recent") is not None


# ---- EventLog ---------------------------------------------------------------


def test_event_log_append_and_replay_round_trip(tmp_path: Path) -> None:
    log = EventLog.for_run(tmp_path / "run1")
    log.append({"type": "epoch", "epoch": 1, "metrics": {"top1": 0.5}})
    log.append({"type": "complete", "best_pt": "/tmp/best.pt"})
    final = log.close_and_compress()
    assert final.name == "events.jsonl.gz"
    assert not (tmp_path / "run1" / "events.jsonl").exists()
    events = list(EventLog.replay(tmp_path / "run1"))
    assert len(events) == 2
    assert events[0]["type"] == "epoch"
    assert events[1]["best_pt"] == "/tmp/best.pt"


def test_event_log_replay_uses_uncompressed_when_present(
    tmp_path: Path,
) -> None:
    """If close_and_compress hasn't run yet, replay reads the .jsonl."""
    log = EventLog.for_run(tmp_path / "run2")
    log.append({"type": "start"})
    log.append({"type": "epoch", "epoch": 1})
    # No close_and_compress — .jsonl exists, .gz doesn't
    events = list(EventLog.replay(tmp_path / "run2"))
    assert [e["type"] for e in events] == ["start", "epoch"]


def test_event_log_replay_yields_nothing_when_dir_empty(
    tmp_path: Path,
) -> None:
    (tmp_path / "empty").mkdir()
    assert list(EventLog.replay(tmp_path / "empty")) == []


def test_event_log_close_is_idempotent(tmp_path: Path) -> None:
    log = EventLog.for_run(tmp_path / "run3")
    log.append({"type": "start"})
    first = log.close_and_compress()
    second = log.close_and_compress()  # must not fail
    assert first == second


# ---- JobManager integration -------------------------------------------------


def test_jobmanager_insert_via_inflight_hooks(
    manager: JobManager, history_db: HistoryDb, tmp_path: Path
) -> None:
    """Build a TrainingJob manually, attach to manager, simulate a
    terminal event, and verify HistoryDb reflects the final state.

    This exercises the same code path JobManager.start() takes without
    actually spawning a subprocess.
    """
    output_dir = tmp_path / "training" / "manual-job"
    output_dir.mkdir(parents=True, exist_ok=True)
    job = _make_job(
        job_id="manual-job",
        output_dir=output_dir,
    )
    # Manually insert into history + wire the hooks the same way start() does
    history_db.insert_run(
        job_id=job.job_id,
        name=job.name,
        description=job.description,
        task=job.task,
        dataset_id=job.dataset_root.name,
        dataset_snapshot=None,
        base_model=job.model,
        epochs_total=job.epochs_total,
        imgsz=job.imgsz,
        batch=job.batch,
        accelerator_kind=job.accelerator_kind,
        device_arg=None,
        started_at=job.started_at,
        status="running",
    )
    job._event_log = EventLog.for_run(output_dir)
    job._history = history_db
    manager._jobs[job.job_id] = job

    # Simulate a terminal `complete` event arriving from the runner.
    job.append_event(
        {
            "type": "complete",
            "best_pt": str(output_dir / "weights" / "best.pt"),
            "metrics": {"top1": 0.92, "top5": 0.99},
        }
    )

    row = history_db.get("manual-job")
    assert row is not None
    assert row.status == "completed"
    assert row.final_metrics["top1"] == 0.92


def test_jobmanager_save_to_library_sets_library_path(
    manager: JobManager,
    history_db: HistoryDb,
    registry: ModelRegistry,
    tmp_path: Path,
) -> None:
    output_dir = tmp_path / "training" / "save-job"
    output_dir.mkdir(parents=True, exist_ok=True)
    best = tmp_path / "best.pt"
    best.write_bytes(b"\x00" * 1024)
    job = _make_job(
        job_id="save-job",
        name="My Saved Run",
        status="completed",
        task="detect",
        output_dir=output_dir,
        best_pt=best,
    )
    history_db.insert_run(
        job_id=job.job_id,
        name=job.name,
        description="",
        task="detect",
        dataset_id="ds-saved",
        dataset_snapshot=None,
        base_model="yolo26n.pt",
        epochs_total=10,
        imgsz=640,
        batch=8,
        accelerator_kind="cpu",
        device_arg=None,
        started_at=job.started_at,
        status="completed",
    )
    manager._jobs[job.job_id] = job
    manager.save_to_library(job.job_id, registry=registry)

    row = history_db.get("save-job")
    assert row is not None
    assert row.library_path is not None
    assert "My-Saved-Run.pt" in row.library_path


# ---- F3-unlocked PATCH on terminal rows via the route ----------------------


def test_patch_route_succeeds_on_completed_row_via_history(
    manager: JobManager, history_db: HistoryDb, client: TestClient
) -> None:
    """F2 returned 409 here; F3 routes through HistoryDb and returns 200."""
    job = _make_job(job_id="patch-me", name="Before", status="completed")
    manager._jobs[job.job_id] = job
    history_db.insert_run(
        job_id="patch-me",
        name="Before",
        description="",
        task="detect",
        dataset_id="ds-1",
        dataset_snapshot=None,
        base_model="yolo26n.pt",
        epochs_total=10,
        imgsz=640,
        batch=8,
        accelerator_kind="cpu",
        device_arg=None,
        started_at=job.started_at,
        status="completed",
    )
    resp = client.patch(
        "/api/training/patch-me", json={"name": "After"}
    )
    assert resp.status_code == 200
    assert resp.json()["name"] == "After"

    # The DB row reflects the edit.
    row = history_db.get("patch-me")
    assert row is not None
    assert row.name == "After"


def test_patch_route_succeeds_on_terminal_row_when_in_memory_evicted(
    history_db: HistoryDb, client: TestClient
) -> None:
    """Even after the in-memory job is gone, history-backed edit works."""
    history_db.insert_run(
        job_id="gone-from-memory",
        name="Original",
        description="",
        task="classify",
        dataset_id="ds-x",
        dataset_snapshot=None,
        base_model="yolo26n-cls.pt",
        epochs_total=20,
        imgsz=224,
        batch=32,
        accelerator_kind="mps",
        device_arg=None,
        started_at=datetime.now(timezone.utc),
        status="completed",
    )
    resp = client.patch(
        "/api/training/gone-from-memory",
        json={"description": "added post-hoc"},
    )
    assert resp.status_code == 200
    assert resp.json()["description"] == "added post-hoc"


# ---- Route layer: history endpoints -----------------------------------------


def test_get_history_list_route(
    history_db: HistoryDb, client: TestClient
) -> None:
    _insert_default(history_db, job_id="a", name="alpha")
    _insert_default(history_db, job_id="b", name="beta", task="classify")
    resp = client.get("/api/training/history")
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 2
    assert {row["id"] for row in body["rows"]} == {"a", "b"}


def test_get_history_list_route_filters(
    history_db: HistoryDb, client: TestClient
) -> None:
    _insert_default(history_db, job_id="a", task="detect")
    _insert_default(history_db, job_id="b", task="classify")
    resp = client.get("/api/training/history?task=classify")
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 1
    assert body["rows"][0]["id"] == "b"


def test_get_history_detail_route(
    history_db: HistoryDb, client: TestClient
) -> None:
    _insert_default(history_db, job_id="d1", name="detailme")
    resp = client.get("/api/training/history/d1")
    assert resp.status_code == 200
    body = resp.json()
    assert body["row"]["id"] == "d1"
    assert body["row"]["name"] == "detailme"
    assert body["events_url"] == "/api/training/history/d1/events"


def test_get_history_detail_unknown_returns_404(client: TestClient) -> None:
    resp = client.get("/api/training/history/nope")
    assert resp.status_code == 404


def test_stream_history_events_route(
    history_db: HistoryDb,
    manager: JobManager,
    client: TestClient,
    tmp_path: Path,
) -> None:
    _insert_default(history_db, job_id="evt-1")
    output_dir = manager.training_root / "evt-1"
    log = EventLog.for_run(output_dir)
    log.append({"type": "start", "ts": 0})
    log.append({"type": "epoch", "ts": 1, "epoch": 1})
    log.close_and_compress()

    resp = client.get("/api/training/history/evt-1/events")
    assert resp.status_code == 200
    lines = [
        line for line in resp.text.splitlines() if line.strip()
    ]
    assert len(lines) == 2


def test_delete_history_route_removes_row_and_run_dir(
    history_db: HistoryDb,
    manager: JobManager,
    client: TestClient,
) -> None:
    _insert_default(history_db, job_id="del-1")
    run_dir = manager.training_root / "del-1"
    run_dir.mkdir(parents=True, exist_ok=True)
    (run_dir / "events.jsonl").write_text("{}\n")
    resp = client.delete("/api/training/history/del-1")
    assert resp.status_code == 204
    assert history_db.get("del-1") is None
    assert not run_dir.exists()


def test_delete_history_route_with_delete_checkpoint(
    history_db: HistoryDb,
    manager: JobManager,
    client: TestClient,
    tmp_path: Path,
) -> None:
    _insert_default(history_db, job_id="del-with-pt")
    checkpoint = tmp_path / "models" / "detect" / "saved.pt"
    checkpoint.parent.mkdir(parents=True, exist_ok=True)
    checkpoint.write_bytes(b"\x00")
    history_db.set_library_path("del-with-pt", checkpoint)

    resp = client.delete(
        "/api/training/history/del-with-pt?delete_checkpoint=true"
    )
    assert resp.status_code == 204
    assert not checkpoint.exists()


def test_purge_route_removes_old_rows_and_dirs(
    history_db: HistoryDb,
    manager: JobManager,
    client: TestClient,
) -> None:
    old_started = datetime.now(timezone.utc) - timedelta(days=45)
    _insert_default(history_db, job_id="purge-me", started=old_started)
    run_dir = manager.training_root / "purge-me"
    run_dir.mkdir(parents=True, exist_ok=True)
    (run_dir / "events.jsonl").write_text("{}\n")

    resp = client.post("/api/training/history/purge?older_than_days=30")
    assert resp.status_code == 200
    body = resp.json()
    assert body["deleted_count"] == 1
    assert body["deleted_ids"] == ["purge-me"]
    assert not run_dir.exists()


def test_rerun_route_returns_prefill_payload(
    history_db: HistoryDb, client: TestClient
) -> None:
    history_db.insert_run(
        job_id="rerun-me",
        name="Try Again",
        description="re-run plan",
        task="detect",
        dataset_id="ds-rerun",
        dataset_snapshot=None,
        base_model="yolo26n.pt",
        epochs_total=100,
        imgsz=512,
        batch=16,
        accelerator_kind="cpu",
        device_arg=None,
        started_at=datetime.now(timezone.utc),
        status="completed",
    )
    resp = client.post("/api/training/history/rerun-me/rerun")
    assert resp.status_code == 200
    body = resp.json()
    assert body["dataset_id"] == "ds-rerun"
    assert body["model"] == "yolo26n.pt"
    assert body["task"] == "detect"
    assert body["epochs"] == 100
    assert body["imgsz"] == 512
    assert body["batch"] == 16
    assert body["name"] == "Try Again"
    assert body["description"] == "re-run plan"
