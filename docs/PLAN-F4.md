# F4 Plan — Dataset library: reuse + grouping by dataset

> Concrete plan for **Future Feature #4** from `docs/FUTURE-FEATURES.md`.
> **Not yet committed to implementation** — this doc captures the design
> + open decisions for sign-off before any code lands.
>
> F4 is the **last item in the F-chain**. After F4 ships, the F-chain is
> complete and we return to the original PLAN.md §14 phases (P7
> Polish → P8/P9 Packaging → P10 Pilot).
>
> Once signed off, this becomes the F4 section in `docs/PHASE-STATUS.md`
> at phase boundary, plus the matching `CHANGELOG.md` /
> `apps/web/lib/changelog.ts` entries.

---

## 1. Scope summary

Two related additions that build on F3's persistence layer:

- **Reuse uploaded datasets** — `/train/dataset` step gains a tab
  toggle: **Drop a folder** (current behaviour) vs **Pick from library**.
  The library tab lists every dataset already on disk, with metadata
  (task, image count, split layout) + cross-referenced stats from F3
  (`last_used_at`, `run_count`).
- **Implicit grouping by dataset on history** — `/train/history` already
  has a dataset filter from F3 (just a raw UUID stub today). F4 swaps
  it for a populated dropdown sourced from `/api/datasets` so the user
  picks by name instead of remembering a UUID stub. Each library entry
  also links to *"View all runs on this dataset"* (= the same filter,
  reached via a different entry point).

Plus the matching CRUD:

- New `GET /api/datasets` — list with cross-referenced stats.
- New `DELETE /api/datasets/{id}` — wipes the folder; confirmation
  modal warns about referenced history rows (which stay, flagged
  `dataset_missing: true` per F3's existing semantics).

User decisions signed off (2026-05-21):

1. **Dataset naming + description IS included in F4** (option B on §8
   decision 1) — matches F2's run-naming pattern. See §2.6 below for
   the SQLite `datasets` table + schema v2 migration.
2. **New top-level `/datasets` page in the sidebar** AND the
   pick-from-library tab on `/train/dataset` (option B on §8 decision 2).
   Library is both a wizard shortcut and a standalone workspace.
3. **Delete modal softly mentions library checkpoints** (option A on
   §8 decision 5) — third row of copy reminds the user that
   checkpoints stay in `/models` and can be deleted separately if
   needed.
4. **Default sort: Most recently used + sort dropdown** for Most runs
   / Newest first (option A on §8 decision 4).
5. **Partial datasets render as a separate "Couldn't read" section**
   below the main library table (option B on §8 decision 3) — keeps
   the healthy rows clean and groups the problem cases.
6. **Partial datasets are deletable** from the UI (option A on §8
   decision 6) — same Delete affordance as healthy rows, since
   they're orphan disk space the user wants to reclaim.

Out of scope for F4 (deferred):

- **Shared datasets across machines.** Explicitly out of v1 scope per
  PLAN.md §13.5. Library lists local-only.
- **In-place dataset editing** beyond the existing PATCH /classes +
  POST /split + the new F4 PATCH /name+description (per decision 1).
  Re-splitting still goes through the existing modal flow.

---

## 2. Backend

### 2.1 New: `GET /api/datasets`

In `server/vrl_yolo/api/routers/dataset.py`:

```python
@router.get("", response_model=DatasetsListResponse)
def list_datasets(
    settings: Settings = Depends(_settings),
    history: HistoryDb | None = Depends(get_history),
) -> DatasetsListResponse:
    """List every dataset currently on disk under <storage>/datasets/.

    Each row is the existing `DatasetInfoOut` shape + two F4-only
    cross-referenced fields from F3's history table:
    - `last_used_at`: ISO 8601 string of the most recent training run's
      `started_at` for this `dataset_id`. Null if no runs ever used it.
    - `run_count`: integer count of training-history rows referencing
      this id (across all statuses — completed, failed, cancelled).
    """
```

- Walks `<storage>/datasets/` for every subdir.
- For each, calls the existing `inspect_dataset()` to get
  format/task/splits/classes.
- Skips datasets where `inspect_dataset()` raises (corresponds to
  partially-uploaded or corrupted layouts — surfaced in the response
  as a separate `partial: [{id, error}]` list so the UI can show a
  greyed "couldn't read this dataset" row instead of silently hiding
  it).
- Sorts by `last_used_at DESC NULLS LAST, id` so the most
  recently-trained-against dataset surfaces first.
- For history cross-references: a single new
  `HistoryDb.dataset_stats() → dict[str, {last_used_at, run_count}]`
  method (one SQL pass — `SELECT dataset_id, MAX(started_at),
  COUNT(*) FROM training_runs GROUP BY dataset_id`). Returns
  empty dict when no history is wired.

### 2.2 New: `DELETE /api/datasets/{id}`

```python
@router.delete("/{dataset_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_dataset(
    dataset_id: str,
    settings: Settings = Depends(_settings),
    manager: JobManager = Depends(get_job_manager),
) -> None:
    """Remove the dataset folder from disk.

    Refuses with 409 Conflict if any in-flight training job is
    actively using the dataset (status running / queued). Returns
    204 + wipes the folder otherwise. F3's history rows stay —
    `dataset_missing: true` already covers the orphaned-history case
    in the list / detail responses.
    """
```

- 404 if the folder doesn't exist (matches the existing
  `_resolve_dataset_root` pattern).
- 409 Conflict if `JobManager.list_jobs()` includes any running /
  queued job whose `dataset_root.name == dataset_id`. Message
  quotes the run name so the user knows what to cancel first.
- 204 + `shutil.rmtree(folder)` otherwise.
- We do NOT delete the history rows; F3's `dataset_missing` flag
  already handles them gracefully (greyed out in the list table;
  Re-run disabled).
- We do NOT delete the library checkpoints that were saved from
  trainings on this dataset — they're separate user-owned artifacts
  under `models/<task>/`. Symmetric with F3's
  `?delete_checkpoint=true` default-off semantics.

### 2.3 Schemas (new in `server/vrl_yolo/api/schemas.py`)

```python
class DatasetListRow(BaseModel):
    """One row in the dataset library — DatasetInfoOut + F4 stats."""
    id: str
    format: DatasetFormatLit
    task: Task
    root_path: str
    splits: list[DatasetSplitOut]
    classes: list[str]
    class_counts: dict[str, int] = Field(default_factory=dict)
    warnings: list[str] = Field(default_factory=list)
    unassigned_image_count: int = 0
    # F4: cross-referenced from F3's history table.
    last_used_at: str | None = None
    run_count: int = 0
    # Filesystem mtime of the dataset folder. Useful as a "created/
    # uploaded" hint when no history rows exist yet.
    created_at: str


class DatasetPartial(BaseModel):
    """A dataset folder that exists but couldn't be inspected."""
    id: str
    error: str


class DatasetsListResponse(BaseModel):
    rows: list[DatasetListRow]
    partial: list[DatasetPartial] = Field(default_factory=list)
```

### 2.4 `HistoryDb.dataset_stats()` helper

New method (one SQL pass, called once per `GET /api/datasets`):

```python
def dataset_stats(self) -> dict[str, dict]:
    """Per-dataset aggregates from training_runs.

    Returns ``{dataset_id: {last_used_at, run_count}}``. Empty dict
    when no history rows exist (fresh install).
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
```

### 2.5 Verify in-use guard on delete

For the 409 path, `JobManager` needs a tiny helper:

```python
def list_active_jobs_for_dataset(self, dataset_id: str) -> list[TrainingJob]:
    """Running + queued jobs whose dataset_root.name matches."""
    with self._jobs_lock:
        return [
            j for j in self._jobs.values()
            if j.dataset_root.name == dataset_id
            and j.status in {"queued", "running"}
        ]
```

DELETE route checks this; if non-empty, raises 409 with a clear
message ("Can't delete dataset 'X': run 'Y' is still training.
Cancel the run from /train/run first.").

### 2.6 Dataset naming + description — new SQLite `datasets` table

Mirrors F2's `TrainingJob.{name, description}` shape, but for
datasets. Lives in the same `<storage>/training.db` since F3 already
established that pattern.

**Schema v2** (new migration in `engine/history_db.py`):

```sql
CREATE TABLE datasets (
    id           TEXT PRIMARY KEY,        -- folder name (UUID stub)
    name         TEXT NOT NULL,           -- defaults to "Dataset <id[:8]>"
    description  TEXT NOT NULL DEFAULT '',
    created_at   TEXT NOT NULL            -- ISO 8601 UTC (capture-time)
);
```

Hand-rolled `_migrate_v1_to_v2(conn)` added to the `_MIGRATIONS`
list. Fresh installs run v0→v1→v2 transparently; existing v1 installs
get v2 on next app launch.

**Backfill on first migrate:** the v1→v2 migration scans
`<storage>/datasets/` for every existing folder, inserts a row with
default name `"Dataset <id[:8]>"` and the folder's mtime as
`created_at`. Without this, pre-F4 datasets would appear in the
library with NULL names and the UI would have to handle that
edge case for the lifetime of the install.

**New `HistoryDb` methods:**

```python
class HistoryDb:
    # ... existing F3 methods ...

    # F4: dataset metadata
    def get_dataset_meta(self, dataset_id: str) -> DatasetMeta | None: ...
    def list_dataset_meta(self) -> dict[str, DatasetMeta]: ...
    def upsert_dataset_meta(
        self,
        dataset_id: str,
        *,
        name: str | None = None,
        description: str | None = None,
        created_at: datetime | None = None,
    ) -> DatasetMeta: ...
    def delete_dataset_meta(self, dataset_id: str) -> bool: ...
```

`DatasetMeta` is a new frozen dataclass parallel to `HistoryRow`.

`upsert_dataset_meta()` is upsert because:
- Fresh upload via `POST /api/datasets/inspect` — first call, INSERT.
- Subsequent edits via PATCH — UPDATE.
- A user dropping a dataset folder externally into
  `<storage>/datasets/` before launching the app would otherwise
  leave the row missing; the GET /api/datasets path lazily upserts a
  default-named row for any folder it finds without one.

**New backend surface for naming:**

- `POST /api/datasets/inspect` — gains optional `name` + `description`
  query params (multipart already carries the files; query params
  don't conflict). On success, upserts the meta row with the supplied
  name (or the default).
- `PATCH /api/datasets/{id}` — new route, body shape:
  ```python
  class UpdateDatasetMetadataRequest(BaseModel):
      name: str | None = Field(None, max_length=200)
      description: str | None = Field(None, max_length=2000)
  ```
  Same `None`/empty-string semantics as F2's `UpdateTrainingMetadata
  Request`: None = leave as-is; empty string for description clears
  it; empty string for name resets to `"Dataset <id[:8]>"` default.
  204 No Content on success; 404 if the dataset folder doesn't
  exist on disk.
- `DELETE /api/datasets/{id}` — already covered in §2.2; also
  deletes the meta row (cascading via the existing delete path).

**Where the name surfaces in the UI:**

- `/train/dataset` upload card: a small "Name this dataset (optional)"
  input above the dropzone. Default placeholder is `"Dataset
  <stub-after-upload>"` (computed at submit time).
- Library list: name column replaces the raw UUID stub. UUID stub
  shown beneath in muted font as a forensic-only detail.
- `/train/history` dataset filter: dropdown shows names instead of
  UUID stubs.
- Detail page for a single dataset (new top-level `/datasets/<id>`
  per decision 2 — see §3.5): editable name + description, same
  pencil-icon-and-inline-edit pattern as F2/F3.

---

## 3. Frontend

### 3.1 Library lives in TWO places (per signed-off decision 2)

The same library list component is rendered in two spots:

**(a) Pick-from-library tab on `/train/dataset`** — the wizard shortcut:

```
┌────────────────────────────────────────────────┐
│ [Drop a folder]  [Pick from library]           │  ← tab toggle (new)
├────────────────────────────────────────────────┤
│ (current dropzone)                             │
│   - OR -                                       │
│ (library table — only Use-this + Delete cols)  │
└────────────────────────────────────────────────┘
```

Pick-from-library lands the user on the existing inspect-and-confirm
view, with the dataset pre-selected. Skips the upload step entirely.

**(b) New top-level `/datasets` page** — the standalone workspace.
Same library table component, but with one extra column ("Open" link
to the per-dataset detail page) and the page header gets an upload
shortcut button that lands on `/train/dataset` (Drop a folder
tab). Sidebar gets a new "Datasets" entry under Train.

Both views share `apps/web/components/datasets/library-table.tsx`
(new file). Tab-mode passes `mode="picker"` to hide the Open link
and surface a "Use this" CTA; page-mode passes `mode="browse"` to
show Open + hide Use-this. Same data fetch, same row code.

### 3.2 Library table — column layout

| Column | Notes |
|---|---|
| Name | Editable on the detail page; raw UUID stub shown beneath in muted font |
| Task | Badge (Detect / Classify) |
| Format | YOLO / COCO / ImageFolder / etc. (from inspect_dataset) |
| Images | Total image count across splits |
| Splits | Inline mini-bar — "train 80 · val 10 · test 10" |
| Last used | `formatRelative(last_used_at)` from F2 helpers ("3 days ago", "—" if never) |
| Runs | `run_count` (link to `/train/history?dataset=<id>`) |
| Actions | "Use this" (picker mode) · "Open" (browse mode) · Delete |

Sort dropdown above the table: **Most recently used** (default) / Most
runs / Newest first.

Empty state: *"No datasets yet. Drop a folder to upload your first."*
with a button to /train/dataset.

**Partial datasets render as a separate "Couldn't read" section
below the main table** (per signed-off decision 5):

```
┌──── Library ────────────────────────────┐
│  (healthy rows)                          │
└──────────────────────────────────────────┘

┌──── Couldn't read ──────────────────────┐
│  ⚠ <stub> — <error message>             │
│    [ Delete ]                            │
│  ⚠ <stub> — <error message>             │
│    [ Delete ]                            │
└──────────────────────────────────────────┘
```

The partial section is hidden when `partial: []` is empty. Delete is
allowed on partial rows (per signed-off decision 6) so users can
reclaim orphan disk space.

### 3.3 `/train/history` dataset filter improvement

F3 shipped a `Dataset` filter dropdown on `/train/history` populated from `useMemo` over the current page's rows (`seen.add(row.dataset_id)`). F4 swaps the data source to `/api/datasets` so:

- The dropdown shows every dataset that's *on disk* even if no rows on the current page reference it.
- The label is more useful (we can show "<task> · <12-char-id>" or, if §8.1 decision is for naming, the dataset name).
- Orphaned dataset IDs (rows whose folder is gone) still show in the dropdown as "<id> (deleted)" so the user can still filter by them.

Tiny change — replace the `useMemo` source with a `useQuery({queryKey: ["datasets-list"], ...})`. Lives in the same FilterBar component F3 created.

### 3.4 Delete flow

Same confirmation-modal pattern as F1's model delete + F3's history
delete, but with two warning rows when applicable (per signed-off
decision 3):

```
┌──────────────────────────────────────────────┐
│ Delete this dataset?                         │
│                                              │
│ <Dataset name>                               │
│ <dataset-id-stub · folder size MB · N images>│
│                                              │
│ ⚠ 3 training runs reference this dataset.   │
│   Their history records stay in place — they │
│   show up as "dataset deleted" in            │
│   /train/history.                            │
│                                              │
│ ℹ 2 saved checkpoints were trained on this   │
│   dataset. They stay in /models. Delete them │
│   separately from there if needed.           │
│                                              │
│   [ Cancel ]  [ Delete dataset ]             │
└──────────────────────────────────────────────┘
```

- The history-reference warning row appears only when `run_count > 0`.
- The checkpoints row appears only when at least one referenced
  history row has `library_path` populated. Count is derived from
  the row data — no extra API call needed (the rows already carry
  `library_path` from F3).
- The 409 in-use case surfaces as an inline error in the modal:
  *"Can't delete: run 'X' is still training. Cancel it first."*

### 3.5 Per-dataset detail page `/datasets/[id]`

New page at `apps/web/app/datasets/[id]/page.tsx` (same query-param
shape as `/train/history/view?id=…` for static-export compatibility:
**actual route is `/datasets/view?id=<id>`**).

Layout:

- Header: editable Name + Description (pencil + popover, same pattern
  as F2 on /train/run + F3 on history detail). Started / Last used
  / Run count line.
- Summary cards: Task / Format / Total images / Classes (with class
  count badges).
- Splits table (the existing `splits` data from `inspect_dataset`).
- Recent runs list: top 10 history rows for this dataset, link to
  each one's detail at `/train/history/view?id=<run_id>`. Link to
  the full filtered history list at the bottom.
- Action row: Re-split (links to existing /train/dataset modal flow)
  · Use for new training (jumps to /train/configure with task pre-
  selected and dataset pre-set) · Delete (same modal as the list).

This page is what the "Open" link in the library list browse mode
navigates to.

---

## 4. Tests

New file: `tests/test_datasets_library.py`. Synthetic fixtures —
build dataset folders under `tmp_path / "datasets" / "<id>"`, populate
`HistoryDb` with referencing rows, exercise routes via `TestClient`.

| Test | Asserts |
|---|---|
| `test_list_datasets_empty` | Fresh storage → 200 with `rows: []` and `partial: []` |
| `test_list_datasets_returns_inspect_data_plus_stats` | Two datasets on disk + history rows → both appear with run_count + last_used_at correctly computed |
| `test_list_datasets_filters_partial` | Dataset folder that fails `inspect_dataset()` → in `partial: []` not `rows: []` |
| `test_list_datasets_sort_order` | Three datasets with different last_used_at + one unused → sorted DESC NULLS LAST |
| `test_list_datasets_no_history_wired` | get_history returns None → list still works, run_count=0 everywhere |
| `test_dataset_stats_history_method` | `HistoryDb.dataset_stats()` returns the expected dict shape |
| `test_delete_dataset_removes_folder` | DELETE → 204 + folder gone |
| `test_delete_dataset_404_unknown` | DELETE unknown id → 404 |
| `test_delete_dataset_409_when_active_run` | Inject a running TrainingJob with matching dataset_root → DELETE returns 409 with the job's name in the detail |
| `test_delete_dataset_preserves_history_rows` | DELETE → existing training_runs rows for that id still exist (F3 graceful-orphan behaviour) |
| `test_delete_dataset_does_not_touch_library_checkpoints` | DELETE → checkpoints under models/<task>/ stay |
| `test_list_active_jobs_for_dataset_filters_correctly` | JobManager helper returns only running/queued matching jobs (not completed/failed) |

Plus a new file `tests/test_datasets_naming.py` for the naming layer:

| Test | Asserts |
|---|---|
| `test_schema_v2_migration_creates_datasets_table` | Fresh DB → migrate runs v0→v1→v2; `datasets` table exists |
| `test_v1_to_v2_migration_backfills_existing_folders` | Pre-existing dataset folders → migrate inserts default-named rows for each |
| `test_v1_to_v2_migration_is_idempotent` | Second migrate is a no-op on an already-v2 DB |
| `test_upsert_dataset_meta_inserts_and_updates` | First call inserts; second with the same id updates |
| `test_get_dataset_meta_returns_none_unknown` | Unknown id → None |
| `test_delete_dataset_meta_returns_false_unknown` | Unknown id → False; existing id → True + row gone |
| `test_inspect_route_accepts_name_and_description` | POST /api/datasets/inspect with `?name=…&description=…` → row carries them |
| `test_patch_dataset_metadata_route` | PATCH /api/datasets/{id} updates name + description; 204 |
| `test_patch_empty_name_resets_to_default` | PATCH with `{name: ""}` → name reset to `"Dataset <id[:8]>"` |
| `test_patch_unknown_dataset_returns_404` | PATCH unknown id → 404 |
| `test_list_datasets_surfaces_names` | GET /api/datasets after upserts → names appear in the response |

Plus updates to existing tests:

- `tests/test_history.py` — add a test for `dataset_stats()` (one more case).
- No changes to existing `tests/test_models_api.py` or other dataset-format tests; the new routes don't conflict.

**Frontend tests** — light per the precedent: tsc + manual verification (§5).

---

## 5. Manual verification checklist

- [ ] `uv sync --extra ml --extra desktop --extra dev` clean
- [ ] `uv run pytest -q` green (existing 89 + ~12 new from F4)
- [ ] `pnpm tsc --noEmit` clean
- [ ] `VRL_YOLO_GUI_BUILD=desktop pnpm build` fresh static export
- [ ] `python scripts/run-desktop.py` boots; schema v2 migration runs once on first launch (check `launch.log` for the migration line)
  - [ ] `/train/dataset` shows the tab toggle. Default is "Drop a folder".
  - [ ] Upload-card has the new "Name this dataset (optional)" input with the live placeholder
  - [ ] Existing pre-F4 datasets show in the library with default names (`"Dataset <stub>"`) from the v1→v2 backfill
  - [ ] Click "Pick from library" → table appears with every dataset on disk + stats from F3 history
  - [ ] Click on a name → it's editable inline (same pencil pattern as F2/F3)
  - [ ] Sort by Most runs / Last used / Newest first works
  - [ ] Partial datasets render in the separate "Couldn't read" section below the main table; Delete still works on them
  - [ ] Click "Use this" on a library row → wizard jumps to inspect-and-confirm with the dataset pre-selected
  - [ ] Click "X runs" link → navigates to `/train/history?dataset=<id>` and the filter shows the dataset's name (not UUID)
  - [ ] Sidebar shows new "Datasets" entry under Train; click → `/datasets` page with the same table in browse mode
  - [ ] Click "Open" on a row → `/datasets/view?id=<id>` detail page renders with header + summary cards + recent runs list
  - [ ] Edit name / description from the detail page → list reflects the change
  - [ ] Click Delete → confirmation modal shows referenced-runs count if any AND the soft mention of library checkpoints if any
  - [ ] Confirm Delete → dataset gone from list; history rows still listed in `/train/history` but greyed + line-through (F3 `dataset_missing` flag); library checkpoints under `/models` still present
  - [ ] `/train/history` dataset filter dropdown now uses names from `/api/datasets`, not raw UUIDs
  - [ ] Try Delete on a dataset that's actively training → 409 inline error in modal naming the run
- [ ] CHANGELOG.md + apps/web/lib/changelog.ts + PHASE-STATUS.md + CLAUDE.md updated
- [ ] pyproject.toml version bump to 0.14.0
- [ ] Tag `v0.14-f4-dataset-library`
- [ ] Push, then chore commit to backfill SHA

---

## 6. Edge cases worth flagging now

1. **Dataset folder vanishes between list and delete.** The DELETE
   route is a no-op-then-404 race; `shutil.rmtree(ignore_errors=True)`
   covers the race itself, but we still need to return 404 if the
   folder is already gone (user shouldn't see a fake success). Handled
   via an `is_dir()` check before the rmtree.
2. **Dataset folder exists but `inspect_dataset()` raises (partial).**
   Listed in `partial: []`, not `rows: []`. Delete still works on
   partial datasets (they're orphan disk space the user wants to
   reclaim). "Use this" doesn't show.
3. **Datasets with hundreds of images.** `inspect_dataset()` does a
   filesystem walk per row. For 50 datasets × 1000 images each, the
   GET list could take 1–2 s. Worth a future cache if pilot users
   complain (not blocking; lazy-load on tab click is enough).
4. **Concurrent deletes from two sessions.** Same as F1's model
   delete — second one returns 404. Tolerable.
5. **Two history rows referencing the same dataset, one with the
   library checkpoint, one without.** Delete affects neither — the
   checkpoint is a separate artifact, the rows stay (orphan-flagged).
   `run_count` shows 2; the warning copy says "2 runs reference this".

---

## 7. Versioning + commit

- **pyproject.toml:** `0.13.0` → `0.14.0` (minor: new pages + new
  routes + new schema v2 migration; backwards-compatible since
  fresh installs migrate v0→v1→v2 transparently, existing v1
  installs auto-migrate to v2 on next launch, and the existing
  `/api/datasets/inspect|split|classes|{id}` surface is untouched).
- **Tag:** `v0.14-f4-dataset-library`.
- **Commit message:** `feat(f4): dataset library — naming + library tab + /datasets page + delete + history cross-reference`.

---

## 8. Decisions (all signed off 2026-05-21)

Six decisions resolved in one round — see §1 for the consolidated
list. Nothing left blocking implementation.

**Revised estimate** (FUTURE-FEATURES.md said "Medium 3–5 days";
this plan initially said 2–3): **~3 days** of focused work
including tests. Pulling dataset naming + the standalone
`/datasets` page in (decisions 1 + 2) adds ~½–1 day on top of the
minimal F4 scope, offset by the F3 plumbing carrying most of the
weight (SQLite + HistoryDb + the cross-reference SQL pattern).

Breakdown:
- Backend ~1 day: schema v2 migration + datasets table + meta methods
  + GET list + DELETE + PATCH routes + 409 in-use guard + tests.
- Frontend ~1.5 days: shared library-table component used in both
  /train/dataset tab + /datasets page + /datasets/view detail page +
  history-filter dropdown upgrade + sidebar entry.
- Verification + release ~½ day: full smoke + binary spot-check +
  CHANGELOG + tag + push + SHA backfill.

After F4 ships, the F-chain is complete and we return to **P7
(Polish)** per PLAN.md §14.
