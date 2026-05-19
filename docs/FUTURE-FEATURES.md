# Future Features

> Refined ideas for post-v1 work. Not committed scope — captured so a
> future planning conversation has a starting point rather than rough
> notes. Each section has acceptance criteria, open questions, and a
> complexity estimate; none of them have a phase assignment yet.
>
> Original source: rough thoughts shared by Atul on 2026-05-19, refined
> in conversation before committing. The "Why" / "Open questions"
> sections are meant to surface trade-offs that need a decision before
> the work actually starts.

## Scope and sequencing

| # | Feature | Depends on | Rough complexity |
|---|---|---|---|
| 1 | Models library: delete + reveal on disk | — | Small (1–2 days) |
| 2 | Training-run name + description | — | Small (½ day) |
| 3 | Persistent training history | #2 | Medium (3–5 days) |
| 4 | Dataset library: reuse + grouping by dataset | #3 | Medium (3–5 days) |

Logical order if all four ship: **#1 (independent) · #2 → #3 → #4**.
The training-workflow chain (#2 → #4) is one connected feature set —
each layer adds to the same data model and UI surface.

---

## 1. Models library: delete + reveal on disk

### What

Two related additions to `/models`:

- **Delete user-created models** — checkpoints under `models/` that the
  user imported or saved from a training run. Bundled starter weights
  (`yolo26n.pt`, `yolo26s.pt`, `yolo26{n,s}-cls.pt`, `yolov8{n,s}.pt`,
  `yolov8{n,s}-cls.pt`) stay undeletable since they're part of the
  binary's payload.
- **Show storage path** in each model card, plus a **"Reveal in Finder
  / Explorer"** button on desktop builds.

### Why

The model library grows over time. A pilot user who trains 20 classify
runs and saves the good ones ends up with a cluttered `/models` view
and no way to clean up. Showing the path turns the library from
"opaque store" into "I know where this lives, I can back it up,
inspect it, or attach it to a Roboflow upload."

### Acceptance criteria

- `DELETE /api/models/{task}/{name}` removes a single user-created
  checkpoint. Returns 404 for unknown names, 403 (or similar) for
  bundled-models attempts. Does not delete files outside
  `<storage>/models/{task}/`.
- Model cards in `/models` show the absolute path beneath the file name
  for every model (bundled too — same affordance).
- A **"Reveal"** icon button (visible only when `settings.mode ===
  "desktop"`) opens the OS file manager scoped to the file:
  - macOS: `open -R "<path>"`
  - Windows: `explorer /select,"<path>"`
  - Linux: best-effort `xdg-open "<parent_dir>"`
- Delete UI is a confirmation modal that quotes the file name + path
  and warns if any saved prediction reports reference it (forward-ref:
  this warning becomes feasible once #3 exists; before then, no
  warning, just a plain confirm).

### Open questions

1. **Soft-delete or hard-delete?** Hard-delete is simpler; soft-delete
   (move to a `models/.trash/` dir) lets the user recover from
   accidental deletion. Recommend hard-delete with a confirmation
   modal — the macOS Finder Trash gives the user a system-level safety
   net anyway, since `models/` is under `~/Library/Application
   Support/`.
2. **Reveal-in-Finder on a sandboxed app** — when we move to notarised
   builds (post-pilot), `open -R` may be restricted. Need to verify and
   fall back to "open parent dir" if so.
3. **Web-mode reveal button** — hide it entirely (current proposal) or
   show it disabled with a "Desktop only" tooltip? Recommend hide.

### Complexity

**Small.** Three new backend lines (`DELETE` route + path-traversal
guard), one new UI affordance per card, one cross-OS reveal helper.
Bulk of the work is the confirmation-modal copy.

---

## 2. Training-run name + description

### What

Optional **Name** and **Description** fields on `/train/configure`. The
name flows through the entire pipeline: it appears in the live
training view, in save-to-library filenames, and in the future history
list (#3). The description is free-text — what the run was actually
for ("Try imgsz=320 on the partial lung dataset").

### Why

Today every training run is a UUID hex string. There's no way to look
at a saved checkpoint a week later and remember which one was "the
good imgsz=640 run vs. the failed imgsz=320 one". A human-readable
name closes that gap and is a hard prerequisite for #3 — the history
view needs a column that isn't a hash.

### Acceptance criteria

- `/train/configure` shows two new fields: **Name** (single-line,
  optional, default auto-generated as `"<Task> · <dataset-id-stub> ·
  YYYY-MM-DD HH:MM"`) and **Description** (multi-line textarea,
  optional, blank by default).
- `TrainingJob` dataclass + `JobManager.start()` accept `name` and
  `description`; both are returned in `snapshot()`.
- Save-to-library uses the slugified name when present, falling back
  to `trained-<job_id[:8]>.pt` when empty. Suffix with `-<job_id[:8]>`
  if a name collision would otherwise overwrite an existing checkpoint.
- `PATCH /api/training/jobs/{id}` lets the name + description be
  updated post-hoc (the live training view stays editable until the
  run completes; afterward edits flow to the history record from #3).

### Open questions

1. **Default name format** — task + dataset + timestamp is informative
   but long. Alternative: just `"<dataset-id-stub> · HH:MM"` and let
   the user override. Trade-off: shorter defaults look nicer in lists
   but are easier to forget the context of.
2. **Slug strategy** — Python's `slugify`? Manual `re.sub(r"\W+", "-")`?
   Need to handle Unicode (a doctor might name a run in Hindi).
   Recommend a small `_slugify()` helper that lowercases ASCII +
   replaces non-alnum with `-` + collapses runs of `-`.

### Complexity

**Small.** Two text inputs, one backend dataclass field per field, one
slugify helper. The patch endpoint is a one-line route.

---

## 3. Persistent training history

### What

Every training run (running, completed, failed, cancelled) lands in a
persistent record. A new `/train/history` page lists them; a detail
view per run replays the full live-training charts and shows the exact
hyperparameters / outcome / model location.

### Why

Today the `JobManager` keeps in-memory state for the current process
only. When the app quits, every record disappears — even the v0.8.5
graceful-cancel path means the run finished but the snapshot is gone.
A pilot user who trains 30 runs over a week has zero recoverable
record of what they tried and what worked. This is the single biggest
gap between "useful demo" and "tool a clinician actually adopts."

### Acceptance criteria

**Persistence layer:**

- SQLite at `<storage_root>/training.db`, schema versioned via
  Alembic or a simple custom `schema_version` table (Alembic is the
  cleaner long-term option).
- One row per run with the columns the user listed plus a few more:

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT | the existing UUID-hex job id |
| `name` | TEXT | from #2 |
| `description` | TEXT | from #2 |
| `task` | TEXT | `detect` / `classify` |
| `dataset_id` | TEXT | references `<storage>/datasets/<id>/` |
| `dataset_snapshot_json` | JSON | inspector output captured at start time (in case the dataset folder later changes) |
| `base_model` | TEXT | which weights the run started from |
| `epochs`, `imgsz`, `batch` | INT | hyperparams |
| `accelerator_kind`, `device_arg` | TEXT | what hardware ran it |
| `started_at`, `finished_at` | TIMESTAMP | |
| `status` | TEXT | `running` / `completed` / `failed` / `cancelled` |
| `error_message` | TEXT | nullable |
| `best_pt_path` | TEXT | absolute path under `<storage>/training/<id>/` |
| `library_path` | TEXT | absolute path under `<storage>/models/<task>/` if saved-to-library; nullable otherwise |
| `final_metrics_json` | JSON | `{top1, top5, mAP50, ...}` |

- A sidecar JSONL file `<storage>/training/<id>/events.jsonl` keeps
  the live event stream (one event per line) for chart replay. Kept
  out of SQLite so the row stays small + queryable.

**UI:**

- `/train/history` — sortable / filterable table: Name · Task ·
  Dataset · Started · Duration · Status · Best metric · Model in
  library?
- `/train/history/<id>` — detail view that re-uses the existing live
  training chart components. Replays from the events.jsonl file.
  Shows the full config, the final metrics, the path of the saved
  checkpoint (if any), and the error trail (if any).
- Action: **Re-run with same settings** — prefills the wizard, lets
  the user adjust a few fields, kicks off a new run. The new run gets
  its own row.
- Action: **Delete from history** — confirmation modal warns if the
  associated library checkpoint exists (separate decision: delete the
  checkpoint too?).
- Action: **Edit name / description** post-hoc.

**Cross-links:**

- `/models` cards link back to the training-history row that produced
  them (when traceable via `library_path`).
- `/train/run` writes its events into `events.jsonl` from the start
  so a mid-run quit doesn't lose history.

### Open questions

1. **SQLite vs. JSON-per-run** — JSON-per-run is more git-friendly +
   simpler to debug + no dependency, but querying "all classify runs
   sorted by top1" becomes a manual walk of N files. Recommend SQLite
   — Python ships it, footprint is tiny, it makes the history page
   trivially fast.
2. **Schema migrations** — Alembic adds a real dependency; a hand-
   rolled `schema_version` int + a list of `_migrate_v1_to_v2()`
   functions is leaner for a 1-table schema. Recommend hand-rolled
   for v1.1, switch to Alembic if the schema grows past 4–5 tables.
3. **Retention** — keep training rows forever or auto-purge after N
   days? Probably forever; offer a manual "Clean up runs older than
   30 days" button.
4. **What happens to a row when its dataset folder is deleted?**
   Recommend: row stays, marked `dataset_missing: true`. Re-run with
   same settings is disabled in that case.
5. **Concurrency** — SQLite + a single writer (the FastAPI process)
   is fine. If we ever ship multi-process training (Colab + local
   simultaneously), revisit.
6. **Events.jsonl size** — a 200-epoch detect run is maybe 5 MB of
   events. After 50 runs that's 250 MB. Worth a "compress old
   events.jsonl on completion" pass? Recommend gzip after status flips
   to `completed`.

### Complexity

**Medium.** New persistence layer + two new pages + integration with
existing live-training flow. The trickiest piece is making sure
existing runs (started but not yet recorded) get rows on the fly when
the migration ships.

---

## 4. Dataset library: reuse + grouping by dataset

### What

Two related features built on top of #3:

- **Reuse uploaded datasets** — `/train/dataset` step gains a tab
  toggle: "Drop a folder" (current behaviour) vs "Pick from library."
  The library tab lists every dataset already uploaded.
- **Implicit workspace grouping** — in `/train/history`, filter / sort
  by dataset shows all runs that share a dataset. No explicit
  "Workspace" entity needed; the dataset IS the implicit group.

### Why

Today, every training run forces a fresh upload of the dataset — even
if the user just trained on it five minutes ago. The backend keeps
the dataset at `<storage>/datasets/<uuid>/` permanently, but the
wizard never offers "pick existing." For a clinical researcher
iterating on hyperparameters against a fixed dataset, this is the
biggest workflow friction in the app.

Your original framing was a "Workspace" concept that groups jobs by
shared dataset. Refined view: workspace as a first-class entity adds
schema complexity without value over `GROUP BY dataset_id`. The
implicit grouping in the history view delivers the same UX with no
extra concepts.

### Acceptance criteria

**Dataset library:**

- New `/api/datasets` (list) returns every dataset under
  `<storage>/datasets/`, with task, image count, split layout, and
  (from #3) `last_used_at` + `run_count`.
- `/train/dataset` gains a two-tab card: **Drop a folder** (existing
  dropzone) vs **Pick from library**. Library tab is a list with the
  fields above, plus a "Use this dataset" CTA.
- Picking a library dataset skips the upload step entirely — the
  wizard jumps to dataset-inspect with the existing dataset id.

**Filtering in history:**

- `/train/history` page header gets a "Dataset" filter dropdown
  populated from distinct `dataset_id` values, with the dataset name
  / id stub as the option label.
- The dataset library list links to "View all runs on this dataset"
  (= `/train/history?dataset=<id>`).

**Dataset deletion:**

- `DELETE /api/datasets/{id}` removes the dataset folder.
  Confirmation modal warns if there are saved training-history rows
  referencing it ("3 runs reference this dataset; their checkpoints
  remain in the library but the dataset itself will be gone — re-run
  with same settings will be unavailable for them"). Doesn't delete
  the runs themselves.

### Open questions

1. **Dataset naming** — datasets are currently UUID-only. Should the
   user name them too? Probably yes — same pattern as #2 (optional
   name + description). The library list reads much better with names
   than with UUID stubs. Could be folded into #2's scope or done
   separately.
2. **Re-classified dataset semantics** — your original wording was
   "previously re-classified (splitted) dataset." Once the splitter
   has run on a dataset, the dataset folder is permanently in the
   split shape. So "use the dataset I split last time" is the same as
   "pick from library" — the split is part of the dataset's state,
   not a separate artefact. Worth confirming this matches your mental
   model before building.
3. **Should the library tab also show shared datasets?** Multi-user
   shared datasets are explicitly out of v1 scope per PLAN.md §13.5.
   Library lists local-only datasets here.
4. **What about partially-uploaded datasets?** If a dataset upload
   failed halfway, should the library hide it? Recommend yes — only
   list datasets that pass `inspect_dataset` without raising.

### Complexity

**Medium.** New listing endpoint, a tabbed picker UI, a filter on the
history page, a delete flow. Most of the complexity is making the
mental model clear in the UI ("library" vs "drop new").

---

## Cross-cutting notes

### What does NOT need to change

- The current "drop folder → inspect → configure → run" wizard stays
  the default path. The library tab is a shortcut, not a replacement.
- `<storage>/datasets/<uuid>/` layout stays exactly as it is. The
  library list is just a new view onto existing on-disk state.
- `JobManager` stays the in-memory runtime supervisor. #3's
  persistence layer is a writer that observes Job lifecycle events
  and reflects them into SQLite; the supervisor doesn't have to know
  about it.

### Phasing recommendation

If we build these post-pilot, group them into two phases:

- **P-models-polish** (#1) — independent, lands as a quick patch.
- **P-history-and-library** (#2 → #3 → #4 as a single coherent
  feature set) — one larger phase, since #3's persistence is what
  makes #4's "last_used_at + run_count" meaningful, and #4's
  library list is what makes #3's history page useful as a filter
  destination.

### When to revisit

After the v1 pilot (P10). If pilot users repeatedly ask "where do my
old runs go?" or "do I really have to re-upload this dataset?", these
move from "future ideas" to "v1.1 commitments."
