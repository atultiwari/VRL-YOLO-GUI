"""End-to-end smoke tests for the Colab mini-server.

Verifies (without Cloudflare, without Colab, without Ultralytics):

- ``/status`` enforces tokens and returns the expected JSON shape.
- ``/events`` rejects unauthorized WS handshakes and broadcasts every
  published event (including replay-on-connect for late subscribers).
- ``/best.pt`` returns 409 before training completes and serves the
  file with a 200 once ``set_complete`` (via ``publish_event("complete"``)
  fires.
- ``/cancel`` flips the cancellation flag.

This is the P6a verification described in ``docs/PLAN-P6.md`` §3 —
"manual curl from a terminal proves the notebook runtime is correct."

Run: ``uv run --extra ml pytest tests/test_colab_server_smoke.py -q``
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

import pytest

NOTEBOOKS_DIR = Path(__file__).resolve().parent.parent / "notebooks"
if str(NOTEBOOKS_DIR) not in sys.path:
    sys.path.insert(0, str(NOTEBOOKS_DIR))


def _free_port() -> int:
    import socket

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


@pytest.fixture
def live_server(tmp_path: Path):
    """Spin up a real uvicorn ColabServer; tear it down after the test."""
    from _runtime.colab_server import ColabServer  # type: ignore[import-not-found]

    server = ColabServer(
        token="test-token-abc123",
        task="detect",
        model="yolo26n.pt",
        epochs=3,
        imgsz=640,
        batch=16,
    )
    port = _free_port()
    server.start_uvicorn(port=port)
    base = f"http://127.0.0.1:{port}"
    try:
        yield server, base, "test-token-abc123"
    finally:
        server.stop_uvicorn()
        # Give uvicorn ~1 s to drain.
        time.sleep(0.5)


def test_status_rejects_missing_or_wrong_token(live_server) -> None:
    import urllib.error
    import urllib.request

    _, base, _ = live_server

    for url in (f"{base}/status", f"{base}/status?token=wrong"):
        with pytest.raises(urllib.error.HTTPError) as exc:
            urllib.request.urlopen(url, timeout=2)
        assert exc.value.code == 401


def test_status_returns_initial_shape(live_server) -> None:
    import json
    import urllib.request

    _, base, token = live_server

    with urllib.request.urlopen(f"{base}/status?token={token}", timeout=2) as resp:
        body = json.loads(resp.read())

    assert body["task"] == "detect"
    assert body["model"] == "yolo26n.pt"
    assert body["status"] == "starting"
    assert body["epoch"] == 0
    assert body["epochs_total"] == 3
    assert body["imgsz"] == 640
    assert body["batch"] == 16
    assert body["best_pt_available"] is False


def test_publish_event_flips_status_to_running(live_server) -> None:
    import json
    import urllib.request

    server, base, token = live_server

    server.publish_event("start", model="yolo26n.pt", task="detect")
    with urllib.request.urlopen(f"{base}/status?token={token}", timeout=2) as resp:
        body = json.loads(resp.read())
    assert body["status"] == "running"


def test_best_pt_409_before_complete(live_server) -> None:
    import urllib.error
    import urllib.request

    _, base, token = live_server

    with pytest.raises(urllib.error.HTTPError) as exc:
        urllib.request.urlopen(f"{base}/best.pt?token={token}", timeout=2)
    assert exc.value.code == 409


def test_best_pt_serves_file_after_complete(live_server, tmp_path: Path) -> None:
    import urllib.request

    server, base, token = live_server

    fake_best = tmp_path / "best.pt"
    fake_best.write_bytes(b"GGUF-style-fake-checkpoint")

    server.publish_event("complete", best_pt=str(fake_best), metrics={"mAP50": 0.9})

    with urllib.request.urlopen(f"{base}/best.pt?token={token}", timeout=2) as resp:
        assert resp.status == 200
        assert resp.read() == b"GGUF-style-fake-checkpoint"


def test_cancel_sets_flag(live_server) -> None:
    import urllib.request

    server, base, token = live_server

    assert server.cancel_requested is False
    req = urllib.request.Request(f"{base}/cancel?token={token}", method="POST")
    with urllib.request.urlopen(req, timeout=2) as resp:
        assert resp.status == 200
    assert server.cancel_requested is True


def test_events_ws_rejects_missing_token(live_server) -> None:
    import asyncio

    try:
        import websockets
    except ImportError:
        pytest.skip("websockets not available")

    _, base, _ = live_server
    ws_url = base.replace("http://", "ws://") + "/events"

    async def _connect() -> None:
        async with websockets.connect(ws_url) as ws:  # noqa: F841
            pass

    with pytest.raises(Exception):
        asyncio.run(_connect())


def test_events_ws_replays_log_and_streams_live(live_server) -> None:
    import asyncio
    import json

    try:
        import websockets
    except ImportError:
        pytest.skip("websockets not available")

    server, base, token = live_server
    ws_url = base.replace("http://", "ws://") + f"/events?token={token}"

    # Publish 2 events BEFORE the WS subscribes — these should replay.
    server.publish_event("start", model="yolo26n.pt")
    server.publish_event("epoch", epoch=1, epoch_total=3, metrics={"mAP50": 0.5})

    received: list[dict] = []

    async def _recv() -> None:
        async with websockets.connect(ws_url) as ws:
            # Replay (2 events).
            for _ in range(2):
                msg = await asyncio.wait_for(ws.recv(), timeout=3)
                received.append(json.loads(msg))
            # Live (1 event published after subscribe).
            server.publish_event("epoch", epoch=2, epoch_total=3, metrics={"mAP50": 0.7})
            msg = await asyncio.wait_for(ws.recv(), timeout=3)
            received.append(json.loads(msg))

    asyncio.run(_recv())

    assert [e["type"] for e in received] == ["start", "epoch", "epoch"]
    assert received[1]["epoch"] == 1
    assert received[2]["epoch"] == 2
