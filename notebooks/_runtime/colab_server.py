"""FastAPI mini-server that exposes a Colab training job to the desktop.

Routes (all require `?token=<session_token>` — see `docs/PLAN-P6.md` §4.6):

- ``GET  /status``  — current state JSON; called by the desktop's
                       `connect()` as a pre-flight check before opening
                       the WebSocket.
- ``WS   /events``  — broadcast of every event the runner emits.
                       Newly-connecting clients also get a replay of
                       events since the run started so refreshing the
                       desktop mid-run doesn't lose history.
- ``GET  /best.pt`` — one-shot file download once training completes.
- ``POST /cancel``  — request the runner to stop. Idempotent.

Lifecycle (driven by the notebook cell):

1. Notebook constructs ``ColabServer(token=..., task=..., epochs=...)``.
2. Notebook calls ``server.start_uvicorn(port=8765)``  — uvicorn runs in
   a daemon thread so the cell keeps control.
3. Notebook calls ``server.run_training_blocking(...)`` — this is where
   `ultralytics.YOLO(...).train(...)` is invoked. The training callback
   hands events to ``server.publish_event(...)`` which queues them for
   the WS fan-out.
4. When training returns, ``server.set_complete(best_pt=...)`` flips
   ``/status`` to ``done`` and arms ``/best.pt``.

This file is deliberately self-contained — the only project import is
``_runner_common`` (re-exported via ``colab_runner.py``). Everything
runs under Python 3.10+ that's available in a Colab notebook.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, AsyncIterator, Deque

import uvicorn
from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse

logger = logging.getLogger("vrl_yolo_gui.colab_server")


@dataclass
class JobState:
    """Snapshot of the current Colab training job."""

    task: str  # "detect" | "classify"
    model: str
    epochs_total: int
    status: str = "starting"  # starting | running | done | cancelled | error
    epoch: int = 0
    metrics: dict[str, float | None] = field(default_factory=dict)
    started_at: float = field(default_factory=time.time)
    finished_at: float | None = None
    best_pt: str | None = None
    error_message: str | None = None
    # Bounded log of events for late-connecting WS clients. 4096 is
    # plenty for a normal 50-epoch run with per-epoch + log events.
    event_log: Deque[dict[str, Any]] = field(default_factory=lambda: deque(maxlen=4096))


class ColabServer:
    """Owns the FastAPI app, JobState, and the event fan-out queue."""

    def __init__(
        self,
        *,
        token: str,
        task: str,
        model: str,
        epochs: int,
    ) -> None:
        if not token:
            raise ValueError("token is required (use secrets.token_urlsafe(16))")
        self._token = token
        self._state = JobState(task=task, model=model, epochs_total=epochs)
        self._cancel_event = threading.Event()
        self._lock = threading.Lock()
        self._subscribers: list[asyncio.Queue[dict[str, Any]]] = []
        self._loop: asyncio.AbstractEventLoop | None = None
        self._uvicorn_server: uvicorn.Server | None = None
        self._startup_ready: threading.Event | None = None
        self.app = self._build_app()

    # ------------------------------------------------------------------
    # Lifecycle hooks called from the notebook / runner
    # ------------------------------------------------------------------

    @property
    def token(self) -> str:
        return self._token

    @property
    def cancel_requested(self) -> bool:
        return self._cancel_event.is_set()

    def publish_event(self, event_type: str, **fields: Any) -> None:
        """Thread-safe event publisher. Called from the runner thread.

        Updates JobState then enqueues into every subscriber's queue
        via ``loop.call_soon_threadsafe`` (since we're crossing the
        thread → asyncio boundary).
        """
        payload = {"_VRL_EVENT": True, "type": event_type, "ts": time.time(), **fields}

        with self._lock:
            self._state.event_log.append(payload)
            if event_type == "start":
                self._state.status = "running"
            elif event_type == "epoch":
                self._state.epoch = int(payload.get("epoch", self._state.epoch))
                metrics = payload.get("metrics") or {}
                if isinstance(metrics, dict):
                    self._state.metrics = metrics
            elif event_type == "complete":
                self._state.status = "done"
                self._state.finished_at = time.time()
                best = payload.get("best_pt")
                if isinstance(best, str):
                    self._state.best_pt = best
                final_metrics = payload.get("metrics") or {}
                if isinstance(final_metrics, dict) and final_metrics:
                    self._state.metrics = final_metrics
            elif event_type == "cancelled":
                self._state.status = "cancelled"
                self._state.finished_at = time.time()
            elif event_type == "error":
                self._state.status = "error"
                self._state.finished_at = time.time()
                msg = payload.get("message")
                if isinstance(msg, str):
                    self._state.error_message = msg

        loop = self._loop
        if loop is None:
            return
        for q in list(self._subscribers):
            try:
                loop.call_soon_threadsafe(q.put_nowait, payload)
            except RuntimeError:
                # Loop closed mid-shutdown — fine to drop.
                pass

    def start_uvicorn(self, *, host: str = "127.0.0.1", port: int = 8765) -> None:
        """Run uvicorn in a daemon thread; block until the server reports ready.

        Captures the asyncio event loop at startup so ``publish_event``
        (which runs on the training thread) can hand events to async
        subscribers via ``call_soon_threadsafe``.
        """
        ready = threading.Event()
        self._startup_ready = ready  # consumed by the lifespan in _build_app

        config = uvicorn.Config(
            self.app,
            host=host,
            port=port,
            log_level="warning",
            access_log=False,
            lifespan="on",
        )
        self._uvicorn_server = uvicorn.Server(config)

        def _run() -> None:
            try:
                self._uvicorn_server.run()  # type: ignore[union-attr]
            except Exception:  # noqa: BLE001
                logger.exception("uvicorn exited unexpectedly")
            finally:
                # Unblock the waiter if startup failed before the lifespan ran.
                ready.set()

        threading.Thread(target=_run, name="colab-uvicorn", daemon=True).start()
        if not ready.wait(timeout=15):
            raise RuntimeError("uvicorn did not start within 15 seconds")

    def stop_uvicorn(self) -> None:
        if self._uvicorn_server is not None:
            self._uvicorn_server.should_exit = True

    # ------------------------------------------------------------------
    # FastAPI app construction
    # ------------------------------------------------------------------

    def _build_app(self) -> FastAPI:
        server_self = self

        @contextlib.asynccontextmanager
        async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
            server_self._loop = asyncio.get_running_loop()
            ready = getattr(server_self, "_startup_ready", None)
            if ready is not None:
                ready.set()
            try:
                yield
            finally:
                server_self._loop = None

        app = FastAPI(
            title="VRL-YOLO-GUI Colab worker",
            docs_url=None,
            redoc_url=None,
            lifespan=lifespan,
        )

        def _require_token(token: str | None) -> None:
            if not token or token != self._token:
                # Identical error for missing + wrong so the response
                # can't be used as a token oracle.
                raise HTTPException(status_code=401, detail="invalid or missing token")

        @app.get("/status")
        def get_status(token: str = Query(default=None)) -> JSONResponse:
            _require_token(token)
            with self._lock:
                s = self._state
                body = {
                    "task": s.task,
                    "model": s.model,
                    "status": s.status,
                    "epoch": s.epoch,
                    "epochs_total": s.epochs_total,
                    "metrics": s.metrics,
                    "started_at": s.started_at,
                    "finished_at": s.finished_at,
                    "best_pt_available": s.best_pt is not None
                    and Path(s.best_pt).is_file(),
                    "error_message": s.error_message,
                }
            return JSONResponse(body)

        @app.get("/best.pt")
        def get_best_pt(token: str = Query(default=None)) -> FileResponse:
            _require_token(token)
            with self._lock:
                best = self._state.best_pt
            if not best or not Path(best).is_file():
                raise HTTPException(
                    status_code=409,
                    detail="best.pt not available yet (training not complete)",
                )
            return FileResponse(
                best,
                media_type="application/octet-stream",
                filename="best.pt",
            )

        @app.post("/cancel")
        def post_cancel(token: str = Query(default=None)) -> JSONResponse:
            _require_token(token)
            self._cancel_event.set()
            return JSONResponse({"cancel_requested": True})

        @app.websocket("/events")
        async def ws_events(websocket: WebSocket, token: str = Query(default=None)) -> None:
            if not token or token != self._token:
                await websocket.close(code=4401)  # custom code: unauthorized
                return
            await websocket.accept()
            queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()

            with self._lock:
                replay = list(self._state.event_log)
            for payload in replay:
                try:
                    await websocket.send_json(payload)
                except Exception:  # noqa: BLE001
                    return

            self._subscribers.append(queue)
            try:
                while True:
                    payload = await queue.get()
                    await websocket.send_json(payload)
            except WebSocketDisconnect:
                pass
            except Exception:  # noqa: BLE001
                logger.exception("WS /events broadcaster crashed")
            finally:
                try:
                    self._subscribers.remove(queue)
                except ValueError:
                    pass

        return app
