"""WebSocket reader thread for Colab-backed training jobs.

Lives in its own module so ``engine/training.py`` doesn't import
``websockets`` at module load time — the import is only paid when a
Colab job actually starts.

For each Colab job, ``spawn_colab_reader`` starts a daemon thread that
opens a sync WebSocket to ``<tunnel>/events?token=...``, reads JSON
events, and hands each one to ``job.append_event`` — the exact same
code path the local subprocess reader uses, so the downstream
``/api/training/{id}/stream`` fan-out sees no difference.

Resilience (P6c):

- The thread auto-reconnects with exponential backoff (2s → 60s,
  ~20 attempts ≈ 18 min total) when the WS drops mid-run. Each
  attempt does a quick ``GET /status?token=...`` pre-flight first so
  we can distinguish three failure modes:

  - **Auth** (HTTP 401): the notebook cell was restarted and the
    token changed. There's no recovery — abandon immediately and
    surface a clear message telling the clinician to re-paste the
    new URL.
  - **Network** (HTTP error, URLError, connection refused): the
    notebook cell is probably still running but the tunnel is
    transient-down. Sleep, retry, emit ``connection`` events the
    desktop UI uses to show a reconnect banner.
  - **OK**: proceed to open the WS.

- A ``stop_event`` (set by ``JobManager.cancel``) breaks out of any
  backoff sleep or read loop cleanly + flips the job to ``cancelled``.

- When all reconnect attempts are exhausted or an auth failure is
  detected, the thread synthesises a terminal event so the desktop
  UI flips out of live-charts state instead of spinning forever.
"""

from __future__ import annotations

import json
import logging
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import TYPE_CHECKING, Literal

if TYPE_CHECKING:
    from vrl_yolo.engine.colab import ColabSession
    from vrl_yolo.engine.training import TrainingJob


logger = logging.getLogger(__name__)


_TERMINAL_EVENT_TYPES = {"complete", "cancelled", "error"}

# Backoff schedule. 20 attempts at 2/4/8/16/32/60/60/... totals ~18 min
# before giving up — long enough to ride out a Colab GC pause, short
# enough that a dead cell doesn't keep the desktop spinning all night.
_BACKOFF_INITIAL_S = 2.0
_BACKOFF_FACTOR = 2.0
_BACKOFF_CAP_S = 60.0
_BACKOFF_MAX_ATTEMPTS = 20

# Pre-flight HTTP timeout — short, since the actual WS open does
# the heavy lifting and a slow pre-flight just wastes the backoff slot.
_PREFLIGHT_TIMEOUT_S = 3.0


PreflightResult = Literal["ok", "auth", "network"]


@dataclass
class _Backoff:
    """Tiny exponential-backoff helper with attempt cap.

    ``advance()`` returns False once ``max_attempts`` is exhausted so
    the caller can abandon. ``reset()`` zeroes the counter — used when
    a connection succeeds so the next disconnect starts fresh.
    """

    initial: float = _BACKOFF_INITIAL_S
    factor: float = _BACKOFF_FACTOR
    cap: float = _BACKOFF_CAP_S
    max_attempts: int = _BACKOFF_MAX_ATTEMPTS
    attempt: int = 0

    @property
    def current_delay(self) -> float:
        if self.attempt <= 0:
            return self.initial
        return min(self.cap, self.initial * (self.factor ** (self.attempt - 1)))

    def advance(self) -> bool:
        if self.attempt >= self.max_attempts:
            return False
        self.attempt += 1
        return True

    def reset(self) -> None:
        self.attempt = 0


def spawn_colab_reader(
    job: "TrainingJob",
    session: "ColabSession",
    stop_event: threading.Event | None = None,
) -> threading.Thread:
    """Start the reader thread for ``job``.

    ``stop_event`` is set by the job manager's cancel path so the
    reader exits cleanly mid-backoff. Returns the started ``Thread`` so
    callers can join it in tests; in production the thread is daemon
    so it dies with the parent process.
    """
    if stop_event is None:
        stop_event = threading.Event()
    thread = threading.Thread(
        target=_reader_loop,
        args=(job, session, stop_event),
        name=f"colab-reader-{job.job_id[:8]}",
        daemon=True,
    )
    thread.start()
    return thread


def _reader_loop(
    job: "TrainingJob",
    session: "ColabSession",
    stop_event: threading.Event,
) -> None:
    """Foreground of the reader thread.

    Outer loop: pre-flight → open WS → read until WS closes →
    classify the close → either announce terminal or back off + retry.
    """
    try:
        from websockets.sync.client import connect as ws_connect  # type: ignore[import-not-found]
    except Exception as exc:  # noqa: BLE001
        job.append_event(
            {
                "type": "error",
                "ts": time.time(),
                "message": f"websockets library missing: {exc}",
            }
        )
        return

    backoff = _Backoff()
    saw_terminal = False
    had_disconnect = False

    while not stop_event.is_set():
        preflight = _preflight(session)
        if preflight == "auth":
            job.append_event(
                {
                    "type": "connection",
                    "ts": time.time(),
                    "status": "abandoned",
                    "attempt": backoff.attempt,
                    "message": (
                        "Colab session no longer accepts the token — the "
                        "notebook cell was restarted and a new token is "
                        "live. Re-paste the new URL from the cell."
                    ),
                }
            )
            if not _is_terminal_status(job):
                job.append_event(
                    {
                        "type": "error",
                        "ts": time.time(),
                        "message": (
                            "Colab session token changed (cell restarted). "
                            "Re-paste the new URL from the cell."
                        ),
                    }
                )
            return

        if preflight == "network":
            if not backoff.advance():
                _abandon_after_exhausted_retries(job, backoff)
                return
            had_disconnect = True
            delay_s = backoff.current_delay
            job.append_event(
                {
                    "type": "connection",
                    "ts": time.time(),
                    "status": "reconnecting",
                    "attempt": backoff.attempt,
                    "delay_s": delay_s,
                    "message": (
                        f"Reconnecting to Colab (attempt {backoff.attempt}, "
                        f"backing off {delay_s:.0f}s)…"
                    ),
                }
            )
            if stop_event.wait(delay_s):
                break  # cancel during backoff
            continue

        # Pre-flight succeeded.
        if had_disconnect:
            job.append_event(
                {
                    "type": "connection",
                    "ts": time.time(),
                    "status": "reconnected",
                    "attempt": backoff.attempt,
                    "message": "Reconnected to Colab.",
                }
            )
            backoff.reset()
            had_disconnect = False

        try:
            with ws_connect(
                session.events_ws_url,
                max_size=2**24,  # 16 MiB — generous for replayed log lines
                open_timeout=10,
            ) as ws:
                for raw in ws:
                    if stop_event.is_set():
                        break
                    event = _parse_event(raw)
                    if event is None:
                        continue
                    job.append_event(event)
                    if event.get("type") in _TERMINAL_EVENT_TYPES:
                        saw_terminal = True
                        break
        except Exception as exc:  # noqa: BLE001
            logger.debug("colab WS read loop ended: %s", exc)
            had_disconnect = True
            # Fall through — outer loop's pre-flight will classify whether
            # this is a transient drop (retry) or auth (abandon).
            continue

        if saw_terminal or stop_event.is_set():
            break

        # WS closed without a terminal event and not by cancel — treat
        # as a drop and let the outer loop reconnect.
        had_disconnect = True

    if stop_event.is_set() and not saw_terminal and not _is_terminal_status(job):
        # Cancel won the race against a terminal event. Mark as
        # cancelled — the manager's POST /cancel may or may not have
        # been delivered, but the user explicitly asked us to stop.
        job.append_event(
            {
                "type": "cancelled",
                "ts": time.time(),
                "message": "Cancelled by desktop.",
            }
        )


def _preflight(session: "ColabSession") -> PreflightResult:
    """Quick HTTP probe — categorises connection feasibility.

    Returns ``"auth"`` for HTTP 401 (token mismatch — unrecoverable),
    ``"network"`` for any other HTTP error / network failure
    (retryable), and ``"ok"`` if the tunnel is reachable and answering
    with a 200.
    """
    url = (
        f"{session.base_url}/status?token={urllib.parse.quote(session.token)}"
    )
    try:
        with urllib.request.urlopen(url, timeout=_PREFLIGHT_TIMEOUT_S) as resp:
            resp.read()
    except urllib.error.HTTPError as exc:
        if exc.code == 401:
            return "auth"
        return "network"
    except urllib.error.URLError:
        return "network"
    except Exception:  # noqa: BLE001
        return "network"
    return "ok"


def _abandon_after_exhausted_retries(job: "TrainingJob", backoff: _Backoff) -> None:
    """Emit terminal events when reconnect attempts run out."""
    job.append_event(
        {
            "type": "connection",
            "ts": time.time(),
            "status": "abandoned",
            "attempt": backoff.attempt,
            "message": (
                "Couldn't reach the Colab session after "
                f"{backoff.attempt} attempts. The notebook cell has "
                "likely stopped — re-run it and reconnect."
            ),
        }
    )
    if not _is_terminal_status(job):
        job.append_event(
            {
                "type": "error",
                "ts": time.time(),
                "message": (
                    "Lost connection to Colab session. Re-run the "
                    "notebook cell and paste the new URL to continue."
                ),
            }
        )


def _parse_event(raw: object) -> dict | None:
    """Coerce a WS frame into a dict event, or None if it's not parsable."""
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
        data.pop("_VRL_EVENT", None)
        return data
    return None


def _is_terminal_status(job: "TrainingJob") -> bool:
    with job._lock:  # noqa: SLF001 - mirrors the reader pattern in training.py
        return job.status in {"completed", "failed", "cancelled"}
