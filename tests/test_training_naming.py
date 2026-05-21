"""F2 — Training-run name + description + slug filenames + PATCH.

Tests the F2 surface without spawning real training subprocesses:

- ``_default_run_name`` format + ``_slugify_run_name`` Unicode handling
  as pure unit tests on the helpers.
- ``TrainingJob.snapshot()`` includes name + description.
- ``JobManager.update_metadata()`` semantics (None=keep, ""=reset/clear,
  gated to queued/running).
- ``JobManager.save_to_library()`` uses the slugified name +
  disambiguates collisions + falls back on empty slugs.
- ``PATCH /api/training/{job_id}`` 200 / 404 / 409 mapping.
- ``POST /api/training/start`` + ``POST /api/training/colab/connect``
  accept the new optional name + description fields.

Run: ``uv run pytest tests/test_training_naming.py -q``
"""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from vrl_yolo.api.deps import get_job_manager, get_registry
from vrl_yolo.api.routers import training as training_router
from vrl_yolo.engine.registry import ModelRecord, ModelRegistry
from vrl_yolo.engine.training import (
    JobManager,
    TrainingJob,
    _default_run_name,
    _slugify_run_name,
)


# ---- helpers + fixtures --------------------------------------------------


def _make_job(
    *,
    job_id: str = "abc123def456",
    name: str = "",
    description: str = "",
    status: str = "running",
    task: str = "detect",
    dataset_id: str = "d6a1bf57-1234-5678-90ab-cdef00112233",
    output_dir: Path | None = None,
    started_at: datetime | None = None,
    best_pt: Path | None = None,
) -> TrainingJob:
    """Build a TrainingJob without going through subprocess-spawning ``start()``."""
    started = started_at or datetime(2026, 5, 21, 14, 30, tzinfo=timezone.utc)
    final_name = name or _default_run_name(task, dataset_id, started)  # type: ignore[arg-type]
    job = TrainingJob(
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
        name=final_name,
        description=description,
        best_pt=best_pt,
    )
    return job


@pytest.fixture
def manager(tmp_path: Path) -> JobManager:
    return JobManager(storage_root=tmp_path)


@pytest.fixture
def registry(tmp_path: Path) -> ModelRegistry:
    bundled = tmp_path / "bundled"
    user = tmp_path / "models"
    bundled.mkdir(parents=True)
    user.mkdir(parents=True)
    reg = ModelRegistry(bundled_dir=bundled, user_dir=user)
    # Stub scan to no-op so the registry doesn't try to ultralytics-load
    # the dummy .pt files our save_to_library tests drop in.
    reg.scan = lambda: []  # type: ignore[assignment]
    return reg


@pytest.fixture
def client(manager: JobManager, registry: ModelRegistry) -> TestClient:
    app = FastAPI()
    app.include_router(training_router.router, prefix="/api")
    app.dependency_overrides[get_job_manager] = lambda: manager
    app.dependency_overrides[get_registry] = lambda: registry
    return TestClient(app)


# ---- _default_run_name + _slugify_run_name unit tests --------------------


def test_default_run_name_format() -> None:
    when = datetime(2026, 5, 21, 14, 30, tzinfo=timezone.utc)
    out = _default_run_name("detect", "d6a1bf57-aaaa-bbbb-cccc-dddd", when)
    # Format: `<Task> · <stub> · YYYY-MM-DD HH:MM`. The HH:MM depends
    # on the test runner's local TZ (astimezone() converts from UTC),
    # so we assert the stable parts and the presence of a 5-char time.
    assert out.startswith("Detect · d6a1bf57 · 2026-05-2")
    assert ":" in out.split("·")[-1]


def test_default_run_name_classify_label() -> None:
    when = datetime(2026, 5, 21, 14, 30, tzinfo=timezone.utc)
    out = _default_run_name("classify", "abc12345", when)
    assert out.startswith("Classify · abc12345 · ")


def test_slugify_ascii_preserves_case() -> None:
    assert _slugify_run_name("Lung Classify Run") == "Lung-Classify-Run"


def test_slugify_unicode_preserves_devanagari() -> None:
    # python-slugify with allow_unicode=True keeps the Devanagari
    # characters; default would transliterate to ASCII.
    result = _slugify_run_name("फेफड़े वर्गीकरण")
    assert "फ" in result or "ड" in result, (
        f"expected Devanagari preserved, got {result!r}"
    )


def test_slugify_empty_for_pure_punctuation() -> None:
    assert _slugify_run_name("!!!") == ""
    assert _slugify_run_name("   ") == ""


def test_slugify_caps_length() -> None:
    long = "a" * 200
    out = _slugify_run_name(long)
    assert len(out) <= 80


# ---- TrainingJob.snapshot() ----------------------------------------------


def test_snapshot_surfaces_name_and_description() -> None:
    job = _make_job(name="My Run", description="Test imgsz=320")
    snap = job.snapshot()
    assert snap["name"] == "My Run"
    assert snap["description"] == "Test imgsz=320"


# ---- JobManager.update_metadata() ----------------------------------------


def test_update_metadata_changes_name_on_running_job(
    manager: JobManager,
) -> None:
    job = _make_job(name="Original", status="running")
    manager._jobs[job.job_id] = job

    updated = manager.update_metadata(job.job_id, name="Renamed")
    assert updated.snapshot()["name"] == "Renamed"


def test_update_metadata_empty_name_resets_to_default(
    manager: JobManager,
) -> None:
    job = _make_job(name="Custom Name", status="running")
    manager._jobs[job.job_id] = job
    expected_default = _default_run_name(
        job.task, job.dataset_root.name, job.started_at
    )

    updated = manager.update_metadata(job.job_id, name="")
    assert updated.snapshot()["name"] == expected_default


def test_update_metadata_none_name_leaves_untouched(
    manager: JobManager,
) -> None:
    job = _make_job(name="Keep Me", description="", status="running")
    manager._jobs[job.job_id] = job

    updated = manager.update_metadata(job.job_id, description="New desc")
    assert updated.snapshot()["name"] == "Keep Me"
    assert updated.snapshot()["description"] == "New desc"


def test_update_metadata_unknown_job(manager: JobManager) -> None:
    # F3: no history wired here, so terminal-only IDs raise KeyError.
    with pytest.raises(KeyError):
        manager.update_metadata("does-not-exist", name="x")


def test_update_metadata_on_completed_job_was_gated_in_f2_is_unlocked_in_f3(
    manager: JobManager,
) -> None:
    """F2 raised ValueError("can only edit") on terminal-state edits.

    F3 routes terminal edits through HistoryDb; without history wired
    here, the call raises KeyError because there's nowhere durable to
    write to. The history-backed happy-path is exercised in
    tests/test_history.py.
    """
    job = _make_job(name="Done", status="completed")
    manager._jobs[job.job_id] = job
    with pytest.raises(KeyError):
        manager.update_metadata(job.job_id, name="Try edit")


# ---- PATCH /api/training/{job_id} ----------------------------------------


def test_patch_route_updates_name(
    manager: JobManager, client: TestClient
) -> None:
    job = _make_job(name="Before", status="running")
    manager._jobs[job.job_id] = job

    resp = client.patch(
        f"/api/training/{job.job_id}", json={"name": "After"}
    )
    assert resp.status_code == 200
    assert resp.json()["name"] == "After"


def test_patch_route_404_unknown(client: TestClient) -> None:
    # No history wired here, so an unknown id raises KeyError → 404.
    # F3 happy-path for completed-row PATCH is in tests/test_history.py.
    resp = client.patch(
        "/api/training/nonexistent", json={"name": "x"}
    )
    assert resp.status_code == 404


def test_patch_route_404_on_terminal_without_history(
    manager: JobManager, client: TestClient
) -> None:
    """F2's 409-on-completed gate became F3's KeyError → 404 when no
    history is wired. The happy path (terminal edit succeeds via
    HistoryDb) is in tests/test_history.py.
    """
    job = _make_job(name="Done", status="completed")
    manager._jobs[job.job_id] = job
    resp = client.patch(
        f"/api/training/{job.job_id}", json={"name": "Edit"}
    )
    assert resp.status_code == 404


# ---- save_to_library filename derivation --------------------------------


def _make_fake_best_pt(tmp_path: Path) -> Path:
    p = tmp_path / "fake-best.pt"
    p.write_bytes(b"\x00" * 1024)
    return p


def test_save_to_library_uses_slugified_name(
    manager: JobManager, registry: ModelRegistry, tmp_path: Path
) -> None:
    best = _make_fake_best_pt(tmp_path)
    job = _make_job(
        name="Lung Classify Run",
        status="completed",
        task="classify",
        best_pt=best,
    )
    manager._jobs[job.job_id] = job

    dest = manager.save_to_library(job.job_id, registry=registry)
    assert dest.name == "Lung-Classify-Run.pt"
    assert dest.parent.name == "classify"
    assert dest.is_file()


def test_save_to_library_preserves_unicode_name(
    manager: JobManager, registry: ModelRegistry, tmp_path: Path
) -> None:
    best = _make_fake_best_pt(tmp_path)
    job = _make_job(
        name="फेफड़े वर्गीकरण",
        status="completed",
        task="classify",
        best_pt=best,
    )
    manager._jobs[job.job_id] = job

    dest = manager.save_to_library(job.job_id, registry=registry)
    # The slug should preserve some Devanagari (allow_unicode=True).
    assert any(0x0900 <= ord(c) <= 0x097F for c in dest.stem), (
        f"expected Devanagari in slug, got {dest.name!r}"
    )
    assert dest.suffix == ".pt"
    assert dest.is_file()


def test_save_to_library_falls_back_when_slug_empty(
    manager: JobManager, registry: ModelRegistry, tmp_path: Path
) -> None:
    best = _make_fake_best_pt(tmp_path)
    job = _make_job(
        name="!!!",  # slugifies to empty
        status="completed",
        task="detect",
        best_pt=best,
    )
    manager._jobs[job.job_id] = job

    dest = manager.save_to_library(job.job_id, registry=registry)
    assert dest.name == f"trained-{job.job_id[:8]}.pt"


def test_save_to_library_disambiguates_collision(
    manager: JobManager, registry: ModelRegistry, tmp_path: Path
) -> None:
    best1 = tmp_path / "best1.pt"
    best1.write_bytes(b"\x00" * 512)
    best2 = tmp_path / "best2.pt"
    best2.write_bytes(b"\x11" * 512)

    job1 = _make_job(
        job_id="aaaa1111bbbb2222",
        name="Shared Name",
        status="completed",
        task="detect",
        best_pt=best1,
    )
    job2 = _make_job(
        job_id="cccc3333dddd4444",
        name="Shared Name",
        status="completed",
        task="detect",
        best_pt=best2,
    )
    manager._jobs[job1.job_id] = job1
    manager._jobs[job2.job_id] = job2

    dest1 = manager.save_to_library(job1.job_id, registry=registry)
    dest2 = manager.save_to_library(job2.job_id, registry=registry)

    assert dest1.name == "Shared-Name.pt"
    # Second file gets the job-id stub suffix so neither overwrites.
    assert dest2.name == f"Shared-Name-{job2.job_id[:8]}.pt"
    assert dest1.read_bytes() != dest2.read_bytes()


# ---- start route accepts name/description -------------------------------


def test_start_training_route_accepts_name_and_description(
    manager: JobManager, registry: ModelRegistry, client: TestClient
) -> None:
    """Intercept manager.start to verify name/desc flow through the route.

    We don't actually spawn a subprocess — patch `start()` to return a
    pre-built TrainingJob carrying whatever the route handed it.
    """
    captured: dict = {}

    def fake_start(**kwargs):
        captured.update(kwargs)
        return _make_job(name=kwargs.get("name", ""))

    # Also patch the dataset_root + model lookup since those touch disk.
    dataset_root = Path("/tmp/datasets/ds1")
    dataset_root.mkdir(parents=True, exist_ok=True)
    (dataset_root / "data.yaml").write_text("x")

    fake_model_path = Path("/tmp/yolo26n.pt")
    fake_model_path.write_bytes(b"x")
    fake_record = ModelRecord(
        name="yolo26n.pt",
        task="detect",
        source="bundled",
        path=fake_model_path,
        classes={0: "cell"},
        num_classes=1,
        params=1,
        size_mb=0.001,
    )
    registry._records = {"yolo26n.pt": fake_record}
    # Make the training_root resolve to /tmp so dataset_id stub lookup works
    object.__setattr__(manager, "_training_root", Path("/tmp/training"))
    manager._training_root.mkdir(parents=True, exist_ok=True)
    (Path("/tmp/datasets")).mkdir(parents=True, exist_ok=True)

    with patch.object(manager, "start", side_effect=fake_start):
        resp = client.post(
            "/api/training/start",
            json={
                "dataset_id": "ds1",
                "model": "yolo26n.pt",
                "name": "My Custom Run",
                "description": "Trying imgsz=512",
            },
        )

    assert resp.status_code == 202, resp.json()
    assert captured["name"] == "My Custom Run"
    assert captured["description"] == "Trying imgsz=512"


def test_save_to_library_route_returns_valid_model_info(
    manager: JobManager, registry: ModelRegistry, client: TestClient,
    tmp_path: Path,
) -> None:
    """Regression: F1 added `path` to ModelInfo but `routers/training.py`
    has a separate `_record_to_info()` helper that wasn't updated, so
    save-to-library 500'd with a pydantic ValidationError. The existing
    colab smoke test swallowed it via a broad `except Exception: pass`.

    This test hits the route end-to-end and asserts the response is a
    validatable ModelInfo with the F1 `path` field present.
    """
    best = _make_fake_best_pt(tmp_path)
    job = _make_job(
        name="Save Route Smoke",
        status="completed",
        task="detect",
        best_pt=best,
    )
    manager._jobs[job.job_id] = job

    # Stub registry.scan + registry.get so the route can fish the freshly
    # copied .pt back out without needing real ultralytics inspection.
    copied_path = {"value": None}
    original_save = manager.save_to_library

    def wrapper(job_id, *, registry):  # noqa: ANN001
        dest = original_save(job_id, registry=registry)
        copied_path["value"] = dest
        return dest

    def fake_get(name: str):
        # Build a synthetic record that matches the file save_to_library
        # actually wrote, so /save-to-library's GET-after-write succeeds.
        path = copied_path["value"]
        return ModelRecord(
            name=name,
            task="detect",
            source="trained",
            path=path,
            classes={0: "cell"},
            num_classes=1,
            params=42,
            size_mb=0.001,
        )

    with patch.object(manager, "save_to_library", side_effect=wrapper), \
         patch.object(registry, "get", side_effect=fake_get):
        resp = client.post(
            f"/api/training/{job.job_id}/save-to-library"
        )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    # F1 path field must be present + absolute.
    assert "path" in body, body
    assert Path(body["path"]).is_absolute()


def test_colab_connect_route_accepts_name_and_description(
    manager: JobManager, client: TestClient
) -> None:
    captured: dict = {}

    def fake_start_colab(tunnel_url, *, name="", description=""):
        captured["tunnel_url"] = tunnel_url
        captured["name"] = name
        captured["description"] = description
        return _make_job(name=name or "default")

    with patch.object(manager, "start_colab_job", side_effect=fake_start_colab):
        resp = client.post(
            "/api/training/colab/connect",
            json={
                "tunnel_url": "https://abc-def.trycloudflare.com?token=tok",
                "name": "Colab T4 run #3",
                "description": "Larger batch this time",
            },
        )

    assert resp.status_code == 202
    assert captured["name"] == "Colab T4 run #3"
    assert captured["description"] == "Larger batch this time"
