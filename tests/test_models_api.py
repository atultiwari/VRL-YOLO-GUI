"""F1 — Models library: delete + reveal + path field.

Exercises `ModelRegistry.delete()`, `DELETE /api/models/{name}`, and
`POST /api/models/{name}/reveal`. Synthetic registries with dummy
`.pt` files — no ultralytics, no real model loading — so the suite
runs in <1 s and doesn't need the `ml` extra.

Run: ``uv run pytest tests/test_models_api.py -q``
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from vrl_yolo.api.deps import get_registry
from vrl_yolo.api.routers import models as models_router
from vrl_yolo.engine.registry import ModelRecord, ModelRegistry


def _make_record(
    *,
    name: str,
    task: str,
    source: str,
    path: Path,
) -> ModelRecord:
    return ModelRecord(
        name=name,
        task=task,  # type: ignore[arg-type]
        source=source,  # type: ignore[arg-type]
        path=path,
        classes={0: "cell"},
        num_classes=1,
        params=1_000_000,
        size_mb=1.0,
    )


@pytest.fixture
def registry(tmp_path: Path) -> ModelRegistry:
    """Build a registry pre-populated with one bundled + two user records.

    The actual scan() is bypassed — we hand-build records pointing at
    real on-disk dummy files. This keeps the test free of any
    ultralytics dependency.
    """
    bundled_dir = tmp_path / "bundled"
    user_dir = tmp_path / "user"
    (bundled_dir / "detect").mkdir(parents=True)
    (user_dir / "detect").mkdir(parents=True)
    (user_dir / "classify").mkdir(parents=True)

    bundled_pt = bundled_dir / "detect" / "yolo26n.pt"
    bundled_pt.write_bytes(b"BUNDLED-WEIGHTS")
    user_pt = user_dir / "detect" / "my-trained.pt"
    user_pt.write_bytes(b"USER-WEIGHTS")
    classify_pt = user_dir / "classify" / "lung-classifier.pt"
    classify_pt.write_bytes(b"CLASSIFY-WEIGHTS")

    reg = ModelRegistry(bundled_dir=bundled_dir, user_dir=user_dir)

    # Synthetic _inspect: build a record without touching ultralytics.
    # Real scan() drives this for every .pt it finds, so delete()'s
    # post-unlink scan() correctly drops records whose file is gone.
    def _fake_inspect(path: Path, *, source: str) -> ModelRecord:
        task = path.parent.name  # detect / classify from path layout
        return _make_record(name=path.name, task=task, source=source, path=path)

    reg._inspect = _fake_inspect  # type: ignore[assignment]
    reg.scan()
    return reg


@pytest.fixture
def client(registry: ModelRegistry) -> TestClient:
    app = FastAPI()
    app.include_router(models_router.router, prefix="/api")
    app.dependency_overrides[get_registry] = lambda: registry
    return TestClient(app)


# ---- delete --------------------------------------------------------------


def test_delete_user_model_removes_file_and_record(
    registry: ModelRegistry, client: TestClient
) -> None:
    path = registry.get("my-trained.pt").path
    assert path.is_file()

    resp = client.delete("/api/models/my-trained.pt")
    assert resp.status_code == 204
    assert not path.exists()
    assert "my-trained.pt" not in {r.name for r in registry.list()}


def test_delete_bundled_rejected_with_403(
    registry: ModelRegistry, client: TestClient
) -> None:
    path = registry.get("yolo26n.pt").path

    resp = client.delete("/api/models/yolo26n.pt")
    assert resp.status_code == 403
    assert "bundled" in resp.json()["detail"].lower()
    # File untouched + record still registered.
    assert path.is_file()
    assert "yolo26n.pt" in {r.name for r in registry.list()}


def test_delete_missing_returns_404(client: TestClient) -> None:
    resp = client.delete("/api/models/never-existed.pt")
    assert resp.status_code == 404


def test_delete_clears_default_when_deleting_default_model(
    registry: ModelRegistry, client: TestClient, tmp_path: Path
) -> None:
    # Set the user model as the detect default.
    registry.set_default("detect", "my-trained.pt")
    defaults_file = registry._defaults_path
    assert "my-trained.pt" in defaults_file.read_text()

    resp = client.delete("/api/models/my-trained.pt")
    assert resp.status_code == 204

    # defaults.json no longer references the deleted name; get_defaults()
    # falls back to any remaining record of the right task (the bundled
    # one in this fixture).
    remaining = defaults_file.read_text()
    assert "my-trained.pt" not in remaining
    assert registry.get_defaults().get("detect") == "yolo26n.pt"


def test_delete_tolerates_file_already_missing(
    registry: ModelRegistry, client: TestClient
) -> None:
    """Race condition: someone removed the .pt between scan() and click.

    delete() should still clean up the registry + defaults so the UI
    stops showing a ghost entry.
    """
    path = registry.get("my-trained.pt").path
    path.unlink()  # disappears under our feet
    assert not path.exists()

    resp = client.delete("/api/models/my-trained.pt")
    assert resp.status_code == 204
    assert "my-trained.pt" not in {r.name for r in registry.list()}


# ---- path field ----------------------------------------------------------


def test_path_field_present_on_list_response(client: TestClient) -> None:
    resp = client.get("/api/models")
    assert resp.status_code == 200
    body = resp.json()
    assert body["models"], "fixture should return at least one model"
    for model in body["models"]:
        assert "path" in model
        assert Path(model["path"]).is_absolute()


def test_path_field_present_on_single_response(client: TestClient) -> None:
    resp = client.get("/api/models/my-trained.pt")
    assert resp.status_code == 200
    body = resp.json()
    assert Path(body["path"]).is_absolute()
    assert body["path"].endswith("my-trained.pt")


# ---- reveal --------------------------------------------------------------


def test_reveal_dispatches_open_on_macos(client: TestClient) -> None:
    with (
        patch.object(models_router.platform, "system", return_value="Darwin"),
        patch.object(models_router.subprocess, "run") as run,
    ):
        resp = client.post("/api/models/my-trained.pt/reveal")

    assert resp.status_code == 204
    assert run.call_count == 1
    args = run.call_args.args[0]
    assert args[0] == "open"
    assert args[1] == "-R"
    assert args[2].endswith("my-trained.pt")


def test_reveal_dispatches_explorer_on_windows(client: TestClient) -> None:
    with (
        patch.object(models_router.platform, "system", return_value="Windows"),
        patch.object(models_router.subprocess, "run") as run,
    ):
        resp = client.post("/api/models/my-trained.pt/reveal")

    assert resp.status_code == 204
    assert run.call_count == 1
    args = run.call_args.args[0]
    assert args[0] == "explorer"
    # `/select,<path>` — no space after the comma.
    assert args[1].startswith("/select,")
    assert args[1].endswith("my-trained.pt")


def test_reveal_dispatches_xdg_open_on_linux(client: TestClient) -> None:
    with (
        patch.object(models_router.platform, "system", return_value="Linux"),
        patch.object(models_router.subprocess, "run") as run,
    ):
        resp = client.post("/api/models/my-trained.pt/reveal")

    assert resp.status_code == 204
    args = run.call_args.args[0]
    assert args[0] == "xdg-open"
    # Linux variant opens the containing folder, not /select-style.
    assert args[1].endswith("detect")


def test_reveal_404_on_unknown(client: TestClient) -> None:
    with patch.object(models_router.subprocess, "run") as run:
        resp = client.post("/api/models/never-existed.pt/reveal")
    assert resp.status_code == 404
    assert run.call_count == 0


def test_reveal_410_when_file_missing(
    registry: ModelRegistry, client: TestClient
) -> None:
    registry.get("my-trained.pt").path.unlink()
    with patch.object(models_router.subprocess, "run") as run:
        resp = client.post("/api/models/my-trained.pt/reveal")
    assert resp.status_code == 410
    assert run.call_count == 0
