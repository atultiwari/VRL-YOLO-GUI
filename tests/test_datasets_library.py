"""F4 — Dataset library list + delete routes.

Exercises GET /api/datasets and DELETE /api/datasets/{id} against
on-disk dataset folders. Stubs inspect_dataset so we don't need
real YOLO/COCO datasets — only the route layer behaviour matters
here. The naming layer is exercised in test_datasets_naming.py.

Run: ``uv run pytest tests/test_datasets_library.py -q``
"""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from vrl_yolo.api.deps import get_history, get_job_manager
from vrl_yolo.api.routers import dataset as dataset_router
from vrl_yolo.config import Settings
from vrl_yolo.engine.history_db import HistoryDb
from vrl_yolo.engine.training import JobManager, TrainingJob


# ---- fixtures ---------------------------------------------------------------


@pytest.fixture
def datasets_root(tmp_path: Path) -> Path:
    root = tmp_path / "datasets"
    root.mkdir()
    return root


@pytest.fixture
def history_db(tmp_path: Path, datasets_root: Path) -> HistoryDb:
    db = HistoryDb(tmp_path / "training.db", datasets_root=datasets_root)
    db.migrate()
    return db


@pytest.fixture
def manager(tmp_path: Path, history_db: HistoryDb) -> JobManager:
    return JobManager(storage_root=tmp_path, history=history_db)


@pytest.fixture
def client(
    tmp_path: Path,
    datasets_root: Path,
    history_db: HistoryDb,
    manager: JobManager,
) -> TestClient:
    app = FastAPI()
    settings = Settings(storage_path=tmp_path)
    app.state.settings = settings
    app.state.history = history_db
    app.state.job_manager = manager
    app.include_router(dataset_router.router, prefix="/api")
    app.dependency_overrides[get_history] = lambda: history_db
    app.dependency_overrides[get_job_manager] = lambda: manager
    return TestClient(app)


def _fake_inspect_result(ds_id: str):
    """Build a minimal object that quacks like engine.dataset.DatasetInfo."""

    class _Split:
        def __init__(self, name: str, image_count: int, label_count: int):
            self.name = name
            self.image_count = image_count
            self.label_count = label_count

    class _Info:
        def __init__(self):
            self.id = ds_id
            self.format = "yolo"
            self.task = "detect"
            self.root_path = Path("/tmp/synthetic") / ds_id
            self.splits = [
                _Split("train", 80, 80),
                _Split("valid", 10, 10),
                _Split("test", 10, 10),
            ]
            self.classes = ["cell", "nucleus"]
            self.class_counts = {"cell": 60, "nucleus": 40}
            self.warnings = []
            self.unassigned_image_count = 0

    return _Info()


def _make_job_using_dataset(
    *,
    job_id: str,
    dataset_id: str,
    status: str = "running",
) -> TrainingJob:
    return TrainingJob(
        job_id=job_id,
        dataset_root=Path(dataset_id),
        model="yolo26n.pt",
        task="detect",
        epochs_total=10,
        imgsz=640,
        batch=8,
        accelerator_kind="cpu",
        output_dir=Path("/tmp/out"),
        started_at=datetime.now(timezone.utc),
        status=status,  # type: ignore[arg-type]
        name=f"run-{job_id[:6]}",
        description="",
    )


# ---- GET /api/datasets ------------------------------------------------------


def test_list_datasets_empty(client: TestClient) -> None:
    """No folders on disk → empty rows + empty partial."""
    resp = client.get("/api/datasets")
    assert resp.status_code == 200
    body = resp.json()
    assert body == {"rows": [], "partial": []}


def test_list_datasets_returns_rows_with_inspect_data(
    client: TestClient,
    datasets_root: Path,
    history_db: HistoryDb,
) -> None:
    (datasets_root / "abc12345-aaaa").mkdir()
    (datasets_root / "def98765-bbbb").mkdir()
    history_db.migrate()  # backfill meta rows

    def fake_inspect(path: Path):
        return _fake_inspect_result(path.name)

    with patch.object(dataset_router, "inspect_dataset", side_effect=fake_inspect):
        resp = client.get("/api/datasets")

    assert resp.status_code == 200
    body = resp.json()
    assert body["partial"] == []
    ids = {r["id"] for r in body["rows"]}
    assert ids == {"abc12345-aaaa", "def98765-bbbb"}
    # F4 meta default name should be present on each row.
    for row in body["rows"]:
        assert row["name"].startswith("Dataset ")
        assert row["run_count"] == 0
        assert row["last_used_at"] is None


def test_list_datasets_cross_references_history_stats(
    client: TestClient,
    datasets_root: Path,
    history_db: HistoryDb,
) -> None:
    """A dataset with training history rows shows last_used_at + run_count."""
    (datasets_root / "with-history-1234").mkdir()
    history_db.migrate()
    history_db.insert_run(
        job_id="run-1",
        name="first",
        description="",
        task="detect",
        dataset_id="with-history-1234",
        dataset_snapshot=None,
        base_model="yolo26n.pt",
        epochs_total=10,
        imgsz=640,
        batch=8,
        accelerator_kind="cpu",
        device_arg=None,
        started_at=datetime(2026, 5, 1, tzinfo=timezone.utc),
        status="completed",
    )
    history_db.insert_run(
        job_id="run-2",
        name="second",
        description="",
        task="detect",
        dataset_id="with-history-1234",
        dataset_snapshot=None,
        base_model="yolo26n.pt",
        epochs_total=10,
        imgsz=640,
        batch=8,
        accelerator_kind="cpu",
        device_arg=None,
        started_at=datetime(2026, 5, 15, tzinfo=timezone.utc),
        status="completed",
    )

    with patch.object(
        dataset_router,
        "inspect_dataset",
        side_effect=lambda p: _fake_inspect_result(p.name),
    ):
        resp = client.get("/api/datasets")

    row = resp.json()["rows"][0]
    assert row["id"] == "with-history-1234"
    assert row["run_count"] == 2
    assert row["last_used_at"].startswith("2026-05-15")


def test_list_datasets_surfaces_partial_separately(
    client: TestClient,
    datasets_root: Path,
    history_db: HistoryDb,
) -> None:
    """A dataset folder where inspect_dataset raises lands in `partial`."""
    (datasets_root / "healthy-12345").mkdir()
    (datasets_root / "broken-12345").mkdir()
    history_db.migrate()

    def fake_inspect(path: Path):
        if "broken" in path.name:
            raise ValueError("dataset has no recognised layout")
        return _fake_inspect_result(path.name)

    with patch.object(dataset_router, "inspect_dataset", side_effect=fake_inspect):
        resp = client.get("/api/datasets")

    body = resp.json()
    assert {r["id"] for r in body["rows"]} == {"healthy-12345"}
    assert len(body["partial"]) == 1
    assert body["partial"][0]["id"] == "broken-12345"
    assert "no recognised" in body["partial"][0]["error"]


def test_list_datasets_sort_order(
    client: TestClient,
    datasets_root: Path,
    history_db: HistoryDb,
) -> None:
    """Most-recently-used first; rows with no runs at the bottom."""
    (datasets_root / "recent-12345").mkdir()
    (datasets_root / "older-12345").mkdir()
    (datasets_root / "unused-12345").mkdir()
    history_db.migrate()

    for jid, ds, when in [
        ("r1", "recent-12345", datetime(2026, 5, 20, tzinfo=timezone.utc)),
        ("r2", "older-12345", datetime(2026, 5, 1, tzinfo=timezone.utc)),
    ]:
        history_db.insert_run(
            job_id=jid,
            name=jid,
            description="",
            task="detect",
            dataset_id=ds,
            dataset_snapshot=None,
            base_model="yolo26n.pt",
            epochs_total=1,
            imgsz=640,
            batch=8,
            accelerator_kind="cpu",
            device_arg=None,
            started_at=when,
            status="completed",
        )

    with patch.object(
        dataset_router,
        "inspect_dataset",
        side_effect=lambda p: _fake_inspect_result(p.name),
    ):
        resp = client.get("/api/datasets")

    ids = [r["id"] for r in resp.json()["rows"]]
    # recent first, then older, then unused (NULL last_used_at).
    assert ids == ["recent-12345", "older-12345", "unused-12345"]


# ---- DELETE /api/datasets/{id} ----------------------------------------------


def test_delete_dataset_removes_folder(
    client: TestClient,
    datasets_root: Path,
    history_db: HistoryDb,
) -> None:
    folder = datasets_root / "delete-me-12345"
    folder.mkdir()
    history_db.migrate()

    resp = client.delete("/api/datasets/delete-me-12345")
    assert resp.status_code == 204
    assert not folder.exists()
    # Meta row is cleaned up too.
    assert history_db.get_dataset_meta("delete-me-12345") is None


def test_delete_dataset_404_unknown(client: TestClient) -> None:
    resp = client.delete("/api/datasets/never-existed-1234")
    assert resp.status_code == 404


def test_delete_dataset_409_when_active_run(
    client: TestClient,
    datasets_root: Path,
    history_db: HistoryDb,
    manager: JobManager,
) -> None:
    folder = datasets_root / "in-use-12345"
    folder.mkdir()
    history_db.migrate()

    # Inject a running TrainingJob whose dataset_root.name matches.
    job = _make_job_using_dataset(
        job_id="active-1", dataset_id="in-use-12345", status="running"
    )
    manager._jobs[job.job_id] = job

    resp = client.delete("/api/datasets/in-use-12345")
    assert resp.status_code == 409
    detail = resp.json()["detail"]
    assert "active-1"[:6] in detail or "run-active" in detail or "still" in detail.lower()
    # Folder still exists.
    assert folder.is_dir()


def test_delete_dataset_preserves_history_rows(
    client: TestClient,
    datasets_root: Path,
    history_db: HistoryDb,
) -> None:
    """F3's `dataset_missing` flag handles the orphaned-history case;
    DELETE doesn't cascade into training_runs.
    """
    folder = datasets_root / "with-runs-12345"
    folder.mkdir()
    history_db.migrate()
    history_db.insert_run(
        job_id="keep-1",
        name="surviving run",
        description="",
        task="detect",
        dataset_id="with-runs-12345",
        dataset_snapshot=None,
        base_model="yolo26n.pt",
        epochs_total=10,
        imgsz=640,
        batch=8,
        accelerator_kind="cpu",
        device_arg=None,
        started_at=datetime.now(timezone.utc),
        status="completed",
    )

    resp = client.delete("/api/datasets/with-runs-12345")
    assert resp.status_code == 204
    # The training_runs row survives.
    assert history_db.get("keep-1") is not None


def test_list_active_jobs_for_dataset_filters_correctly(
    manager: JobManager,
) -> None:
    """JobManager helper returns only matching + alive jobs."""
    completed = _make_job_using_dataset(
        job_id="done-1", dataset_id="ds-x", status="completed"
    )
    running = _make_job_using_dataset(
        job_id="run-1", dataset_id="ds-x", status="running"
    )
    other_ds = _make_job_using_dataset(
        job_id="run-2", dataset_id="ds-y", status="running"
    )
    manager._jobs[completed.job_id] = completed
    manager._jobs[running.job_id] = running
    manager._jobs[other_ds.job_id] = other_ds

    active = manager.list_active_jobs_for_dataset("ds-x")
    assert [j.job_id for j in active] == ["run-1"]
