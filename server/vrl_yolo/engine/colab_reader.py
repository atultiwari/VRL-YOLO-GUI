"""WebSocket reader thread for Colab-backed training jobs.

Lives in its own module so ``engine/training.py`` doesn't import
``websockets`` at module load time — the import is only paid when a
Colab job actually starts.

For each Colab job, ``spawn_colab_reader`` starts a daemon thread that:

1. Opens a sync WebSocket to ``<tunnel>/events?token=...``.
2. Reads JSON events, hands each one to ``job.append_event`` — the
   exact same code path the local subprocess reader uses, so the
   downstream WebSocket fan-out and ``/api/training/{id}/stream``
   handler see no difference.
3. Exits when a terminal event lands (``complete``/``cancelled``/``error``),
   or when the Colab cell stops and the WS closes. If the job is still
   ``running`` at exit time, we synthesise an ``error`` event so the
   desktop UI flips out of the live-charts state cleanly instead of
   spinning forever.
"""

from __future__ import annotations

import json
import logging
import threading
import time
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from vrl_yolo.engine.colab import ColabSession
    from vrl_yolo.engine.training import TrainingJob


logger = logging.getLogger(__name__)


_TERMINAL_EVENT_TYPES = {"complete", "cancelled", "error"}


def spawn_colab_reader(job: "TrainingJob", session: "ColabSession") -> threading.Thread:
    """Start the reader thread for ``job``.

    Returns the started ``Thread`` so callers can join it in tests; in
    production the thread is daemon so it dies with the parent process.
    """
    thread = threading.Thread(
        target=_reader_loop,
        args=(job, session),
        name=f"colab-reader-{job.job_id[:8]}",
        daemon=True,
    )
    thread.start()
    return thread


def _reader_loop(job: "TrainingJob", session: "ColabSession") -> None:
    """Foreground of the reader thread.

    Uses ``websockets.sync.client.connect``; the project already pins
    ``websockets>=13.1`` (see ``pyproject.toml``) for the FastAPI WS
    layer, so no new dependency.
    """
    try:
        from websockets.sync.client import connect  # type: ignore[import-not-found]
    except Exception as exc:  # noqa: BLE001
        # Should never happen with our pinned deps, but degrade
        # gracefully rather than crashing the whole job manager.
        job.append_event(
            {
                "type": "error",
                "ts": time.time(),
                "message": f"websockets library missing: {exc}",
            }
        )
        return

    saw_terminal = False
    try:
        with connect(
            session.events_ws_url,
            max_size=2**24,  # 16 MiB — generous for replayed log lines
            open_timeout=10,
        ) as ws:
            for raw in ws:
                event = _parse_event(raw)
                if event is None:
                    continue
                job.append_event(event)
                if event.get("type") in _TERMINAL_EVENT_TYPES:
                    saw_terminal = True
                    # Drain a moment in case the server sent more events
                    # right after, then exit cleanly.
                    break
    except Exception as exc:  # noqa: BLE001
        # Most common case: Colab cell stopped (tunnel dropped) before
        # a terminal event arrived. Synthesise one so the UI doesn't
        # spin on "running" forever.
        if not _is_terminal_status(job):
            job.append_event(
                {
                    "type": "error",
                    "ts": time.time(),
                    "message": (
                        "Lost connection to Colab session "
                        f"({type(exc).__name__}: {exc}). "
                        "Re-run the notebook cell and reconnect."
                    ),
                }
            )
        else:
            logger.debug("colab reader saw exception after terminal event: %s", exc)
        return

    # Clean exit. If we never saw a terminal event but the WS closed,
    # synthesise one — same reasoning as the exception path above.
    if not saw_terminal and not _is_terminal_status(job):
        job.append_event(
            {
                "type": "error",
                "ts": time.time(),
                "message": (
                    "Colab session ended without finishing training. "
                    "Re-run the notebook cell and reconnect."
                ),
            }
        )


def _parse_event(raw: object) -> dict | None:
    """Coerce a WS frame into a dict event, or None if it's not parsable.

    Frames come through as ``str`` (server uses ``send_json``). Bytes
    would mean the server sent binary — unexpected, but tolerated.
    """
    if isinstance(raw, bytes):
        try:
            raw = raw.decode("utf-8")
        except UnicodeDecodeError:
            return None
    if not isinstance(raw, str):
        return None
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return None
    if isinstance(data, dict):
        # Strip the sentinel so downstream consumers don't carry it.
        data.pop("_VRL_EVENT", None)
        return data
    return None


def _is_terminal_status(job: "TrainingJob") -> bool:
    with job._lock:  # noqa: SLF001 - mirrors the reader pattern in training.py
        return job.status in {"completed", "failed", "cancelled"}
