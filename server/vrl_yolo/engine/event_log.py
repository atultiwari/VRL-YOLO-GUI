"""Per-run event-log sidecar — `events.jsonl` (with `.gz` on completion).

F3 §2.4: every TrainingJob's full event stream gets flushed to disk so
the `/train/history/<id>` detail page can replay charts after the job
is gone from `JobManager`'s in-memory state. One file per run:

    <storage_root>/training/<job_id>/events.jsonl     (live)
    <storage_root>/training/<job_id>/events.jsonl.gz  (after terminal event)

`replay()` is encoding-agnostic — it picks whichever variant exists.
Best-effort: disk errors log and continue so a full disk or a permission
glitch can't take down a training run.
"""

from __future__ import annotations

import gzip
import json
import logging
import shutil
import threading
from pathlib import Path
from typing import Iterator

_LOG = logging.getLogger(__name__)

_PLAIN = "events.jsonl"
_GZIP = "events.jsonl.gz"


class EventLog:
    """Append-only newline-delimited JSON writer for a single run.

    Thread-safe — `TrainingJob.append_event` can be called from the
    subprocess reader thread, the Colab WS reader thread, and HTTP
    handlers (for `start`/`hello` event seeding). All paths funnel
    through `append()` under the per-instance lock.
    """

    def __init__(self, path: Path) -> None:
        self._path = path
        self._lock = threading.Lock()
        self._fp = None  # type: ignore[var-annotated]
        self._closed = False

    @classmethod
    def for_run(cls, output_dir: Path) -> "EventLog":
        """Create the writer for a run's output directory.

        ``output_dir`` is the per-run dir (`<training_root>/<job_id>/`)
        — same path `TrainingJob.output_dir` carries. Created on first
        append so failed jobs that never emit don't litter empty files.
        """
        return cls(output_dir / _PLAIN)

    def append(self, event: dict) -> None:
        """Persist one event. Errors are swallowed + logged."""
        with self._lock:
            if self._closed:
                return
            try:
                if self._fp is None:
                    self._path.parent.mkdir(parents=True, exist_ok=True)
                    # Line-buffered so each `_fp.write(...)` flushes
                    # without an explicit `.flush()` call.
                    self._fp = open(self._path, "a", buffering=1, encoding="utf-8")
                self._fp.write(json.dumps(event, ensure_ascii=False) + "\n")
            except OSError as exc:
                _LOG.warning("event_log: append failed for %s: %s", self._path, exc)

    def close_and_compress(self) -> Path:
        """Close the writer and gzip the sidecar in place.

        Returns the final path (always the `.gz` variant on success;
        the plain `.jsonl` if compression fails so callers can still
        find the data). Idempotent — calling twice is a no-op.
        """
        with self._lock:
            if self._closed:
                return self._final_path()
            self._closed = True
            if self._fp is not None:
                try:
                    self._fp.close()
                except OSError as exc:
                    _LOG.warning("event_log: close failed: %s", exc)
                self._fp = None

            if not self._path.is_file():
                return self._path

            gz_path = self._path.with_suffix(self._path.suffix + ".gz")
            try:
                with open(self._path, "rb") as src, gzip.open(gz_path, "wb") as dst:
                    shutil.copyfileobj(src, dst)
                self._path.unlink()
                return gz_path
            except OSError as exc:
                _LOG.warning("event_log: gzip failed for %s: %s", self._path, exc)
                # Leave the .jsonl in place so the data isn't lost.
                return self._path

    def _final_path(self) -> Path:
        gz = self._path.with_suffix(self._path.suffix + ".gz")
        if gz.is_file():
            return gz
        return self._path

    @staticmethod
    def replay(output_dir: Path) -> Iterator[dict]:
        """Yield every event from the run's sidecar in order.

        Auto-picks `events.jsonl.gz` if present, else `events.jsonl`.
        Yields nothing (no exception) when neither exists — same shape
        a fresh run with no events looks like.
        """
        gz = output_dir / _GZIP
        plain = output_dir / _PLAIN
        if gz.is_file():
            opener = lambda: gzip.open(gz, "rt", encoding="utf-8")  # noqa: E731
        elif plain.is_file():
            opener = lambda: open(plain, "r", encoding="utf-8")  # noqa: E731
        else:
            return
        with opener() as fp:
            for line in fp:
                line = line.strip()
                if not line:
                    continue
                try:
                    yield json.loads(line)
                except json.JSONDecodeError as exc:
                    _LOG.warning(
                        "event_log: skipping malformed line in %s: %s",
                        output_dir,
                        exc,
                    )
