# F2 Plan — Training-run name + description

> Concrete plan for **Future Feature #2** from `docs/FUTURE-FEATURES.md`.
> **Not yet committed to implementation** — this doc captures the design
> + open decisions for sign-off before any code lands. Foundation for
> F3 (persistent training history).
>
> Once signed off, this becomes the F2 section in `docs/PHASE-STATUS.md`
> at phase boundary, plus the matching `CHANGELOG.md` / `changelog.ts`
> entries.

---

## 1. Scope summary

Optional **Name** and **Description** fields on every training run.
Name flows end-to-end:

- Set (or auto-default) on `/train/configure` before Start.
- Carried by `TrainingJob` + visible on `/train/run`.
- Editable while the run is in flight (PATCH).
- Slugified into the saved-to-library filename when the user
  finishes a run and clicks Save.

The data layer change is small but foundational: F3's history page
needs **a column that isn't a hash**, and that column is what F2
introduces. F4's "filter runs by dataset" view also benefits from
human-readable names.

Out of scope for F2 (lands in F3):

- Persisting name/description after the app quits. F2 keeps them
  in `JobManager`'s in-memory state, same as the rest of `TrainingJob`.
- Editing the name on a *completed* run. F2's PATCH endpoint is
  gated to `status in {queued, running}` — for completed runs the
  edit needs the F3 persistence layer to land somewhere meaningful.

User decisions signed off (2026-05-21):

1. **Default name format:** `<Task> · <dataset-id-stub> · YYYY-MM-DD HH:MM`.
2. **Slug strategy:** add `python-slugify` dep to handle Unicode
   names (Hindi, other scripts) correctly.
3. **PATCH reject code:** 409 Conflict (resource state forbids edit;
   request is well-formed).
4. **Default-name timezone:** use `datetime.astimezone()` (system
   local TZ), with a user-overridable **timezone setting** in app
   Settings. See §9 below — chosen scope is *wide* (every UI
   timestamp respects the setting, via a shared `formatDate`
   helper, so F3/F4/etc. all use the same plumbing).
5. **Slug case:** preserve case (`lowercase=False`).
6. **Description cap:** 2000 characters.
7. **Live placeholder:** yes — `/train/configure` placeholder
   rebuilds when task / dataset change.
8. **Description-edit affordance on `/train/run`:** popover, not a
   card or separate page.

---

## 2. Backend

### 2.1 New dep: `python-slugify>=8.0`

Added to `pyproject.toml` `[project] dependencies` (not optional —
the slugifier runs on every save-to-library call, so it has to be
present in the base wheel). `~30 KB` install footprint, pure
Python, no native deps.

Used with `allow_unicode=True` so a clinician naming a run
`"फेफड़े का वर्गीकरण 14:30"` gets a filename like
`फेफड़े-का-वर्गीकरण-14-30.pt` rather than the default
transliterated `phephre-ka-vargikaran-14-30.pt`. Per the user's
decision to support Unicode names directly.

### 2.2 New helper: `_slugify_run_name()` in `engine/training.py`

```python
from slugify import slugify as _slugify_lib

def _slugify_run_name(name: str) -> str:
    """Filesystem-safe slug, preserving Unicode for non-Latin names.

    Returns empty string for input that slugifies to nothing (pure
    punctuation, whitespace only). Caller is responsible for the
    fallback to `trained-<job_id[:8]>.pt`.
    """
    return _slugify_lib(
        name.strip(),
        max_length=80,           # leaves headroom for `-<stub>.pt` suffix
        word_boundary=True,       # don't cut mid-word at the length cap
        allow_unicode=True,       # preserve Devanagari, Han, Cyrillic, etc.
        lowercase=False,          # case carries information in some scripts
    )
```

### 2.3 New helper: `_default_run_name()`

```python
def _default_run_name(task: JobTask, dataset_id: str, when: datetime) -> str:
    """Auto-generated name per the F2 decision pass.

    Format: ``<Task> · <dataset-id-stub> · YYYY-MM-DD HH:MM`` where
    Task is title-cased and the dataset stub is the first 8 chars of
    the dataset UUID (which is what shows up in /train/dataset and
    matches the on-disk folder name).
    """
    task_label = "Detect" if task == "detect" else "Classify"
    stub = dataset_id[:8]
    return f"{task_label} · {stub} · {when:%Y-%m-%d %H:%M}"
```

Lives in `engine/training.py` next to `_slugify_run_name` so both
the start path and the save path can use them.

### 2.4 `TrainingJob` dataclass changes

```python
@dataclass
class TrainingJob:
    job_id: str
    dataset_root: Path
    model: str
    task: JobTask
    epochs_total: int
    imgsz: int
    batch: int
    accelerator_kind: str
    output_dir: Path
    started_at: datetime
    status: JobStatus = "queued"
    name: str = ""               # NEW — non-None invariant
    description: str = ""        # NEW — non-None invariant
    epoch_current: int = 0
    # ... (existing fields)
```

- Stored as plain strings (`""` for "not set"), not `Optional[str]`,
  to avoid a `None | ""` ambiguity at the API layer.
- Name is always populated — `JobManager.start()` fills the default
  before constructing the job if the caller passed empty.

`snapshot()` adds them at the top of the dict (right after
`job_id`) so they show up first in any debug dump.

### 2.5 `JobManager.start()` + `start_colab_job()` accept name + description

Both methods get two new kwargs:

```python
def start(
    self,
    *,
    dataset_root: Path,
    model_path: str,
    task: JobTask,
    epochs: int,
    imgsz: int,
    batch: int,
    name: str = "",          # NEW
    description: str = "",   # NEW
) -> TrainingJob:
```

Inside, before the `TrainingJob(...)` construction:

```python
started_at = datetime.now(timezone.utc)
final_name = name.strip() or _default_run_name(
    task, dataset_root.name, started_at
)
```

`start_colab_job(tunnel_url, *, name="", description="")` follows
the same pattern; the default name uses the dataset id from the
Colab session (already in the snapshot the WS pre-flight returns).

### 2.6 `JobManager.update_metadata(job_id, name, description)` — new method

```python
def update_metadata(
    self,
    job_id: str,
    *,
    name: str | None = None,
    description: str | None = None,
) -> TrainingJob:
    """Live-edit a run's name + description.

    Gated to `status in {queued, running}` — after a run completes,
    edits need the F3 history layer to land somewhere durable.
    Until F3 ships, completed runs are read-only.

    Either field can be None (meaning "don't touch this field");
    passing both as None is a no-op. Empty string is a valid value
    for `description` (clears it); for `name`, empty string resets
    to the auto-generated default (so the user can re-derive the
    placeholder by clearing the field).
    """
    job = self.get(job_id)
    if job is None:
        raise KeyError(job_id)
    with job._lock:
        if job.status not in {"queued", "running"}:
            raise ValueError(
                f"job is {job.status!r}; can only edit name/description "
                "on queued or running runs (history edits land in F3)"
            )
        if name is not None:
            stripped = name.strip()
            if not stripped:
                job.name = _default_run_name(
                    job.task, job.dataset_root.name, job.started_at
                )
            else:
                job.name = stripped[:200]   # cap matches schema
        if description is not None:
            job.description = description.strip()[:2000]
    return job
```

### 2.7 `JobManager.save_to_library()` uses the slugified name

Current behaviour: filename is always `trained-<job_id[:8]>.pt`.

New behaviour:

```python
def save_to_library(self, job_id, *, registry):
    # ... existing prelude (Colab fetch, completed-status check) ...

    slug = _slugify_run_name(job.name)
    if not slug:
        # Defensive: every job has name populated, but a slug-empty
        # input (pure punctuation) falls back to the old naming.
        run_label = f"trained-{job_id[:8]}.pt"
    else:
        run_label = f"{slug}.pt"

    dest = dest_dir / run_label
    # Name-collision disambiguation: if the slug already exists in
    # the user models dir (e.g. user re-saved a run with the same
    # default-derived name), suffix the job stub so neither file
    # overwrites the other.
    if dest.exists():
        stem = dest.stem
        run_label = f"{stem}-{job_id[:8]}.pt"
        dest = dest_dir / run_label

    shutil.copy2(job.best_pt, dest)
    registry.scan()
    return dest
```

### 2.8 Schema updates

In `server/vrl_yolo/api/schemas.py`:

```python
class StartTrainingRequest(BaseModel):
    dataset_id: str
    model: str
    epochs: int = Field(50, ge=1, le=2000)
    imgsz: int = Field(640, ge=64, le=2048)
    batch: int = Field(8, ge=1, le=128)
    name: str = Field("", max_length=200)         # NEW
    description: str = Field("", max_length=2000) # NEW


class ColabConnectRequest(BaseModel):
    tunnel_url: str = Field(..., min_length=10, max_length=2048)
    name: str = Field("", max_length=200)         # NEW
    description: str = Field("", max_length=2000) # NEW


class UpdateTrainingMetadataRequest(BaseModel):
    """Body for `PATCH /api/training/{job_id}`.

    Both fields optional — pass only what's changing. None means
    "leave this field as-is"; explicit empty string for `description`
    means "clear it"; explicit empty string for `name` means "reset
    to the auto-generated default".
    """
    name: str | None = Field(None, max_length=200)
    description: str | None = Field(None, max_length=2000)


class TrainingJobInfo(BaseModel):
    job_id: str
    name: str = ""                # NEW
    description: str = ""         # NEW
    status: TrainingStatus
    # ... (existing fields)
```

### 2.9 New route: `PATCH /api/training/{job_id}`

In `server/vrl_yolo/api/routers/training.py`:

```python
@router.patch("/{job_id}", response_model=TrainingJobInfo)
def update_training_metadata(
    job_id: str,
    body: UpdateTrainingMetadataRequest,
    manager: JobManager = Depends(get_job_manager),
) -> TrainingJobInfo:
    """Edit the name + description of an in-flight training run.

    Gated to queued / running runs. Completed / failed / cancelled
    runs are read-only until F3 ships the persistent history layer.
    """
    try:
        job = manager.update_metadata(
            job_id, name=body.name, description=body.description
        )
    except KeyError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"job {job_id!r} not found",
        ) from exc
    except ValueError as exc:
        # ValueError is the gate-rejection ("can only edit queued/running").
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=str(exc)
        ) from exc
    return _job_to_info(job)
```

409 (Conflict) rather than 400 — the request itself is well-formed,
the *current state* of the resource forbids the edit. Standard REST
semantics, matches what we'd want for "run already completed."

`_job_to_info()` already forwards `snapshot()` field-for-field;
once name + description land in snapshot, they show up here for
free.

---

## 3. Frontend

### 3.1 `apps/web/lib/types.ts`

```typescript
export interface TrainingJobInfo {
  job_id: string;
  name: string;                   // NEW
  description: string;            // NEW
  status: TrainingStatus;
  // ... (existing fields)
}
```

### 3.2 `apps/web/lib/api.ts`

```typescript
export interface StartTrainingArgs {
  dataset_id: string;
  model: string;
  epochs?: number;
  imgsz?: number;
  batch?: number;
  name?: string;          // NEW
  description?: string;   // NEW
}

// connectColab gains the same two optional fields.
export async function connectColab(
  tunnelUrl: string,
  opts: { name?: string; description?: string } = {},
): Promise<StartTrainingResponse> { ... }

// NEW
export async function updateTrainingMetadata(
  jobId: string,
  patch: { name?: string; description?: string },
): Promise<TrainingJobInfo> {
  return fetchJson(
    `${API_BASE}/training/${encodeURIComponent(jobId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    },
  );
}
```

### 3.3 `/train/configure` — two new inputs

Above the existing hyperparameter card, add a small **Run details**
card with two fields:

- **Name** — single-line input, optional. Placeholder shows the
  *server-computed default* live as the user picks task + dataset:
  the placeholder is what the server will use if the field is left
  blank, so the user never sees a mystery filename later. Built
  client-side from the same `<Task> · <dataset-id-stub> · YYYY-MM-DD HH:MM`
  format (kept in a small helper `defaultRunName()` in
  `apps/web/lib/training-defaults.ts` for parity with the server).
- **Description** — multi-line textarea, optional, 3 rows. Placeholder
  `"What's this run for? e.g. 'Try imgsz=320 on the partial lung dataset.'"`.

Both pass straight through to `startTraining({...})` and
`connectColab(url, {name, description})`.

Visual placement: between the model/dataset section and the
hyperparameter card. Card title: **Name this run** (optional).
Subtitle: small grey line — *"Helps you find this run later in
Models or History."*

### 3.4 `/train/run` — show the name + inline edit

Top of the page (above the status pill), show the run name in
`text-xl font-semibold`. Click → flips to an inline input
(same pattern as the rename flow on `/models`). Save calls
`updateTrainingMetadata(jobId, {name: draft})`; Cancel reverts.

Description: show below the name as a small italic line; click
opens a small popover with a textarea + Save/Cancel.

Both edit affordances disappear once `status !== "queued"
&& status !== "running"` — replaced with a small grey tooltip
text "Editing locked after the run finishes (re-enabled when
history persistence lands in F3)."

### 3.5 No new component file for the inline editor

Following the user's no-premature-abstraction rule: the
inline-name editor is small enough (~40 lines) to live directly
inside `app/train/run/page.tsx`, same way the rename flow
lives inside `app/models/page.tsx`. We extract a reusable
`InlineTextEdit` component if and when F3's history page reuses
the pattern.

---

## 4. Tests

New file: `tests/test_training_naming.py`. Synthetic JobManager
(no real subprocess — same pattern as `tests/test_models_api.py`
uses for the registry) to keep the suite fast.

| Test | Asserts |
|---|---|
| `test_default_name_format_when_name_omitted` | Start with no `name` → snapshot's `name` matches `<Task> · <stub> · YYYY-MM-DD HH:MM` for the configured task + dataset |
| `test_explicit_name_flows_through_to_snapshot` | Start with `name="My run"` → snapshot shows `My run` verbatim |
| `test_description_flows_through_to_snapshot` | Same for description |
| `test_patch_updates_name_on_running_job` | Start → PATCH `{name: "Renamed"}` → snapshot's name is `Renamed` |
| `test_patch_with_empty_name_resets_to_default` | PATCH `{name: ""}` → snapshot's name is the auto-generated default |
| `test_patch_with_none_leaves_field_untouched` | PATCH `{description: "X"}` → name unchanged |
| `test_patch_rejected_on_completed_job_with_409` | Force job status to `completed` → PATCH returns 409 with the gate message |
| `test_patch_rejected_on_failed_job_with_409` | Same for `failed` |
| `test_patch_404_on_unknown_job` | PATCH unknown id → 404 |
| `test_save_to_library_uses_slugified_name` | Name `"Lung Classify Run"` → file `lung-classify-run.pt` |
| `test_save_to_library_preserves_unicode_name` | Name `"फेफड़े वर्गीकरण"` → file with the Devanagari slug preserved (Unicode chars in filename) |
| `test_save_to_library_falls_back_when_slug_empty` | Name `"!!!"` → slugifies to "" → file is `trained-<job_id[:8]>.pt` (existing fallback) |
| `test_save_to_library_disambiguates_name_collision` | Two runs save with the same slug → second file is `<slug>-<job_id_stub>.pt`, neither overwrites |
| `test_start_training_route_accepts_name_and_description` | POST /api/training/start with name + description → 202 and subsequent GET returns them |
| `test_colab_connect_route_accepts_name_and_description` | Same for /colab/connect — mocked tunnel pre-flight |

Frontend smoke is light per the F1 precedent (TS type-check + manual
verification in §5). The inline-edit + placeholder behaviour is
visual and gets verified by the spot-check below.

---

## 5. Manual verification checklist

Before shipping:

- [ ] `uv sync --extra ml --extra desktop --extra dev` clean
- [ ] `uv run pytest tests/test_training_naming.py tests/test_models_api.py -q` green
- [ ] `uv run pytest tests/test_colab_server_smoke.py tests/test_colab_integration_smoke.py -q` still green (regression check on the schema change)
- [ ] `pnpm tsc --noEmit` clean
- [ ] `VRL_YOLO_GUI_BUILD=desktop pnpm build` produces fresh `apps/web/out/`
- [ ] `python scripts/run-desktop.py` boots
  - [ ] /train/configure shows Name + Description fields with the live placeholder
  - [ ] Placeholder rebuilds when task / dataset selection changes
  - [ ] Start a run with explicit name → /train/run shows it at the top
  - [ ] /train/run shows "Started at" timestamp in the current TZ
  - [ ] Click name on /train/run → inline edit → save → snapshot reflects change
  - [ ] Click description → popover with textarea → save → snapshot reflects change
  - [ ] Run completes → editing affordance becomes the grey "locked" text
  - [ ] /train/run shows "Finished at" + "Elapsed Xm Ys" once complete
  - [ ] Save to library → /models card shows the slug-derived filename, not `trained-<stub>.pt`
  - [ ] /settings shows the Timezone section with system detection + IANA combobox
  - [ ] Change TZ to e.g. UTC → /train/configure placeholder + /train/run timestamps re-render in UTC without page refresh
  - [ ] Switch back to "Use system timezone" → renders back to local TZ
  - [ ] Try a Unicode name (e.g. Devanagari) → save-to-library produces a filename with the script preserved
- [ ] CHANGELOG.md + apps/web/lib/changelog.ts entry for v0.11.0
- [ ] docs/PHASE-STATUS.md F2 section + snapshot row flip
- [ ] pyproject.toml version bump to 0.11.0
- [ ] CLAUDE.md status line for F2
- [ ] Tag `v0.11-f2-run-naming`
- [ ] Push, then chore commit to backfill SHA

---

## 6. Edge cases worth flagging now

1. **Naming a run mid-flight while a save-to-library is queued.**
   The save path reads `job.name` at the moment of copy, not at job
   start, so the latest edit wins — which matches the user's mental
   model of "the name I see on /train/run is the filename I get."
   No locking needed beyond the existing per-job lock.
2. **Two runs given the same name explicitly.** Disambiguated at
   save-time per §2.7 with the job-id stub suffix. Pre-save
   collision in `JobManager` state isn't a concern (the id is the
   uniqueness key, not the name).
3. **Very long name with multibyte characters.** `max_length=200`
   on the schema counts characters not bytes; combined with
   slugify's `max_length=80` on the filename, the on-disk slug
   stays well under filesystem limits (HFS+/APFS allow 255 bytes
   per filename component; NTFS allows 255 UTF-16 code units).
4. **A run started before this code shipped.** F2 doesn't persist
   anything to disk, so there's no migration concern — old jobs
   simply don't have a name set, and `JobManager.start()` always
   populates it from now on. Pre-F2 in-flight jobs (would only
   exist mid-deploy, which we don't do) would degrade gracefully
   to empty-string in `snapshot()`.
5. **Colab job that drops + reconnects.** P6c's reconnect logic
   doesn't touch metadata; `name` and `description` survive a
   tunnel drop because they're stored on `TrainingJob` itself,
   not on the Colab session.

---

## 7. Versioning + commit

- **pyproject.toml:** `0.10.0` → `0.11.0` (minor — new user-visible
  feature + new request shapes + new settings section;
  backwards-compatible since all new fields default to empty / system).
- **Tag:** `v0.11-f2-run-naming`.
- **Commit message:**
  `feat(f2): training-run name + description + app-wide TZ setting`.

---

## 8. Decisions (all signed off 2026-05-21)

Eight decisions resolved in two rounds — see §1 for the consolidated
list. Nothing left blocking implementation.

**Revised estimate** (was ½ day in FUTURE-FEATURES.md, ½–1 day in
the original §7 of this plan): **~1 day** of focused work including
tests, accounting for the timezone setting plumbing in §9. The
TZ work is mostly *one-time helper construction* — once the
`formatDate()` helper and the `useTimezone()` hook exist, F3/F4
and any future timestamp surface plugs in for free.

---

## 9. Timezone setting (wide scope)

The user's preferred timezone lives in app Settings and drives
every UI timestamp render. Server timestamps stay UTC on the wire
(unchanged); the client converts at display time.

### 9.1 Where current timestamp surfaces are

Audited the frontend on 2026-05-21. Findings: the current UI has
**very few timestamp renders**.

| Surface | Current behaviour | F2 change |
|---|---|---|
| `/changelog` | `release.date` is a hardcoded `"YYYY-MM-DD"` string baked into `lib/changelog.ts`. Same release shows the same date to everyone. | No-op — date-only, not a timestamp |
| `/train/configure` | No timestamps today | **F2 adds the live name placeholder** — uses `formatDate(now, {dateStyle, timeStyle, timeZone})` |
| `/train/run` | Shows live epoch progress + metrics; no `started_at` / `finished_at` rendered | **F2 adds** "Started at" + (when complete) "Finished at" + "Elapsed Xm Ys" — all via `formatDate()` |
| `/models` | No timestamps on cards today | No-op for F2 — F3 will add "Trained on" date and use `formatDate()` then |
| `/predict` | No timestamps | No-op |
| `/train/dataset` | No timestamps | No-op |

So the *immediate* footprint of the wide TZ scope is small: two
new render sites (configure placeholder + train/run timestamps),
both introduced by F2 itself. The value of building the wide
plumbing now is that F3's history page (which will have a sortable
"Started" column + "Duration" column + "Last edited" — all
timestamps) plugs into `formatDate()` instead of inventing
yet-another date helper.

### 9.2 Setting design

In **`/settings`**, add a new section **Timezone**:

```
[ Use system timezone (Asia/Kolkata, detected) ]   ← default radio
[ Use a different timezone ]                       ← radio
    [ ▼ Asia/Kolkata                            ]  ← combobox of IANA zones
                                                     populated from
                                                     Intl.supportedValuesOf('timeZone')
```

The detected system TZ comes from `Intl.DateTimeFormat()
.resolvedOptions().timeZone`. The combobox lists ~420 IANA zones
returned by `Intl.supportedValuesOf('timeZone')` (supported in
all current evergreens including QtWebEngine's bundled Chromium).
A small search-as-you-type filter lets the user find their zone
without scrolling.

### 9.3 Persistence

`localStorage` key: `vrl-yolo-gui.timezone`. Values:

- `"system"` (default) — use `Intl.DateTimeFormat().resolvedOptions().timeZone`
- `"<IANA zone>"` (e.g. `"Asia/Kolkata"`, `"UTC"`, `"America/New_York"`) — use this verbatim

Same pattern as the existing settings entries in `/settings` per
P3b. No new persistence dependency.

### 9.4 `lib/format-date.ts` — the shared helper

New file:

```typescript
type FormatDateOptions = {
  dateStyle?: Intl.DateTimeFormatOptions["dateStyle"];
  timeStyle?: Intl.DateTimeFormatOptions["timeStyle"];
  /** Override the user's setting for one specific render. */
  timeZone?: string;
};

/**
 * Format an ISO 8601 / Date / epoch ms value in the user's
 * preferred timezone (from settings, defaulting to system).
 *
 * Returns "—" for null / undefined / unparseable input so render
 * sites can use this directly without null guards.
 */
export function formatDate(
  value: string | Date | number | null | undefined,
  opts: FormatDateOptions = {},
): string { ... }

/**
 * Compact relative formatter ("3 min ago", "2h ago", "yesterday").
 * Useful for "Started X ago" labels. Timezone-agnostic (the
 * difference is the same regardless of TZ), but exposed here for
 * one-stop date imports.
 */
export function formatRelative(
  value: string | Date | number | null | undefined,
): string { ... }
```

Reads the TZ setting via a small `getPreferredTimezone()`
function that consults localStorage with a system-default
fallback. Both helpers stay pure (no React); a thin
`useFormatDate()` hook wraps them with `useSyncExternalStore`
on the localStorage key so a setting change re-renders every
timestamp without a manual refresh.

### 9.5 `defaultRunName()` client helper

Lives in `apps/web/lib/training-defaults.ts` (already planned
in §3.3). Uses `formatDate(new Date(), {dateStyle: 'short',
timeStyle: 'short', timeZone: preferred})` so the placeholder
matches the user's TZ. Server-side fallback (`_default_run_name`)
uses `datetime.now().astimezone()` (system TZ) — only fires when
a non-UI caller posts an empty name.

### 9.6 Tests

Frontend:

- `apps/web/lib/__tests__/format-date.test.ts` (new file —
  introduces vitest if not already present; if the project has
  no JS test runner yet, this becomes a tsc-only smoke check
  for the type signatures, with verification in §5 manual).
  Cases: explicit timezone override; system fallback when
  localStorage missing; null/undefined → "—"; relative
  formatter boundaries (just now / minutes / hours / yesterday).

Backend: no new tests for TZ — server stays in UTC on the wire,
and `_default_run_name` is exercised by the existing
`test_default_name_format_when_name_omitted` test (frozen
`datetime.now()` via `freezegun` or `monkeypatch`).

### 9.7 Settings page change scope

Just one new section ("Timezone") on `/settings`. Reuses existing
form primitives. No new dependencies.

---
