"""End-to-end smoke tests for the desktop ↔ Colab integration (P6b).

We can't actually run Cloudflare or Ultralytics in CI, so this suite
stands a real ``ColabServer`` (the Colab-side mini-server from
``notebooks/_runtime/``) on localhost, pretends ``http://127.0.0.1:port``
is the tunnel URL, and exercises every desktop-side hook:

- ``engine.colab.connect`` does a real GET /status pre-flight and
  returns a populated ``ColabSession``.
- ``JobManager.start_colab_job`` registers a ``TrainingJob`` whose
  reader thread propagates published events into ``job.events``.
- ``JobManager.cancel`` POSTs /cancel through to the server and the
  server's ``cancel_requested`` flag flips.
- ``JobManager.save_to_library`` downloads /best.pt through the tunnel
  + lands the file under ``models/<task>/`` via the existing registry
  scan.

Run: ``uv run --extra ml pytest tests/test_colab_integration_smoke.py -q``
"""

from __future__ import annotations

import socket
import sys
import time
from pathlib import Path

import pytest

NOTEBOOKS_DIR = Path(__file__).resolve().parent.parent / "notebooks"
if str(NOTEBOOKS_DIR) not in sys.path:
    sys.path.insert(0, str(NOTEBOOKS_DIR))


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


@pytest.fixture
def fake_tunnel(tmp_path: Path):
    """Spin up a real ColabServer on localhost. Yields (server, tunnel_url)."""
    from _runtime.colab_server import ColabServer  # type: ignore[import-not-found]

    token = "p6b-smoke-token"
    server = ColabServer(
        token=token,
        task="detect",
        model="yolo26n.pt",
        epochs=3,
        imgsz=640,
        batch=16,
    )
    port = _free_port()
    server.start_uvicorn(port=port)
    tunnel_url = f"http://127.0.0.1:{port}?token={token}"
    try:
        yield server, tunnel_url
    finally:
        server.stop_uvicorn()
        time.sleep(0.3)


# ---------------------------------------------------------------------------
# engine/colab.py
# ---------------------------------------------------------------------------


def test_connect_returns_populated_session(fake_tunnel) -> None:
    from vrl_yolo.engine.colab import connect

    _, tunnel_url = fake_tunnel
    session = connect(tunnel_url)

    assert session.token == "p6b-smoke-token"
    assert session.base_url.startswith("http://127.0.0.1:")
    assert session.events_ws_url.startswith("ws://127.0.0.1:")
    assert "?token=p6b-smoke-token" in session.events_ws_url

    init = session.initial_status
    assert init.task == "detect"
    assert init.model == "yolo26n.pt"
    assert init.epochs_total == 3
    assert init.imgsz == 640
    assert init.batch == 16
    assert init.best_pt_available is False


def test_connect_rejects_missing_token() -> None:
    from vrl_yolo.engine.colab import ColabConnectError, connect

    with pytest.raises(ColabConnectError, match="token"):
        connect("https://abc.trycloudflare.com")


def test_connect_rejects_bad_scheme() -> None:
    from vrl_yolo.engine.colab import ColabConnectError, connect

    with pytest.raises(ColabConnectError, match="http"):
        connect("ftp://nope?token=x")


def test_connect_surfaces_unreachable_as_friendly_error() -> None:
    from vrl_yolo.engine.colab import ColabConnectError, connect

    # Port 1 — nothing listens. urllib raises URLError fast enough.
    with pytest.raises(ColabConnectError, match="Couldn't reach"):
        connect("http://127.0.0.1:1?token=x", timeout_s=0.5)


# ---------------------------------------------------------------------------
# JobManager.start_colab_job + reader thread
# ---------------------------------------------------------------------------


def test_start_colab_job_seeds_training_job(fake_tunnel, tmp_path: Path) -> None:
    from vrl_yolo.engine.training import JobManager

    _, tunnel_url = fake_tunnel
    manager = JobManager(storage_root=tmp_path)

    job = manager.start_colab_job(tunnel_url)
    assert job.is_colab is True
    assert job.task == "detect"
    assert job.epochs_total == 3
    assert job.imgsz == 640
    assert job.batch == 16
    assert job.accelerator_kind == "colab"
    assert job.output_dir.is_dir()
    # P6.fix-2: the worker reports "starting" until its training cell runs,
    # so the desktop must seed "queued" — NOT "running". Claiming "running"
    # here is the bug that made /train/run look frozen.
    assert job.status == "queued"


def test_start_event_flips_queued_to_running(fake_tunnel, tmp_path: Path) -> None:
    """P6.fix-2: a `start` event is what promotes queued → running.

    Drives the exact recovery path the bug report needs: connect before the
    notebook's training cell runs (job seeded "queued"), then run the cell
    (worker publishes `start`) and confirm the desktop job flips to running.
    """
    from vrl_yolo.engine.training import JobManager

    server, tunnel_url = fake_tunnel
    manager = JobManager(storage_root=tmp_path)

    job = manager.start_colab_job(tunnel_url)
    assert job.status == "queued"

    # The clinician runs cell 5 — the worker emits `start`.
    server.publish_event(
        "start",
        model="yolo26n.pt",
        task="detect",
        epochs=3,
        imgsz=640,
        batch=16,
        device=0,
    )

    deadline = time.time() + 5
    while time.time() < deadline:
        if job.status == "running":
            break
        time.sleep(0.1)

    assert job.status == "running"


def test_reader_thread_propagates_events(fake_tunnel, tmp_path: Path) -> None:
    from vrl_yolo.engine.training import JobManager

    server, tunnel_url = fake_tunnel
    manager = JobManager(storage_root=tmp_path)

    job = manager.start_colab_job(tunnel_url)

    # Publish a couple of events on the server side; the desktop's reader
    # thread should observe them and call job.append_event.
    server.publish_event("epoch", epoch=1, epoch_total=3, metrics={"mAP50": 0.5})
    server.publish_event("epoch", epoch=2, epoch_total=3, metrics={"mAP50": 0.7})

    # Poll for arrival (reader thread is async vs this test thread).
    deadline = time.time() + 5
    while time.time() < deadline:
        epoch_events = [e for e in job.events if e.get("type") == "epoch"]
        if len(epoch_events) >= 2:
            break
        time.sleep(0.1)

    epoch_events = [e for e in job.events if e.get("type") == "epoch"]
    assert len(epoch_events) >= 2
    assert epoch_events[-1]["epoch"] == 2
    assert job.epoch_current == 2
    assert job.metrics.mAP50 == 0.7


def test_terminal_event_flips_job_status(fake_tunnel, tmp_path: Path) -> None:
    from vrl_yolo.engine.training import JobManager

    server, tunnel_url = fake_tunnel
    manager = JobManager(storage_root=tmp_path)

    job = manager.start_colab_job(tunnel_url)

    # The runner finishes — server publishes `complete`.
    server.publish_event("complete", best_pt="/content/runs/x/weights/best.pt", metrics={"mAP50": 0.9})

    deadline = time.time() + 5
    while time.time() < deadline:
        if job.status == "completed":
            break
        time.sleep(0.1)

    assert job.status == "completed"
    assert job.metrics.mAP50 == 0.9


# ---------------------------------------------------------------------------
# Cancel + save-to-library branches
# ---------------------------------------------------------------------------


def test_cancel_routes_to_tunnel(fake_tunnel, tmp_path: Path) -> None:
    from vrl_yolo.engine.training import JobManager

    server, tunnel_url = fake_tunnel
    manager = JobManager(storage_root=tmp_path)

    job = manager.start_colab_job(tunnel_url)
    assert server.cancel_requested is False

    issued = manager.cancel(job.job_id)
    assert issued is True
    assert server.cancel_requested is True


def test_save_to_library_downloads_best_pt(fake_tunnel, tmp_path: Path) -> None:
    """Verify save_to_library lazy-downloads from the tunnel.

    Wire up a real ModelRegistry against a tmp storage dir so the copy
    step has a destination, then publish `complete` from the server
    side with a real on-disk file for the tunnel to serve as best.pt.
    """
    from vrl_yolo.engine.registry import ModelRegistry
    from vrl_yolo.engine.training import JobManager

    server, tunnel_url = fake_tunnel
    manager = JobManager(storage_root=tmp_path)
    registry = ModelRegistry(
        bundled_dir=tmp_path / "bundled",
        user_dir=tmp_path / "models",
    )
    (tmp_path / "bundled").mkdir(parents=True, exist_ok=True)
    (tmp_path / "models").mkdir(parents=True, exist_ok=True)

    job = manager.start_colab_job(tunnel_url)

    # Fake best.pt the server will hand out via GET /best.pt.
    fake_checkpoint = tmp_path / "fake-best.pt"
    fake_checkpoint.write_bytes(b"\x00" * 4096)  # registry rejects empty files
    server.publish_event(
        "complete",
        best_pt=str(fake_checkpoint),
        metrics={"mAP50": 0.91},
    )

    deadline = time.time() + 5
    while time.time() < deadline and job.status != "completed":
        time.sleep(0.1)
    assert job.status == "completed"

    # The registry can't actually load this fake .pt (it's not an
    # Ultralytics checkpoint), but the manager.save_to_library() flow
    # should still download + copy. We patch the registry scan to be
    # tolerant of the unloadable file by inspecting after the copy.
    try:
        manager.save_to_library(job.job_id, registry=registry)
    except Exception:  # noqa: BLE001
        # Registry rescan may fail on the dummy .pt — what matters is
        # the bytes landed in models/<task>/ before that.
        pass

    dest = tmp_path / "models" / "detect"
    # F2: filename is now the slugified job name (e.g.
    # `Detect-d6a1bf57-2026-05-21-15-30.pt`) instead of the old
    # `trained-<stub>.pt` shape. Glob any .pt to stay agnostic to the
    # exact default-name format — full slug semantics are exercised
    # in tests/test_training_naming.py.
    files = list(dest.glob("*.pt")) if dest.is_dir() else []
    assert files, "best.pt was not copied into models/detect/"
    assert files[0].read_bytes() == b"\x00" * 4096


# ---------------------------------------------------------------------------
# P6c: reconnect-with-backoff, cancel-during-backoff, auth abandonment,
# fetch retry. Each test exercises one of the failure modes covered in
# docs/PILOT-TEST.md.
# ---------------------------------------------------------------------------


def test_tunnel_drop_emits_reconnect_event(fake_tunnel, tmp_path: Path) -> None:
    """When uvicorn stops mid-run, the reader should announce reconnect.

    We don't need to test that reconnection *succeeds* — just that the
    backoff loop fires + emits a `connection` event so the desktop UI
    can show its banner.
    """
    from vrl_yolo.engine.training import JobManager

    server, tunnel_url = fake_tunnel
    manager = JobManager(storage_root=tmp_path)
    job = manager.start_colab_job(tunnel_url)

    # Wait for the reader to actually open the WS, then drop the tunnel.
    time.sleep(0.5)
    server.stop_uvicorn()

    # Backoff starts at 2 s; allow up to 5 s for the first reconnect
    # event to land after the WS read loop notices the close.
    deadline = time.time() + 6
    connection_events: list[dict] = []
    while time.time() < deadline:
        connection_events = [
            e for e in job.events if e.get("type") == "connection"
        ]
        if any(e.get("status") == "reconnecting" for e in connection_events):
            break
        time.sleep(0.2)

    statuses = [e.get("status") for e in connection_events]
    assert "reconnecting" in statuses, (
        f"expected a reconnecting event, got {statuses!r}"
    )
    # Stop the reader so it doesn't keep retrying for the rest of the
    # test session.
    assert job._reader_stop_event is not None
    job._reader_stop_event.set()


def test_cancel_during_backoff_flips_to_cancelled(fake_tunnel, tmp_path: Path) -> None:
    """A cancel mid-backoff should exit cleanly + mark the job cancelled."""
    from vrl_yolo.engine.training import JobManager

    server, tunnel_url = fake_tunnel
    manager = JobManager(storage_root=tmp_path)
    job = manager.start_colab_job(tunnel_url)

    time.sleep(0.5)
    server.stop_uvicorn()  # force the reader into backoff

    # Wait until the reader has at least started its first backoff sleep.
    deadline = time.time() + 6
    while time.time() < deadline:
        if any(
            e.get("type") == "connection" and e.get("status") == "reconnecting"
            for e in job.events
        ):
            break
        time.sleep(0.2)

    manager.cancel(job.job_id)

    deadline = time.time() + 3
    while time.time() < deadline:
        if job.status == "cancelled":
            break
        time.sleep(0.1)

    assert job.status == "cancelled"


def test_preflight_classifies_401_as_auth(fake_tunnel) -> None:
    """The reader's pre-flight must return ``auth`` for HTTP 401.

    This is the contract the reconnect loop relies on to abandon retry
    when the notebook cell is restarted with a new token — auth
    failures don't get better with backoff. We verify it directly
    against a live ColabServer using a deliberately-wrong token.
    """
    from vrl_yolo.engine.colab import ColabSession, ColabStatus
    from vrl_yolo.engine.colab_reader import _preflight

    _, tunnel_url = fake_tunnel
    base = tunnel_url.split("?", 1)[0]

    wrong_token_session = ColabSession(
        base_url=base,
        token="not-the-real-token",
        initial_status=ColabStatus(
            task="detect",
            model="x",
            status="running",
            epoch=0,
            epochs_total=1,
            imgsz=640,
            batch=8,
            best_pt_available=False,
            error_message=None,
        ),
    )

    assert _preflight(wrong_token_session) == "auth"


def test_preflight_classifies_unreachable_as_network() -> None:
    """And network errors (connection refused) must classify as ``network``.

    Same contract from the other angle — the reader needs to retry on
    these. Uses port 1 (no listener) for a fast URLError.
    """
    from vrl_yolo.engine.colab import ColabSession, ColabStatus
    from vrl_yolo.engine.colab_reader import _preflight

    dead_session = ColabSession(
        base_url="http://127.0.0.1:1",
        token="anything",
        initial_status=ColabStatus(
            task="detect",
            model="x",
            status="running",
            epoch=0,
            epochs_total=1,
            imgsz=640,
            batch=8,
            best_pt_available=False,
            error_message=None,
        ),
    )

    assert _preflight(dead_session) == "network"


# ---------------------------------------------------------------------------
# fetch_best_pt retry semantics — unit-style, no live server needed.
# ---------------------------------------------------------------------------


def test_fetch_best_pt_retries_on_transient_error(monkeypatch, tmp_path: Path) -> None:
    """Two failed attempts then a success should yield a downloaded file.

    We monkeypatch ``_stream_best_pt_once`` rather than the lower-level
    urllib so the retry-loop wiring (sleep, attempt counter, success
    return) is the only thing under test.
    """
    from vrl_yolo.engine import colab as colab_module
    from vrl_yolo.engine.colab import (
        ColabConnectError,
        ColabSession,
        ColabStatus,
        fetch_best_pt,
    )

    monkeypatch.setattr(colab_module, "FETCH_BACKOFF_INITIAL_S", 0.01)
    monkeypatch.setattr(colab_module, "FETCH_BACKOFF_FACTOR", 1.0)

    session = ColabSession(
        base_url="http://127.0.0.1:1",
        token="t",
        initial_status=ColabStatus(
            task="detect",
            model="x",
            status="running",
            epoch=0,
            epochs_total=1,
            imgsz=640,
            batch=8,
            best_pt_available=False,
            error_message=None,
        ),
    )

    attempts = {"n": 0}

    def fake_stream(_session, dest: Path, *, timeout_s: float) -> None:
        attempts["n"] += 1
        if attempts["n"] < 3:
            err = ColabConnectError("simulated transient failure")
            err.retryable = True  # type: ignore[attr-defined]
            raise err
        dest.write_bytes(b"OK")

    monkeypatch.setattr(colab_module, "_stream_best_pt_once", fake_stream)

    dest = tmp_path / "best.pt"
    result = fetch_best_pt(session, dest)

    assert result == dest
    assert dest.read_bytes() == b"OK"
    assert attempts["n"] == 3


def test_fetch_best_pt_fails_fast_on_non_retryable(monkeypatch, tmp_path: Path) -> None:
    """409 / 401 / disk errors should NOT be retried."""
    from vrl_yolo.engine import colab as colab_module
    from vrl_yolo.engine.colab import (
        ColabConnectError,
        ColabSession,
        ColabStatus,
        fetch_best_pt,
    )

    session = ColabSession(
        base_url="http://127.0.0.1:1",
        token="t",
        initial_status=ColabStatus(
            task="detect",
            model="x",
            status="done",
            epoch=1,
            epochs_total=1,
            imgsz=640,
            batch=8,
            best_pt_available=True,
            error_message=None,
        ),
    )

    attempts = {"n": 0}

    def fake_stream(_session, _dest, *, timeout_s: float) -> None:
        attempts["n"] += 1
        err = ColabConnectError("trained model isn't ready yet")
        err.retryable = False  # type: ignore[attr-defined]
        raise err

    monkeypatch.setattr(colab_module, "_stream_best_pt_once", fake_stream)

    with pytest.raises(ColabConnectError, match="isn't ready"):
        fetch_best_pt(session, tmp_path / "best.pt")
    assert attempts["n"] == 1  # no retry
