"""F4 — Dataset naming: schema v2 migration + HistoryDb meta methods.

Covers the new `datasets` table layer + the PATCH route + the
extended `inspect` route (now accepting `?name=&description=`).
Synthetic fixtures — no subprocess, no ultralytics.

Run: ``uv run pytest tests/test_datasets_naming.py -q``
"""

from __future__ import annotations

import io
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from vrl_yolo.api.deps import get_history, get_job_manager
from vrl_yolo.api.routers import dataset as dataset_router
from vrl_yolo.config import Settings
from vrl_yolo.engine.history_db import (
    DatasetMeta,
    HistoryDb,
    _default_dataset_name,
)
from vrl_yolo.engine.training import JobManager


# ---- HistoryDb fixture -------------------------------------------------------


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


# ---- Schema v2 migration ----------------------------------------------------


def test_schema_v2_migration_creates_datasets_table(history_db: HistoryDb) -> None:
    with sqlite3.connect(str(history_db._db_path)) as conn:
        tables = {
            row[0]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )
        }
        version = conn.execute(
            "SELECT version FROM schema_version"
        ).fetchone()[0]
    assert "datasets" in tables
    assert version == 2


def test_v1_to_v2_migration_backfills_existing_folders(
    tmp_path: Path,
) -> None:
    """Pre-F4 install: dataset folders exist on disk, no rows in DB.
    Migrate should INSERT a default-named row for each.
    """
    ds_root = tmp_path / "datasets"
    ds_root.mkdir()
    (ds_root / "abc12345-aaaa-bbbb-cccc-dddd").mkdir()
    (ds_root / "def98765-zzzz").mkdir()

    db = HistoryDb(tmp_path / "training.db", datasets_root=ds_root)
    db.migrate()

    metas = db.list_dataset_meta()
    assert len(metas) == 2
    assert all(m.name.startswith("Dataset ") for m in metas.values())


def test_migrate_is_idempotent(history_db: HistoryDb) -> None:
    """Second migrate() call is a no-op — schema_version already at 2."""
    history_db.migrate()
    history_db.migrate()  # must not fail


def test_migrate_backfill_does_not_overwrite_existing_rows(
    tmp_path: Path,
) -> None:
    """If a user has already renamed a dataset, a subsequent migrate
    (or a fresh folder dropped onto disk after upgrade) must NOT
    clobber the existing name. INSERT OR IGNORE handles this.
    """
    ds_root = tmp_path / "datasets"
    ds_root.mkdir()
    (ds_root / "abc12345-aaaa").mkdir()
    db = HistoryDb(tmp_path / "training.db", datasets_root=ds_root)
    db.migrate()
    db.upsert_dataset_meta(
        "abc12345-aaaa", name="Lung partial dataset", description="curated"
    )

    # Add another folder + re-run migrate; old row keeps its custom name.
    (ds_root / "newone-bbbb").mkdir()
    db.migrate()
    metas = db.list_dataset_meta()
    assert metas["abc12345-aaaa"].name == "Lung partial dataset"
    assert metas["abc12345-aaaa"].description == "curated"
    assert metas["newone-bbbb"].name.startswith("Dataset ")


# ---- HistoryDb meta methods -------------------------------------------------


def test_upsert_inserts_with_default_name(history_db: HistoryDb) -> None:
    meta = history_db.upsert_dataset_meta("fresh-id-1234")
    assert meta.name == _default_dataset_name("fresh-id-1234")
    assert meta.description == ""


def test_upsert_inserts_with_explicit_name(history_db: HistoryDb) -> None:
    meta = history_db.upsert_dataset_meta(
        "fresh-id-2", name="My run set", description="weekly"
    )
    assert meta.name == "My run set"
    assert meta.description == "weekly"


def test_upsert_updates_existing_row(history_db: HistoryDb) -> None:
    history_db.upsert_dataset_meta("abc-001", name="old name")
    updated = history_db.upsert_dataset_meta("abc-001", name="new name")
    assert updated.name == "new name"


def test_upsert_empty_name_resets_to_default_on_update(
    history_db: HistoryDb,
) -> None:
    history_db.upsert_dataset_meta("abc-002", name="My custom")
    reset = history_db.upsert_dataset_meta("abc-002", name="")
    assert reset.name == _default_dataset_name("abc-002")


def test_upsert_none_leaves_field_untouched(
    history_db: HistoryDb,
) -> None:
    history_db.upsert_dataset_meta("abc-003", name="Keep me", description="orig")
    updated = history_db.upsert_dataset_meta("abc-003", description="changed")
    assert updated.name == "Keep me"
    assert updated.description == "changed"


def test_get_dataset_meta_unknown_returns_none(history_db: HistoryDb) -> None:
    assert history_db.get_dataset_meta("nope") is None


def test_delete_dataset_meta_returns_true_on_existing(
    history_db: HistoryDb,
) -> None:
    history_db.upsert_dataset_meta("to-delete")
    assert history_db.delete_dataset_meta("to-delete") is True
    assert history_db.get_dataset_meta("to-delete") is None


def test_delete_dataset_meta_returns_false_unknown(
    history_db: HistoryDb,
) -> None:
    assert history_db.delete_dataset_meta("never-existed") is False


# ---- Route layer: inspect with name/description + PATCH ---------------------


@pytest.fixture
def client(
    tmp_path: Path, datasets_root: Path, history_db: HistoryDb
) -> TestClient:
    """FastAPI app with the dataset router + history wired up.

    Uses the existing storage_path setting to point at tmp_path so
    /api/datasets/inspect writes to a sandboxed location.
    """
    app = FastAPI()
    settings = Settings(storage_path=tmp_path)
    app.state.settings = settings
    app.state.history = history_db
    app.include_router(dataset_router.router, prefix="/api")
    app.dependency_overrides[get_history] = lambda: history_db
    # Some routes (DELETE) need JobManager too; minimal stub is fine
    # for tests that don't exercise the 409 path.
    manager = JobManager(storage_root=tmp_path, history=history_db)
    app.state.job_manager = manager
    app.dependency_overrides[get_job_manager] = lambda: manager
    return TestClient(app)


def test_patch_dataset_metadata_route_updates(
    client: TestClient, history_db: HistoryDb, datasets_root: Path
) -> None:
    # PATCH only works on real on-disk dirs.
    (datasets_root / "patch-target-12345").mkdir()
    # Trigger backfill to populate the meta row.
    history_db.migrate()

    resp = client.patch(
        "/api/datasets/patch-target-12345",
        json={"name": "Renamed via PATCH", "description": "hi"},
    )
    assert resp.status_code == 204
    meta = history_db.get_dataset_meta("patch-target-12345")
    assert meta is not None
    assert meta.name == "Renamed via PATCH"
    assert meta.description == "hi"


def test_patch_empty_name_resets_to_default(
    client: TestClient, history_db: HistoryDb, datasets_root: Path
) -> None:
    (datasets_root / "reset-name-12345").mkdir()
    history_db.migrate()
    history_db.upsert_dataset_meta("reset-name-12345", name="Custom")

    resp = client.patch(
        "/api/datasets/reset-name-12345",
        json={"name": ""},
    )
    assert resp.status_code == 204
    meta = history_db.get_dataset_meta("reset-name-12345")
    assert meta is not None
    assert meta.name == _default_dataset_name("reset-name-12345")


def test_patch_unknown_returns_404(client: TestClient) -> None:
    resp = client.patch(
        "/api/datasets/nope-1234567",
        json={"name": "x"},
    )
    assert resp.status_code == 404
