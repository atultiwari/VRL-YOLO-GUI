# F3 Plan — Persistent training history

> Concrete plan for **Future Feature #3** from `docs/FUTURE-FEATURES.md`.
> **Not yet committed to implementation** — this doc captures the design
> + open decisions for sign-off before any code lands.
>
> F3 is the biggest single piece of the F-chain: it introduces SQLite
> as the first real persistence dependency in `server/vrl_yolo/`. Until
> F3, every training-run record lives in `JobManager`'s in-memory dict
> and disappears at app quit. F3 is also what *unblocks* F2's
> "Editing locked after the run finishes" carry-forward — completed-run
> edits land in the history record once it exists.
>
> Once signed off, this becomes the F3 section in `docs/PHASE-STATUS.md`
> at phase boundary, plus the matching `CHANGELOG.md` /
> `apps/web/lib/changelog.ts` entries.

---

## 1. Scope summary

Persistent record of every training run, surfaced through two new
frontend pages:

- **`/train/history`** — sortable, filterable table. Columns:
  Name · Task · Dataset · Started · Duration · Status · Best metric ·
  In library? · Actions.
- **`/train/history/<id>`** — detail view. Re-uses the existing
  `LossChart` / `MapChart` / `ClassifyLossChart` / `ClassifyAccuracyChart`
  components from `/train/run`, replaying the run's complete event
  stream from disk. Shows full hyperparameters, final metrics, error
  trail, dataset snapshot, and the saved-to-library checkpoint path
  if any.

Three actions per row:

- **Re-run with same settings** — prefills the wizard from the row,
  user can adjust knobs before starting the new run.
- **Delete from history** — removes the SQLite row + the per-run
  `events.jsonl` sidecar. Asks separately about the library
  checkpoint (which lives under `<storage>/models/<task>/` and is
  the deliberate output of `save_to_library` — a different artifact
  from the run record).
- **Edit name / description** — un-blocks F2's PATCH gate so the
  user can rename + annotate a completed run after the fact.

Out of scope for F3 (lands later):

- The **Re-run** action prefills the wizard but doesn't copy the
  Colab tunnel URL — Colab re-runs need a fresh Colab session
  every time anyway. The re-run for a Colab job lands the user on
  `/train/configure` with the local-training defaults; they can
  pick *Run on Colab* from there.
- Cross-machine sync of the history database. F3 is single-machine
  by design; the `training.db` file lives under the same
  `<storage_root>` as the existing `models/` and `datasets/` dirs.

---

## 2. Persistence layer

### 2.1 Storage location

`<storage_root>/training.db` — one SQLite file per install. Lives
alongside `models/`, `datasets/`, and `training/<job_id>/` so it
gets included in the existing storage-management surface
(`scripts/run-desktop.py --clean` wipes it; no migration story
needed for cleared installs).

### 2.2 Schema (v1)

One table for now (`training_runs`), one for schema versioning:

```sql
CREATE TABLE schema_version (
    version INTEGER PRIMARY KEY
);
-- seed
INSERT INTO schema_version (version) VALUES (1);

CREATE TABLE training_runs (
    -- Identity + metadata (from F2)
    id                      TEXT PRIMARY KEY,         -- uuid hex
    name                    TEXT NOT NULL,            -- F2 run name
    description             TEXT NOT NULL DEFAULT '', -- F2 description

    -- What was trained
    task                    TEXT NOT NULL,            -- detect / classify
    dataset_id              TEXT NOT NULL,            -- folder name under datasets/
    dataset_snapshot_json   TEXT,                     -- inspector output at start time
    base_model              TEXT NOT NULL,            -- starting weights filename

    -- Hyperparams
    epochs_total            INTEGER NOT NULL,
    imgsz                   INTEGER NOT NULL,
    batch                   INTEGER NOT NULL,

    -- Where it ran
    accelerator_kind        TEXT NOT NULL,            -- cuda / mps / cpu / colab
    device_arg              TEXT,                     -- nullable

    -- Lifecycle
    started_at              TEXT NOT NULL,            -- ISO 8601 UTC
    finished_at             TEXT,                     -- nullable
    status                  TEXT NOT NULL,            -- queued/running/completed/failed/cancelled
    epoch_current           INTEGER NOT NULL DEFAULT 0,
    error_message           TEXT,                     -- nullable

    -- Artifacts
    best_pt_path            TEXT,                     -- absolute path under training/<id>/
    library_path            TEXT,                     -- absolute path under models/<task>/ if saved
    final_metrics_json      TEXT                      -- {top1, top5, mAP50, ...}
);

CREATE INDEX idx_training_runs_status ON training_runs (status);
CREATE INDEX idx_training_runs_task ON training_runs (task);
CREATE INDEX idx_training_runs_dataset ON training_runs (dataset_id);
CREATE INDEX idx_training_runs_started_at ON training_runs (started_at);
```

Indexes chosen to back the table's likely sort + filter dimensions
(status filter, task filter, dataset filter, sort-by-started-at).

### 2.3 Migration strategy

Hand-rolled, per the open-decision recommendation in
`docs/FUTURE-FEATURES.md` item 3. Module:
`server/vrl_yolo/engine/history_db.py` exposes a `migrate(db_path)`
function called from `lifespan` startup. Reads
`SELECT version FROM schema_version`, runs each `_migrate_vN_to_vM`
function in order. v1→v1 is the install path (creates the schema).
Future migrations append new entries; never modify earlier ones.

Why not Alembic: one table, one schema, hand-rolled is 60 lines vs
adding alembic dep + alembic init + alembic.ini + versions/ dir +
template files. If the schema grows past 4–5 tables we revisit.

### 2.4 Events.jsonl sidecar

Per-run training events stay out of SQLite — keeping them there
would bloat row size and make queries against the table slower.
Instead, one file per run:

```
<storage_root>/training/<job_id>/events.jsonl
```

Append-only during the run; one event per line; gzipped to
`events.jsonl.gz` once the run hits a terminal status (saves
~5–10× on disk for 200-epoch runs — a typical 5 MB run becomes
~500 KB). The history detail page replays from whichever exists.

The training run already writes its event stream to memory in
`TrainingJob.events`. F3 adds a parallel disk-writer (a thin
wrapper that `flush`es each event as it's appended). The writer is
best-effort — disk errors log but don't fail the training run.

### 2.5 JobManager hooks

Two integration points in `engine/training.py`:

- **On `start()` / `start_colab_job()`:** After the job is added to
  `_jobs`, insert a row into `training_runs` with all the start-time
  fields populated. `finished_at`, `best_pt_path`, `library_path`,
  `final_metrics_json` stay NULL. Open the events.jsonl sidecar in
  append mode.
- **On every event flush (via `TrainingJob.append_event`):**
  Append the JSON line to the sidecar. When the event type is one
  of `complete` / `error` / `cancelled`, also UPDATE the row's
  `status`, `finished_at`, `error_message`, `epoch_current`,
  `final_metrics_json`, and `best_pt_path`. Then gzip the sidecar
  (in a background thread so the WS handler isn't blocked).
- **On `save_to_library()` success:** UPDATE the row's
  `library_path` so the history page can show "✓ in library".

All three hooks live behind a single `HistoryDb` class (new in
`engine/history_db.py`) so the hooks are one-liners and the SQL
stays contained. The class is constructed once in lifespan and
hung off `app.state.history`.

### 2.6 In-memory + on-disk: which one wins?

Currently in-flight runs live only in `JobManager._jobs`. After F3,
they exist in both `_jobs` (live event stream + WS handler) and the
DB (durable record). Reads go to:

- `JobManager.get(job_id)` — for live status, WS replay, current
  metrics. Same as today.
- `HistoryDb.get(job_id)` — for past runs that may have outlived
  the current process.
- New `JobManager.get_or_recover(job_id)` — checks `_jobs` first;
  on miss, reconstructs a `TrainingJob` from the DB row +
  events.jsonl for read-only operations (chart replay, status
  display). Re-attaching for live editing isn't supported (the
  subprocess is gone).

The history page lists from `HistoryDb.list(...)` (paginated +
filtered SQL); the detail page calls `get_or_recover()`.

### 2.7 What happens when a dataset folder is deleted

Two cases:

1. **Dataset deleted while a run is in flight.** The run keeps
   going (Ultralytics loaded the data into its in-memory
   DataLoader at start). The history row keeps `dataset_id`
   populated; the **Re-run** action notes "dataset no longer
   exists" and disables itself.
2. **Dataset deleted between runs.** Same — `dataset_id` stays
   in the row; **Re-run** disabled; the dataset filter on
   `/train/history` still works (filtering by an orphan dataset
   id is allowed — shows the rows that used to use it).

A `dataset_missing: true` virtual field on the API response
surfaces "this dataset no longer exists" so the UI can render it
without the user clicking Re-run to find out. Computed at read
time by checking `<storage>/datasets/<id>/.exists()`.

---

## 3. Backend

### 3.1 New module: `server/vrl_yolo/engine/history_db.py`

```python
class HistoryDb:
    def __init__(self, db_path: Path) -> None: ...
    def migrate(self) -> None: ...
    # Writers (called from JobManager hooks)
    def insert_run(self, job: TrainingJob) -> None: ...
    def update_status(self, job_id: str, snapshot: dict) -> None: ...
    def set_library_path(self, job_id: str, path: Path) -> None: ...
    # Readers (called from routes)
    def list(
        self,
        *,
        task: JobTask | None = None,
        dataset_id: str | None = None,
        status: JobStatus | None = None,
        limit: int = 50,
        offset: int = 0,
        sort_by: Literal["started_at", "name", "duration"] = "started_at",
        sort_dir: Literal["asc", "desc"] = "desc",
    ) -> list[HistoryRow]: ...
    def get(self, job_id: str) -> HistoryRow | None: ...
    def delete(self, job_id: str) -> bool: ...
    # Edits (un-blocks F2's PATCH gate for completed runs)
    def update_metadata(
        self, job_id: str, *, name: str | None, description: str | None
    ) -> HistoryRow | None: ...
```

Thread-safe: SQLite default is serialised, plus a single
`threading.Lock` for the writer paths to avoid `database is locked`
under concurrent flushes from multiple reader threads.

`HistoryRow` is a frozen dataclass mirroring the SQL columns + the
computed `dataset_missing` boolean.

### 3.2 New module: `server/vrl_yolo/engine/event_log.py`

Thin wrapper around the per-run `events.jsonl` writer + reader:

```python
class EventLog:
    @classmethod
    def for_run(cls, output_dir: Path) -> EventLog: ...
    def append(self, event: dict) -> None: ...        # flush every write
    def close_and_compress(self) -> Path: ...         # rename + gzip
    @classmethod
    def replay(cls, output_dir: Path) -> Iterator[dict]: ...  # auto-pick .jsonl or .jsonl.gz
```

Writer + compression live here so `engine/training.py` doesn't
sprout file-IO logic; reader stays a generator so the API can stream
the response.

### 3.3 `TrainingJob.append_event` integration

```python
def append_event(self, event: dict) -> None:
    with self._lock:
        self.events.append(event)
        # ... existing event-type branching ...
    # NEW: persist out of the lock so disk IO doesn't stall
    # other threads waiting on _lock.
    if self._event_log:
        self._event_log.append(event)
```

`_event_log` is the new field on `TrainingJob`, populated by
`JobManager.start()` and `start_colab_job()`. Closed by the
reader-loop's terminal-event handler.

### 3.4 `JobManager` hook points

Three new lines in `start()`:

```python
job._event_log = EventLog.for_run(output_dir)
# ... existing TrainingJob construction ...
self._history.insert_run(job)        # after _jobs.add
```

Three in `start_colab_job()` — same shape.

One in `cancel()` / `_reader_loop` / `append_event`'s terminal
branches: after status flips to a terminal value, call
`history.update_status(job_id, job.snapshot())` and
`job._event_log.close_and_compress()`.

One in `save_to_library()`: after the copy succeeds,
`history.set_library_path(job_id, dest)`.

### 3.5 Schemas (`api/schemas.py`)

```python
class TrainingHistoryRow(BaseModel):
    id: str
    name: str
    description: str
    task: Task
    dataset_id: str
    dataset_missing: bool
    base_model: str
    epochs_total: int
    epoch_current: int
    imgsz: int
    batch: int
    accelerator_kind: Literal["cuda", "mps", "cpu", "colab"]
    started_at: str
    finished_at: str | None
    duration_s: float | None
    status: TrainingStatus
    error_message: str | None
    best_pt_path: str | None
    library_path: str | None
    final_metrics: TrainingMetrics


class TrainingHistoryListResponse(BaseModel):
    rows: list[TrainingHistoryRow]
    total: int          # for paginator
    limit: int
    offset: int


class TrainingHistoryDetailResponse(BaseModel):
    row: TrainingHistoryRow
    # Events streamed as a separate endpoint to keep the JSON light.
    events_url: str     # /api/training/history/{id}/events
```

`UpdateTrainingMetadataRequest` (F2) gets re-used for history-row
edits. The PATCH gate from F2 is removed — both running AND
completed runs accept edits. Route layer decides where the edit
lands (in-memory if status running, DB if completed).

### 3.6 New routes (`api/routers/training.py`)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/training/history` | List rows, paginated + filtered |
| GET | `/api/training/history/{id}` | Single row |
| GET | `/api/training/history/{id}/events` | Stream events.jsonl(.gz) (NDJSON) |
| DELETE | `/api/training/history/{id}` | Remove row + sidecar (+ optionally the library checkpoint) |
| POST | `/api/training/history/{id}/rerun` | Returns a `StartTrainingRequest`-shaped body the wizard can prefill from; doesn't actually start a run |

The existing `PATCH /api/training/{id}` (F2) is extended to accept
completed-run edits — when the job isn't in `_jobs` anymore, write
through to the DB directly.

The DELETE route takes `?delete_checkpoint=true|false` (default
`false`) — separate decision from deleting the history row.

---

## 4. Frontend

### 4.1 `/train/history` page (new)

Route: `apps/web/app/train/history/page.tsx`. Same shell as
`/train/configure` / `/train/run`. Table layout:

| Column | Notes |
|---|---|
| Name | Truncated; click → detail page |
| Task | Badge |
| Dataset | First 8 chars of UUID; tooltip shows full id; greyed if `dataset_missing` |
| Started | `formatDate(started_at)` — TZ-aware |
| Duration | `formatElapsed((finished_at - started_at) / 1000)` |
| Status | Badge with the existing status tone palette |
| Best | Top-1 for classify, mAP50 for detect; `—` if nothing |
| In library? | ✓ icon if `library_path` set |
| Actions | Re-run · Edit · Delete dropdown |

Header has filter chips: Task (All / Detect / Classify) ·
Status (All / Completed / Failed / Cancelled / Running) ·
Dataset (autocomplete) · sort dropdown (Most recent / Name / Duration).

Empty state: `"No training runs yet. Start one from /train."` with
a button.

### 4.2 `/train/history/<id>` page (new)

Route: `apps/web/app/train/history/[id]/page.tsx`. Layout:

- Header: same shape as `/train/run` (name + description + status
  badge + Started/Finished/Elapsed line + edit pencils).
- A row of cards: Hyperparameters · Dataset · Hardware ·
  Final metrics.
- Charts section: same `LossChart` / `MapChart` /
  `ClassifyLossChart` / `ClassifyAccuracyChart` components,
  reading from a series array built from the replayed events
  (fetch `events.jsonl` once on mount; build the same `ChartRow[]`
  shape `/train/run` builds from the live stream).
- Log card: scrollable.
- Actions row: Re-run · Save to library (if not already saved) ·
  Delete.

### 4.3 Sidebar entry

`apps/web/components/sidebar.tsx` gets a new nav item
"Training history" under the Train section. Icon: `History` from
lucide-react.

### 4.4 API helpers (`apps/web/lib/api.ts`)

```typescript
export async function listTrainingHistory(args: {
  task?: Task;
  status?: TrainingStatus;
  dataset_id?: string;
  limit?: number;
  offset?: number;
  sort_by?: "started_at" | "name" | "duration";
  sort_dir?: "asc" | "desc";
}): Promise<TrainingHistoryListResponse>;

export async function getTrainingHistoryRow(
  id: string
): Promise<TrainingHistoryDetailResponse>;

export async function fetchTrainingHistoryEvents(
  id: string
): Promise<TrainingEvent[]>;     // streams NDJSON, parses to array

export async function deleteTrainingHistoryRow(
  id: string,
  opts?: { deleteCheckpoint?: boolean }
): Promise<void>;

export async function rerunTrainingHistoryRow(
  id: string
): Promise<StartTrainingBody>;   // prefill payload, NOT a start
```

### 4.5 Train wizard prefill

`apps/web/app/train/configure/page.tsx` gains support for a
`?from=<history_id>` query param: on mount, fetch the rerun
payload and patch the store + UI state to match. Existing fields
(dataset, model, hyperparams, name, description) all prefill;
the user can adjust before clicking Start.

### 4.6 F2 `/train/run` edit-lock removal

The "Editing locked after the run finishes" hint and the
disappearing pencils from F2 §F2.14 come back as full editing
support — once the history row exists, edits land in the DB. The
copy changes from *"...re-enabled when history persistence lands
in F3"* to nothing (just enabled). The hint goes away.

---

## 5. Tests

New file: `tests/test_history.py`. Synthetic
`JobManager` + `HistoryDb` against an in-memory or
`tmp_path / "training.db"` SQLite file. ~25 tests:

| Test category | Cases |
|---|---|
| `HistoryDb` writer | insert_run populates all fields; update_status flips status + finished_at + final_metrics; set_library_path updates only that column; delete removes + returns True/False |
| `HistoryDb` reader | list paginates correctly; filter by task / status / dataset; sort by each dimension; get unknown returns None; dataset_missing computed correctly |
| Schema migration | starts on a fresh DB (no schema_version table) → seeds v1; idempotent re-migrate is no-op |
| `EventLog` | append flushes immediately; close_and_compress produces a valid .gz that replay() reads back identically; replay handles both compressed and uncompressed |
| Integration via JobManager hooks | start() inserts a row; terminal event updates status + closes sidecar; save_to_library updates library_path |
| Route layer | GET /history paginated; filter chip combos; GET /history/{id} returns the row; DELETE removes (with checkpoint optional); PATCH on completed run writes to DB (F2 gate removed) |
| Re-run prefill | rerun route returns a StartTrainingBody-shaped payload that matches the original row |
| Edge cases | events.jsonl missing → replay yields empty; dataset folder deleted → row remains, dataset_missing=true |

Frontend: tsc + manual verification (per the F1 / F2 precedent).

---

## 6. Manual verification checklist

- [ ] `uv sync --extra ml --extra desktop --extra dev` clean
- [ ] `uv run pytest -q` 100% green (existing + new)
- [ ] `pnpm tsc --noEmit` clean
- [ ] `VRL_YOLO_GUI_BUILD=desktop pnpm build` produces fresh static export
- [ ] `python scripts/run-desktop.py` boots; lifespan creates / migrates `training.db`
  - [ ] Start a fresh training run; row appears in `/train/history` immediately
  - [ ] Run completes; row's status flips to "completed", duration populates, final metrics shown
  - [ ] Click row → detail page shows correct hyperparams + charts replay
  - [ ] Edit name on completed run (F2 lock removed); page reflects change
  - [ ] Save to library → row's "In library?" cell flips to ✓
  - [ ] Click Re-run → wizard prefills correctly with the row's settings
  - [ ] Delete row → row disappears from table; `events.jsonl(.gz)` removed
  - [ ] Delete with delete_checkpoint=true → library card on /models disappears too
  - [ ] Filter by task / status / dataset works
  - [ ] Sort by Started / Name / Duration works
- [ ] CHANGELOG.md + apps/web/lib/changelog.ts + PHASE-STATUS.md + CLAUDE.md updated
- [ ] pyproject.toml version bump to 0.12.0
- [ ] Tag `v0.12-f3-history`
- [ ] Push, then backfill SHA chore commit

---

## 7. Versioning + commit

- **pyproject.toml:** `0.11.0` → `0.12.0` (minor — new pages + new
  schema + new persistence dep is *internal* SQLite-stdlib, no new
  external dep, backwards-compatible since fresh installs migrate
  v0→v1 transparently).
- **Tag:** `v0.12-f3-history`.
- **Commit message:** `feat(f3): persistent training history — SQLite + /train/history + edit-lock removal`.

---

## 8. Decisions (all signed off 2026-05-21)

1. **Hand-rolled schema migrations.** `schema_version` int + ordered
   `_migrate_vN_to_vM` functions. Switch to Alembic only if schema
   grows past 4–5 tables.
2. **Retention: keep forever by default, with an opt-in auto-purge
   setting** in app Settings. New `AppSettings.auto_purge_old_runs:
   boolean` (default **OFF**) — when ON, purges rows whose
   `started_at < now() - 30 days` along with their `events.jsonl(.gz)`
   sidecars. See §9 below for the design — adds a small scope bump to
   F3 (new Train section in `/settings`, new purge route + button).
3. **Immediate gzip** of `events.jsonl` on terminal event, in a
   background daemon thread so the WS handler isn't blocked.
4. **Keep history row** when its dataset folder gets deleted; flag
   `dataset_missing: true` on read; disable Re-run for those rows.
5. **delete_checkpoint=false default** on the DELETE route; confirmation
   modal asks separately ("Also delete the saved checkpoint
   `<filename>`?") with the second checkbox default OFF.
6. **Re-run from a Colab row prefills the local-training wizard** —
   the user opens the Colab modal again from `/train/configure` if
   they want Colab. The old tunnel is dead anyway.
7. **Sidebar: "Training history" entry under the Train section.**
8. **Read-only rows on the history detail page.** Edits to settings
   land via Re-run (which prefills the editable wizard).

Implementation: ~3–5 days of focused work including tests, with §9
adding ~½ day for the auto-purge surface.

---

## 9. Auto-purge setting (decision 2)

### What

New Settings toggle: **"Auto-purge training runs older than 30 days"**
(default **OFF**). When ON, the `/train/history` page calls a backend
purge endpoint on mount which deletes every row whose `started_at` is
more than 30 days old (along with its `events.jsonl(.gz)` sidecar).
Library checkpoints are left untouched — they're a separate user
artifact under `models/<task>/`.

### Why this design

The setting lives in `localStorage` (per the existing
`apps/web/lib/settings.ts` contract — client-only); the server
doesn't have a place to read user preferences from. Two options for
making auto-purge work given that:

- **(a) Client-triggered.** `/train/history` page mount checks the
  setting; if ON, calls `POST /api/training/history/purge?older_than_days=30`.
  Server returns the count + an array of deleted ids. The page then
  refreshes.
- **(b) Server cron.** Server reads a config file (or env var) and
  runs purge on lifespan startup + every N hours. Decouples from the
  client but introduces a new persistence point.

Plan uses **(a)** — minimal infrastructure, the user only cares about
purge when they're on the history page anyway, and we avoid a
phantom-cron-job behaviour that's hard to reason about. Manual
"Clean up runs older than 30 days" button stays available regardless
of the setting (one-click form of the same call).

### Backend addition

```python
@router.post("/history/purge", response_model=PurgeResponse)
def purge_history(
    older_than_days: int = Query(..., ge=1, le=3650),
    history: HistoryDb = Depends(get_history_db),
) -> PurgeResponse:
    """Delete rows + sidecars whose started_at is older than the cutoff.

    Library checkpoints are NOT deleted — they're separate artifacts
    under models/<task>/ that the user can clean up via the F1 delete
    affordance on /models.
    """
    deleted_ids = history.purge_older_than(timedelta(days=older_than_days))
    return PurgeResponse(deleted_count=len(deleted_ids), deleted_ids=deleted_ids)
```

`HistoryDb.purge_older_than(delta)` runs a single `DELETE FROM
training_runs WHERE started_at < ?` + walks the matching `events.jsonl
(.gz)` files. Returns the list of deleted ids so the frontend can show
"Cleaned up 7 old runs" rather than a silent state-change.

### Frontend addition

**Settings.** F3 creates the Train section in `/settings` (a new
`Card` block titled "Train") with one initial row:

```
[ ] Auto-purge training runs older than 30 days
    When you open Training History, automatically delete rows whose
    Started date is more than 30 days ago. Library checkpoints stay
    in /models — only the history record + replay events are removed.
```

F5 will later add the auto-save toggle to this same Train section.

**`/train/history`.** Page header gets a small "Clean up runs older
than 30 days" link (with a confirmation modal showing the count
preview before delete). When the auto-purge setting is ON, the page's
`useEffect` on mount calls the purge endpoint silently and shows a
small `"Auto-purged 7 old runs"` toast on success. On failure, the
toast is a red `"Auto-purge failed: <reason>"` — non-fatal.

### Carry-forward note

If pilot users want a configurable threshold (60d, 90d, never), we
add a number-input next to the toggle. Default 30d works for the
common case ("clear out anything I've forgotten about") without
adding a UI knob in v1.

---
