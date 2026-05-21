"""SQLite-backed persistent training history (F3).

One table (`training_runs`) plus a `schema_version` row for hand-rolled
migrations. Writers are called from `JobManager` lifecycle hooks
(insert on start, update on terminal event, set_library_path on
save_to_library). Readers back the `/train/history` list + detail
pages and the auto-purge route.

Thread safety: SQLite's connection objects aren't safe across threads
by default — we open one connection per call inside the lock. The
write paths funnel through a single `threading.Lock` to avoid the
"database is locked" lockfile dance under concurrent flushes from
multiple reader threads.
"""

from __future__ import annotations

import json
import logging
import sqlite3
import threading
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Literal

_LOG = logging.getLogger(__name__)

SCHEMA_VERSION = 2


# ---- schema migrations -------------------------------------------------------


def _migrate_v0_to_v1(conn: sqlite3.Connection) -> None:
    """Initial schema (F3 §2.2)."""
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS schema_version (
            version INTEGER PRIMARY KEY
        );
        CREATE TABLE IF NOT EXISTS training_runs (
            id                      TEXT PRIMARY KEY,
            name                    TEXT NOT NULL,
            description             TEXT NOT NULL DEFAULT '',
            task                    TEXT NOT NULL,
            dataset_id              TEXT NOT NULL,
            dataset_snapshot_json   TEXT,
            base_model              TEXT NOT NULL,
            epochs_total            INTEGER NOT NULL,
            imgsz                   INTEGER NOT NULL,
            batch                   INTEGER NOT NULL,
            accelerator_kind        TEXT NOT NULL,
            device_arg              TEXT,
            started_at              TEXT NOT NULL,
            finished_at             TEXT,
            status                  TEXT NOT NULL,
            epoch_current           INTEGER NOT NULL DEFAULT 0,
            error_message           TEXT,
            best_pt_path            TEXT,
            library_path            TEXT,
            final_metrics_json      TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_training_runs_status
            ON training_runs (status);
        CREATE INDEX IF NOT EXISTS idx_training_runs_task
            ON training_runs (task);
        CREATE INDEX IF NOT EXISTS idx_training_runs_dataset
            ON training_runs (dataset_id);
        CREATE INDEX IF NOT EXISTS idx_training_runs_started_at
            ON training_runs (started_at);
        """
    )
    conn.execute("DELETE FROM schema_version")
    conn.execute("INSERT INTO schema_version (version) VALUES (1)")


def _migrate_v1_to_v2(conn: sqlite3.Connection) -> None:
    """F4: dataset naming table.

    Adds a `datasets` table parallel to `training_runs` carrying
    optional Name + Description per dataset folder. Backfills rows
    for every dataset folder that already exists under
    `<storage>/datasets/` so the F4 library UI never sees a NULL
    row for a folder it knows is on disk.

    Backfill needs the datasets root path — the migration reads it
    from the connection's caller (passed in via the
    `application_id` PRAGMA trick is fragile, so instead the
    `HistoryDb.migrate()` caller does the backfill in a second
    pass after this migration runs the schema-only DDL).
    """
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS datasets (
            id           TEXT PRIMARY KEY,
            name         TEXT NOT NULL,
            description  TEXT NOT NULL DEFAULT '',
            created_at   TEXT NOT NULL
        );
        """
    )
    conn.execute("DELETE FROM schema_version")
    conn.execute("INSERT INTO schema_version (version) VALUES (2)")


# Append future migrations here as `(from_version, to_version, fn)`.
_MIGRATIONS: list[tuple[int, int, "callable"]] = [
    (0, 1, _migrate_v0_to_v1),
    (1, 2, _migrate_v1_to_v2),
]


# ---- row dataclass ----------------------------------------------------------


SortKey = Literal["started_at", "name", "duration"]
SortDir = Literal["asc", "desc"]


@dataclass(frozen=True)
class HistoryRow:
    """Frontend-facing snapshot of a training-history row."""

    id: str
    name: str
    description: str
    task: str
    dataset_id: str
    dataset_missing: bool
    base_model: str
    epochs_total: int
    epoch_current: int
    imgsz: int
    batch: int
    accelerator_kind: str
    device_arg: str | None
    started_at: str
    finished_at: str | None
    duration_s: float | None
    status: str
    error_message: str | None
    best_pt_path: str | None
    library_path: str | None
    final_metrics: dict[str, float | None]
    dataset_snapshot: dict | None


@dataclass(frozen=True)
class DatasetMeta:
    """F4: per-dataset metadata stored alongside the on-disk folder."""

    id: str
    name: str
    description: str
    created_at: str  # ISO 8601 UTC


def _default_dataset_name(dataset_id: str) -> str:
    """Format used wherever no explicit name has been set."""
    return f"Dataset {dataset_id[:8]}"


# ---- HistoryDb --------------------------------------------------------------


class HistoryDb:
    """Persistent history layer for training runs."""

    def __init__(self, db_path: Path, *, datasets_root: Path | None = None) -> None:
        self._db_path = db_path
        # `datasets_root` lets `dataset_missing` flag be computed from
        # the row reader without an extra dependency at every call site.
        # None = always-False (useful in tests that don't care about the flag).
        self._datasets_root = datasets_root
        self._lock = threading.Lock()
        self._db_path.parent.mkdir(parents=True, exist_ok=True)

    # ---- connection ---------------------------------------------------------

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(
            str(self._db_path),
            isolation_level=None,  # autocommit; we manage transactions
            detect_types=sqlite3.PARSE_DECLTYPES,
        )
        conn.row_factory = sqlite3.Row
        # WAL improves concurrent-read throughput; safe on local-disk dbs.
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    # ---- migrations ---------------------------------------------------------

    def migrate(self) -> None:
        """Run any pending migrations to bring the schema up to date.

        After the schema-only migrations run, also backfills the F4
        `datasets` table with default-named rows for any dataset
        folder under `self._datasets_root` that doesn't have a meta
        row yet. Lets pre-F4 installs see their existing folders in
        the F4 library on first launch.
        """
        with self._lock, self._connect() as conn:
            # `schema_version` may not exist yet on a fresh install — the
            # v0→v1 migration creates it.
            current = 0
            try:
                row = conn.execute(
                    "SELECT version FROM schema_version LIMIT 1"
                ).fetchone()
                if row:
                    current = int(row["version"])
            except sqlite3.OperationalError:
                current = 0
            for from_v, to_v, fn in _MIGRATIONS:
                if current < to_v:
                    _LOG.info("history_db: migrating v%d → v%d", from_v, to_v)
                    fn(conn)
                    current = to_v
            _LOG.info("history_db: schema at v%d", current)

            # F4 backfill — runs every migrate() call, not just on
            # the v1→v2 transition, so a dataset folder dropped onto
            # disk after upgrade also gets a meta row on the next
            # launch. INSERT OR IGNORE makes this idempotent.
            if current >= 2 and self._datasets_root is not None:
                self._backfill_datasets_locked(conn)

    def _backfill_datasets_locked(self, conn: sqlite3.Connection) -> None:
        """Insert default-named meta rows for any folder lacking one.

        Caller must hold `self._lock` and own `conn`. INSERT OR IGNORE
        means a row that already exists keeps its (possibly user-edited)
        name and description — the backfill only fills gaps.
        """
        if not self._datasets_root or not self._datasets_root.is_dir():
            return
        for entry in self._datasets_root.iterdir():
            if not entry.is_dir():
                continue
            mtime_iso = datetime.fromtimestamp(
                entry.stat().st_mtime, tz=timezone.utc
            ).isoformat()
            conn.execute(
                "INSERT OR IGNORE INTO datasets (id, name, description, created_at) "
                "VALUES (?, ?, '', ?)",
                (entry.name, _default_dataset_name(entry.name), mtime_iso),
            )

    # ---- writers ------------------------------------------------------------

    def insert_run(
        self,
        *,
        job_id: str,
        name: str,
        description: str,
        task: str,
        dataset_id: str,
        dataset_snapshot: dict | None,
        base_model: str,
        epochs_total: int,
        imgsz: int,
        batch: int,
        accelerator_kind: str,
        device_arg: str | None,
        started_at: datetime,
        status: str,
    ) -> None:
        """Insert the start-time row. Other columns stay NULL until events fire."""
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO training_runs (
                    id, name, description, task, dataset_id, dataset_snapshot_json,
                    base_model, epochs_total, imgsz, batch,
                    accelerator_kind, device_arg, started_at, status, epoch_current
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
                """,
                (
                    job_id,
                    name,
                    description,
                    task,
                    dataset_id,
                    json.dumps(dataset_snapshot) if dataset_snapshot else None,
                    base_model,
                    epochs_total,
                    imgsz,
                    batch,
                    accelerator_kind,
                    device_arg,
                    started_at.isoformat(),
                    status,
                ),
            )

    def update_status_from_snapshot(self, job_id: str, snapshot: dict) -> None:
        """Reflect a JobManager snapshot back into the DB row.

        Called from `TrainingJob.append_event` terminal branches +
        whenever JobManager pokes the row.
        """
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                UPDATE training_runs
                SET status = ?,
                    epoch_current = ?,
                    finished_at = ?,
                    error_message = ?,
                    best_pt_path = ?,
                    final_metrics_json = ?
                WHERE id = ?
                """,
                (
                    snapshot.get("status"),
                    snapshot.get("epoch_current") or 0,
                    snapshot.get("finished_at"),
                    snapshot.get("error_message"),
                    snapshot.get("best_pt"),
                    json.dumps(snapshot.get("metrics") or {}),
                    job_id,
                ),
            )

    def set_library_path(self, job_id: str, path: Path) -> None:
        with self._lock, self._connect() as conn:
            conn.execute(
                "UPDATE training_runs SET library_path = ? WHERE id = ?",
                (str(path), job_id),
            )

    def update_metadata(
        self,
        job_id: str,
        *,
        name: str | None = None,
        description: str | None = None,
    ) -> "HistoryRow | None":
        """Edit name/description on a history row (un-blocks F2's PATCH gate)."""
        with self._lock, self._connect() as conn:
            updates: list[str] = []
            params: list = []
            if name is not None:
                updates.append("name = ?")
                params.append(name.strip()[:200] or "(unnamed)")
            if description is not None:
                updates.append("description = ?")
                params.append(description.strip()[:2000])
            if not updates:
                return self._get_locked(conn, job_id)
            params.append(job_id)
            cursor = conn.execute(
                f"UPDATE training_runs SET {', '.join(updates)} WHERE id = ?",
                params,
            )
            if cursor.rowcount == 0:
                return None
            return self._get_locked(conn, job_id)

    def delete(self, job_id: str) -> bool:
        with self._lock, self._connect() as conn:
            cursor = conn.execute(
                "DELETE FROM training_runs WHERE id = ?", (job_id,)
            )
            return cursor.rowcount > 0

    def purge_older_than(self, delta: timedelta) -> list[str]:
        """Delete rows whose started_at is older than now - delta.

        Returns the list of deleted ids so callers can also clean up
        per-run sidecar dirs. Library checkpoints under models/<task>/
        are NOT touched by this routine — they're separate user
        artifacts.
        """
        cutoff = (datetime.now(timezone.utc) - delta).isoformat()
        with self._lock, self._connect() as conn:
            rows = conn.execute(
                "SELECT id FROM training_runs WHERE started_at < ?",
                (cutoff,),
            ).fetchall()
            ids = [row["id"] for row in rows]
            if ids:
                placeholders = ",".join("?" * len(ids))
                conn.execute(
                    f"DELETE FROM training_runs WHERE id IN ({placeholders})",
                    ids,
                )
            return ids

    # ---- readers ------------------------------------------------------------

    def get(self, job_id: str) -> "HistoryRow | None":
        with self._lock, self._connect() as conn:
            return self._get_locked(conn, job_id)

    def _get_locked(
        self, conn: sqlite3.Connection, job_id: str
    ) -> "HistoryRow | None":
        row = conn.execute(
            "SELECT * FROM training_runs WHERE id = ?", (job_id,)
        ).fetchone()
        if row is None:
            return None
        return self._row_to_history(row)

    def list(
        self,
        *,
        task: str | None = None,
        dataset_id: str | None = None,
        status: str | None = None,
        limit: int = 50,
        offset: int = 0,
        sort_by: SortKey = "started_at",
        sort_dir: SortDir = "desc",
    ) -> tuple[list[HistoryRow], int]:
        """Paginated + filtered list. Returns (rows, total_matching)."""
        where: list[str] = []
        params: list = []
        if task is not None:
            where.append("task = ?")
            params.append(task)
        if dataset_id is not None:
            where.append("dataset_id = ?")
            params.append(dataset_id)
        if status is not None:
            where.append("status = ?")
            params.append(status)
        where_sql = ("WHERE " + " AND ".join(where)) if where else ""

        # SQLite duration sort needs the computed value — derive it inline.
        if sort_by == "duration":
            order_expr = (
                "CASE WHEN finished_at IS NULL "
                "THEN (julianday('now') - julianday(started_at)) * 86400 "
                "ELSE (julianday(finished_at) - julianday(started_at)) * 86400 "
                "END"
            )
        elif sort_by == "name":
            order_expr = "name COLLATE NOCASE"
        else:
            order_expr = "started_at"
        direction = "DESC" if sort_dir == "desc" else "ASC"

        with self._lock, self._connect() as conn:
            total_row = conn.execute(
                f"SELECT COUNT(*) AS n FROM training_runs {where_sql}", params
            ).fetchone()
            total = int(total_row["n"]) if total_row else 0
            rows = conn.execute(
                f"""
                SELECT * FROM training_runs
                {where_sql}
                ORDER BY {order_expr} {direction}, started_at DESC
                LIMIT ? OFFSET ?
                """,
                [*params, limit, offset],
            ).fetchall()
            return [self._row_to_history(r) for r in rows], total

    def distinct_dataset_ids(self) -> list[str]:
        with self._lock, self._connect() as conn:
            return [
                row["dataset_id"]
                for row in conn.execute(
                    "SELECT DISTINCT dataset_id FROM training_runs ORDER BY dataset_id"
                ).fetchall()
            ]

    # ---- F4: dataset meta + stats ------------------------------------------

    def dataset_stats(self) -> dict[str, dict[str, int | str | None]]:
        """Per-dataset aggregates from training_runs (F4 §2.4).

        Returns ``{dataset_id: {last_used_at, run_count}}``. Empty
        dict on a fresh install. One SQL pass.
        """
        with self._lock, self._connect() as conn:
            rows = conn.execute(
                "SELECT dataset_id, MAX(started_at) AS last, COUNT(*) AS n "
                "FROM training_runs GROUP BY dataset_id"
            ).fetchall()
        return {
            row["dataset_id"]: {
                "last_used_at": row["last"],
                "run_count": int(row["n"]),
            }
            for row in rows
        }

    def get_dataset_meta(self, dataset_id: str) -> "DatasetMeta | None":
        with self._lock, self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM datasets WHERE id = ?", (dataset_id,)
            ).fetchone()
            if row is None:
                return None
            return _row_to_dataset_meta(row)

    def list_dataset_meta(self) -> dict[str, "DatasetMeta"]:
        """All meta rows keyed by dataset id. Empty dict on fresh install."""
        with self._lock, self._connect() as conn:
            rows = conn.execute(
                "SELECT * FROM datasets ORDER BY id"
            ).fetchall()
        return {row["id"]: _row_to_dataset_meta(row) for row in rows}

    def upsert_dataset_meta(
        self,
        dataset_id: str,
        *,
        name: str | None = None,
        description: str | None = None,
        created_at: datetime | None = None,
    ) -> "DatasetMeta":
        """Insert or update a dataset meta row.

        ``name=None`` on insert → uses the ``_default_dataset_name``;
        on update → leaves the existing name untouched. Same for
        ``description=None`` and ``created_at=None``.

        Empty string for ``name`` (not None) on update resets to the
        default — matches F2's PATCH semantics.
        """
        with self._lock, self._connect() as conn:
            existing = conn.execute(
                "SELECT * FROM datasets WHERE id = ?", (dataset_id,)
            ).fetchone()
            if existing is None:
                # INSERT path
                final_name = (
                    (name.strip()[:200] if name and name.strip() else None)
                    or _default_dataset_name(dataset_id)
                )
                final_desc = (description or "").strip()[:2000]
                when = (created_at or datetime.now(timezone.utc)).isoformat()
                conn.execute(
                    "INSERT INTO datasets (id, name, description, created_at) "
                    "VALUES (?, ?, ?, ?)",
                    (dataset_id, final_name, final_desc, when),
                )
                return DatasetMeta(
                    id=dataset_id,
                    name=final_name,
                    description=final_desc,
                    created_at=when,
                )

            # UPDATE path
            updates: list[str] = []
            params: list = []
            if name is not None:
                stripped = name.strip()
                if not stripped:
                    # Empty string resets to default.
                    updates.append("name = ?")
                    params.append(_default_dataset_name(dataset_id))
                else:
                    updates.append("name = ?")
                    params.append(stripped[:200])
            if description is not None:
                updates.append("description = ?")
                params.append(description.strip()[:2000])
            if created_at is not None:
                updates.append("created_at = ?")
                params.append(created_at.isoformat())
            if updates:
                params.append(dataset_id)
                conn.execute(
                    f"UPDATE datasets SET {', '.join(updates)} WHERE id = ?",
                    params,
                )
            row = conn.execute(
                "SELECT * FROM datasets WHERE id = ?", (dataset_id,)
            ).fetchone()
            return _row_to_dataset_meta(row)

    def delete_dataset_meta(self, dataset_id: str) -> bool:
        with self._lock, self._connect() as conn:
            cursor = conn.execute(
                "DELETE FROM datasets WHERE id = ?", (dataset_id,)
            )
            return cursor.rowcount > 0

    # ---- helpers ------------------------------------------------------------

    def _row_to_history(self, row: sqlite3.Row) -> HistoryRow:
        started = row["started_at"]
        finished = row["finished_at"]
        duration: float | None = None
        if finished and started:
            try:
                duration = (
                    datetime.fromisoformat(finished)
                    - datetime.fromisoformat(started)
                ).total_seconds()
            except ValueError:
                duration = None
        dataset_missing = False
        if self._datasets_root is not None:
            dataset_missing = not (self._datasets_root / row["dataset_id"]).is_dir()
        return HistoryRow(
            id=row["id"],
            name=row["name"],
            description=row["description"] or "",
            task=row["task"],
            dataset_id=row["dataset_id"],
            dataset_missing=dataset_missing,
            base_model=row["base_model"],
            epochs_total=int(row["epochs_total"]),
            epoch_current=int(row["epoch_current"]),
            imgsz=int(row["imgsz"]),
            batch=int(row["batch"]),
            accelerator_kind=row["accelerator_kind"],
            device_arg=row["device_arg"],
            started_at=row["started_at"],
            finished_at=row["finished_at"],
            duration_s=duration,
            status=row["status"],
            error_message=row["error_message"],
            best_pt_path=row["best_pt_path"],
            library_path=row["library_path"],
            final_metrics=_decode_metrics(row["final_metrics_json"]),
            dataset_snapshot=_decode_snapshot(row["dataset_snapshot_json"]),
        )


def _decode_metrics(raw: str | None) -> dict[str, float | None]:
    if not raw:
        return {}
    try:
        data = json.loads(raw)
        if isinstance(data, dict):
            return data
    except (json.JSONDecodeError, TypeError):
        pass
    return {}


def _decode_snapshot(raw: str | None) -> dict | None:
    if not raw:
        return None
    try:
        data = json.loads(raw)
        if isinstance(data, dict):
            return data
    except (json.JSONDecodeError, TypeError):
        pass
    return None


def _row_to_dataset_meta(row: sqlite3.Row) -> DatasetMeta:
    return DatasetMeta(
        id=row["id"],
        name=row["name"],
        description=row["description"] or "",
        created_at=row["created_at"],
    )
