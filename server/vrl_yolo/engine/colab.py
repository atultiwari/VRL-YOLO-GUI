"""Desktop-side bridge to a Colab training session.

Counterpart to ``notebooks/_runtime/colab_server.py`` that runs inside
the Colab cell. The clinician pastes a tunnel URL like::

    https://abc-def-ghi.trycloudflare.com?token=AbCdEf1234567890

into the *Connect to Colab* modal; this module:

1. Splits the URL into base + token.
2. Does a 3-second ``GET /status?token=...`` pre-flight so a stale URL
   surfaces a clear modal error instead of opening a dead WebSocket.
3. Returns a ``ColabSession`` the caller can hand to the
   ``JobManager`` so the WebSocket reader can translate remote events
   into ``TrainingJob.append_event`` calls — same shape the local
   subprocess reader uses.

Cancellation: ``POST /cancel?token=...``. Save-to-library:
``GET /best.pt?token=...`` streamed to disk.

We use ``urllib`` for the HTTP calls (stdlib only) and the existing
``websockets`` dependency for the WebSocket. No new packages.
"""

from __future__ import annotations

import json
import logging
import shutil
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any


logger = logging.getLogger(__name__)


PREFLIGHT_TIMEOUT_S = 3.0
FETCH_TIMEOUT_S = 30.0
# Best.pt is 5-80 MB on a 50 Mbps tunnel — should complete in seconds.
# Free Colab can blip every few minutes; 3 retries with 2/4/8 s back-off
# rides through transient failures without making the user re-click Save.
FETCH_MAX_ATTEMPTS = 3
FETCH_BACKOFF_INITIAL_S = 2.0
FETCH_BACKOFF_FACTOR = 2.0


@dataclass(frozen=True)
class ColabStatus:
    """Snapshot of the remote ``/status`` response at connect time."""

    task: str  # "detect" | "classify"
    model: str
    status: str  # "starting" | "running" | "done" | "cancelled" | "error"
    epoch: int
    epochs_total: int
    imgsz: int
    batch: int
    best_pt_available: bool
    error_message: str | None


@dataclass(frozen=True)
class ColabSession:
    """A validated, ready-to-use connection to a Colab worker.

    ``base_url`` is the tunnel's HTTP origin (no path, no query string);
    ``token`` is the shared secret parsed from the URL the user pasted.
    ``initial_status`` is the response from the pre-flight ``GET /status``
    — the caller uses it to populate the TrainingJob shape.
    """

    base_url: str
    token: str
    initial_status: ColabStatus

    @property
    def events_ws_url(self) -> str:
        ws_base = self.base_url.replace("http://", "ws://", 1).replace(
            "https://", "wss://", 1
        )
        return f"{ws_base}/events?token={urllib.parse.quote(self.token)}"

    def _signed_url(self, path: str) -> str:
        return f"{self.base_url}{path}?token={urllib.parse.quote(self.token)}"

    def cancel_url(self) -> str:
        return self._signed_url("/cancel")

    def best_pt_url(self) -> str:
        return self._signed_url("/best.pt")

    def status_url(self) -> str:
        return self._signed_url("/status")


class ColabConnectError(Exception):
    """Connect failed for a reason worth surfacing to the clinician."""


def _split_url(raw: str) -> tuple[str, str]:
    """Split the pasted URL into (base_url, token).

    Accepts both ``https://host?token=foo`` and ``https://host/path?token=foo``;
    strips trailing slash from the base. Raises ``ColabConnectError`` if
    the URL is malformed or has no token.
    """
    raw = (raw or "").strip()
    if not raw:
        raise ColabConnectError("Tunnel URL is empty.")
    try:
        parsed = urllib.parse.urlparse(raw)
    except ValueError as exc:
        raise ColabConnectError(f"Invalid URL: {exc}") from exc

    if parsed.scheme not in ("http", "https"):
        raise ColabConnectError(
            "Tunnel URL must start with http:// or https:// "
            f"(got {parsed.scheme!r})."
        )
    if not parsed.netloc:
        raise ColabConnectError("Tunnel URL has no host.")

    qs = urllib.parse.parse_qs(parsed.query)
    token_values = qs.get("token") or []
    if not token_values or not token_values[0]:
        raise ColabConnectError(
            "Tunnel URL is missing the ?token=... query parameter. "
            "Copy the full URL the Colab cell printed."
        )

    base = f"{parsed.scheme}://{parsed.netloc}"
    return base, token_values[0]


def _parse_status(body: dict[str, Any]) -> ColabStatus:
    """Validate + coerce the ``/status`` JSON into a ColabStatus."""
    try:
        return ColabStatus(
            task=str(body["task"]),
            model=str(body["model"]),
            status=str(body["status"]),
            epoch=int(body.get("epoch", 0)),
            epochs_total=int(body["epochs_total"]),
            imgsz=int(body["imgsz"]),
            batch=int(body["batch"]),
            best_pt_available=bool(body.get("best_pt_available", False)),
            error_message=body.get("error_message"),
        )
    except (KeyError, TypeError, ValueError) as exc:
        raise ColabConnectError(
            "Tunnel responded but the payload didn't look like a "
            "VRL-YOLO-GUI Colab worker. Is the right notebook running?"
        ) from exc


def connect(tunnel_url: str, *, timeout_s: float = PREFLIGHT_TIMEOUT_S) -> ColabSession:
    """Validate the URL with a pre-flight ``GET /status?token=...``.

    Returns a ``ColabSession`` carrying the parsed base + token + the
    initial status so the caller can seed the TrainingJob without a
    second round trip.

    Raises ``ColabConnectError`` with clinician-friendly text on every
    failure: malformed URL, wrong token, unreachable tunnel, non-JSON
    response, payload shape mismatch.
    """
    base, token = _split_url(tunnel_url)
    status_url = f"{base}/status?token={urllib.parse.quote(token)}"
    req = urllib.request.Request(
        status_url,
        headers={"Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout_s) as resp:
            payload = resp.read()
    except urllib.error.HTTPError as exc:
        if exc.code == 401:
            raise ColabConnectError(
                "Tunnel rejected the token. Re-copy the URL from the "
                "Colab cell — the token regenerates each time the cell runs."
            ) from exc
        raise ColabConnectError(
            f"Tunnel returned HTTP {exc.code}. {exc.reason}."
        ) from exc
    except urllib.error.URLError as exc:
        raise ColabConnectError(
            "Couldn't reach that Colab session — is the cell still running? "
            "Re-run the cell and paste the new URL."
        ) from exc

    try:
        body = json.loads(payload)
    except json.JSONDecodeError as exc:
        raise ColabConnectError(
            "Tunnel response wasn't JSON — likely not a VRL-YOLO-GUI "
            "Colab worker."
        ) from exc

    initial = _parse_status(body)
    return ColabSession(base_url=base, token=token, initial_status=initial)


def request_cancel(session: ColabSession, *, timeout_s: float = PREFLIGHT_TIMEOUT_S) -> None:
    """Best-effort ``POST /cancel`` so the runner stops at the next epoch boundary.

    Doesn't raise on connection failures — if the tunnel is already
    gone, there's nothing useful to do here, and the WebSocket reader
    will observe the disconnect separately.
    """
    req = urllib.request.Request(session.cancel_url(), method="POST", data=b"")
    try:
        with urllib.request.urlopen(req, timeout=timeout_s) as resp:
            resp.read()
    except (urllib.error.URLError, urllib.error.HTTPError):
        logger.warning("colab cancel request failed; runner may already be down")


def fetch_best_pt(
    session: ColabSession,
    dest: Path,
    *,
    timeout_s: float = FETCH_TIMEOUT_S,
    max_attempts: int = FETCH_MAX_ATTEMPTS,
) -> Path:
    """Stream ``GET /best.pt`` into ``dest``, returning the written path.

    Uses ``shutil.copyfileobj`` to avoid pulling the whole .pt into
    memory; typical detect checkpoints are 5–80 MB, classify ones
    smaller. Retries up to ``max_attempts`` times with exponential
    backoff (2/4/8 s) on transient network failures so a single
    tunnel blip doesn't make the user re-click Save.

    Fail-fast (no retry) on:
      - HTTP 401 (token changed — re-paste needed, retry won't help)
      - HTTP 409 (training not complete — retry won't help until it is)

    Raises ``ColabConnectError`` with a clinician-readable message
    after exhausting retries.
    """
    dest.parent.mkdir(parents=True, exist_ok=True)
    last_exc: Exception | None = None
    for attempt in range(1, max_attempts + 1):
        try:
            _stream_best_pt_once(session, dest, timeout_s=timeout_s)
            return dest
        except ColabConnectError as exc:
            # 401 and 409 are surfaced as-is by _stream_best_pt_once with
            # `retryable=False`; everything else (network drops, 5xx) is
            # marked retryable.
            if not getattr(exc, "retryable", False):
                raise
            last_exc = exc
            if attempt >= max_attempts:
                break
            delay_s = FETCH_BACKOFF_INITIAL_S * (FETCH_BACKOFF_FACTOR ** (attempt - 1))
            logger.info(
                "best.pt fetch attempt %d/%d failed (%s); retrying in %.0fs",
                attempt, max_attempts, exc, delay_s,
            )
            import time

            time.sleep(delay_s)

    assert last_exc is not None  # noqa: S101 - reachable only via the break path
    raise last_exc


def _stream_best_pt_once(
    session: ColabSession, dest: Path, *, timeout_s: float
) -> None:
    """One attempt at downloading best.pt — raises taxonomic errors.

    Network-level failures get ``retryable=True`` so ``fetch_best_pt``
    knows to back off and retry. Auth + state errors get
    ``retryable=False`` because retrying won't change the outcome.
    """
    req = urllib.request.Request(session.best_pt_url())
    try:
        with urllib.request.urlopen(req, timeout=timeout_s) as resp, dest.open("wb") as out:
            shutil.copyfileobj(resp, out)
    except urllib.error.HTTPError as exc:
        if exc.code == 409:
            err = ColabConnectError(
                "Trained model isn't ready yet — wait for the Colab cell "
                "to print 'Training finished' before saving to library."
            )
            err.retryable = False  # type: ignore[attr-defined]
            raise err from exc
        if exc.code == 401:
            err = ColabConnectError(
                "Tunnel rejected the token while fetching best.pt — "
                "did the Colab cell restart? Re-paste the new URL."
            )
            err.retryable = False  # type: ignore[attr-defined]
            raise err from exc
        # 5xx / other HTTP errors are retryable — could be a transient
        # tunnel hiccup or Cloudflare propagation.
        err = ColabConnectError(
            f"Tunnel returned HTTP {exc.code} on /best.pt. {exc.reason}."
        )
        err.retryable = True  # type: ignore[attr-defined]
        raise err from exc
    except urllib.error.URLError as exc:
        err = ColabConnectError(
            "Couldn't reach the Colab session to download best.pt. "
            "Keep the notebook cell running and try again."
        )
        err.retryable = True  # type: ignore[attr-defined]
        raise err from exc
    except OSError as exc:
        # Disk full, permission denied while writing — not retryable.
        err = ColabConnectError(
            f"Couldn't write best.pt to disk: {exc}."
        )
        err.retryable = False  # type: ignore[attr-defined]
        raise err from exc
