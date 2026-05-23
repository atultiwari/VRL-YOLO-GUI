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
| 1 | Models library: delete + reveal on disk | — | Small (1–2 days) ✅ shipped v0.10.0 |
| 2 | Training-run name + description | — | Small (½–1 day) ✅ shipped v0.11.0 |
| 3 | Persistent training history | #2 | Medium (3–5 days) ✅ shipped v0.12.0 |
| 4 | Dataset library: reuse + grouping by dataset | #3 | Medium (3–5 days) ✅ shipped v0.14.0 |
| 5 | Auto-save trained models to library (Settings toggle, default ON) | #3 (full benefit) | Small (½ day) ✅ shipped v0.13.0 |
| 6 | Explainable AI (heatmaps + per-detection rationale) | #1 (model library) | **Medium-large (1–2 weeks)** |
| 7 | MCP integration (Claude / ChatGPT / any compatible client) | #3, #4 (history + dataset library) | **Medium (3–5 days)** |

Logical order if all four ship: **#1 (independent) · #2 → #3 → #4**.
The training-workflow chain (#2 → #4) is one connected feature set —
each layer adds to the same data model and UI surface. **#5 is
independent in code** (~½ day frontend-only) but reads naturally
*after* #3 ships, since the auto-save path benefits from being able
to surface the saved checkpoint in the history record. We can ship
#5 between #3 and #4, or alongside #3 if the user wants the
behaviour-change rolled in earlier.

**#6 and #7 are post-pilot candidates** (added 2026-05-23). Both target
clinician-trust and power-user adoption respectively, not the core
"drop a folder, get an answer" loop that v1 has to nail first. #6
depends on shipped Predict + Models surfaces (#1). #7 depends on the
F3/F4 data model so the MCP server has something meaningful to expose
beyond "predict one image."

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

## 5. Auto-save trained models to library

### What

A new Settings toggle: **"Auto-save trained models to library"** (default
**ON**). When ON, the moment a training run hits `status === "completed"`,
the desktop kicks off the existing save-to-library flow automatically —
the user lands on `/train/run`, sees training progress, sees the
completion banner, and a moment later the trained checkpoint is already
in `/models` without needing to click anything. When OFF, behaviour is
exactly today's: the **Save to library** button stays on `/train/run`
and only fires on click.

### Why

A clinician who walks away during a 200-epoch overnight run comes back
to find the model already in `/models`, ready for `/predict`. Today
they'd come back to a finished run and need to remember to click
**Save to library** before they can use the model — a step that's easy
to forget when the run completed hours ago and the page is buried in a
tab. Default ON because "the model I just spent 3 hours training is in
my library" is the obvious-good-default for a clinical workflow tool.
Power users (running experiments where most checkpoints aren't worth
keeping) flip it OFF.

### Acceptance criteria

**Setting**

- New entry on `AppSettings`: `auto_save_trained_models: boolean`,
  default `true`. Persists to localStorage with the existing
  `mergeWithDefaults` logic (so users who upgrade keep ON by default).
- New row in `/settings` Predict-or-Train section (whichever fits — see
  open questions below): `ToggleRow` with label
  *"Auto-save trained models to the library"* and description
  *"When a training run finishes, automatically copy `best.pt` into
  Models (with the run's name as the filename). Skip to leave the
  save-to-library step manual."*

**Auto-save behaviour**

- `/train/run` watches for `status` transitions to `"completed"`. When
  the transition fires AND the auto-save setting is ON AND
  `bestPt !== null`, automatically call `save.mutate()` once. Guarded
  by a `useRef(false)` so a re-render or replay doesn't double-fire.
- The existing manual **Save to library** button still renders if
  auto-save fails (user can retry). On success it's hidden as today.
- On success the savedModel state populates the same way as a manual
  save; `setDefaultModel(model.task, model.name)` still fires per the
  current flow.
- A small toast / inline banner says *"Auto-saved as `<filename>`"*
  with a link to `/models` so the user knows what happened without
  having to search.

**Failure handling**

- Auto-save errors don't escalate — they surface as the same inline
  `ApiError.message` red banner the manual flow uses, with the
  manual button still available so the user can retry.
- The job's status doesn't change. A failed auto-save is purely a
  UI/library-write failure, not a training failure.

### Why frontend-only (proposal)

Settings live in localStorage (client-only by design — see
`apps/web/lib/settings.ts` comment). The desktop is the only place
that knows the user's preference, and it's the side that's already
watching the WS event stream for completion. Backend-driven auto-save
would need the setting to be posted to the server, surface a new
endpoint, and decide what to do when no client is connected (a
fire-and-forget training run via curl with auto-save would be a fun
edge case but probably not worth supporting). Frontend-only is
simpler and matches the clinical workflow (the user *is* watching the
run).

### Edge cases worth flagging now

1. **User navigates away from `/train/run` before completion.** The
   auto-save won't fire because no client is watching. When the user
   returns, the initial GET-snapshot fetch finds the job already
   completed; we trigger the same "if status === completed && auto-save
   ON && savedModel === null" check on mount and the auto-save fires
   then. Net: auto-save eventually happens whenever a client lands on
   the page, even after a long delay.
2. **Multiple tabs of `/train/run` open simultaneously.** Each tab
   would try to auto-save. The backend handles this — second
   `save_to_library` call returns the same path (collision
   disambiguation from F2 kicks in if names happen to collide, but
   here it's the same job → same name → same destination, so it's a
   no-op overwrite at worst). Show one toast per tab.
3. **Auto-save on a cancelled or failed run.** Doesn't fire — gated
   on `status === "completed"`. Matches the manual button's gate.
4. **Setting flipped OFF while a run is in flight.** Honoured. The
   auto-save check reads the setting at completion time, not at run
   start, so the latest user preference always wins.
5. **F3 history page interaction.** After F3 ships, the history row
   for an auto-saved run will show the `library_path` field populated.
   Manual-save runs that the user never clicked Save on will have a
   null library_path — the history detail page should offer a
   "Save now" affordance for those.

### Decisions (signed off 2026-05-21)

1. **Default ON** — auto-save is the better workflow default; clinicians
   shouldn't lose models because they forgot to click Save.
2. **New Train section in `/settings`** — F3 creates the Train section
   for its own auto-purge toggle; F5 adds the auto-save toggle there.
3. **Auto-save does NOT auto-set-as-default** — the user explicitly
   marks a model as default via the existing button on `/models`.
   Splits from manual save behaviour (which currently does call
   `setDefaultModel`), so the F5 commit also drops the
   `setDefaultModel` call from the manual save path for consistency —
   "saving to library" and "marking as default" are now two distinct
   actions for both paths. F5 §"Implementation note" below details this.
4. **Ship F5 separately after F3** — F3 lands first (the larger piece);
   F5 ships immediately after as a small frontend-only patch (v0.13).
   This keeps each phase reviewable and lets F5's history-row
   integration (showing which runs were auto-saved) work the first
   time since F3 has already populated the `library_path` column.

### Implementation note — decision 3 ripples to manual save

Today's `/train/run::save` mutation does `setDefaultModel(model.task,
model.name)` immediately after a successful save. The user's decision
that auto-save **should not** auto-set-as-default means we have two
choices:

- **(a) Asymmetric:** manual save still auto-sets-as-default; auto-save
  doesn't. Internally inconsistent and confusing ("why is the
  behaviour different depending on whether I clicked the button or it
  fired itself?").
- **(b) Symmetric:** both manual and auto save stop auto-setting the
  default. User explicitly marks a model as default via the existing
  button on `/models`. Adds one extra click for users who used to
  rely on the implicit behaviour.

Recommend **(b)** for v1, landing as part of the F5 commit. We'll call
out the change in the F5 changelog so the small behaviour shift is
visible.

### Complexity

**Small (~½ day).** One new settings field; one `useEffect` watching for
status transitions on `/train/run`; one `useRef` guard; one toast/banner;
documentation in CHANGELOG + PHASE-STATUS. Backend untouched.

---

## 6. Explainable AI (heatmaps + per-detection rationale)

### What

Make every Predict output **interpretable**. For each prediction the
app produces today, surface a "Why?" affordance that overlays a
visual explanation onto the source image:

- **Detection (`/predict` detect view):** per-bounding-box class-
  activation overlay (Grad-CAM / Eigen-CAM / YOLO-grad-cam variant)
  showing which pixel regions inside the box drove the class
  prediction. Toggle per-box, not just per-image.
- **Classification (`/predict` classify view):** image-level
  Grad-CAM heatmap showing which regions pushed the model toward
  the top-1 / top-5 classes. Adjustable opacity slider; per-class
  switching for the top-5.
- **Batch reports (PDF + XLSX):** the existing report templates
  gain an opt-in "Include explanations" toggle. When ON, every
  page that shows a prediction also shows the heatmap overlay
  alongside the raw image.
- **Models library cross-link:** `/models` cards for trained
  checkpoints gain a "Test explanation" CTA that runs explanation
  on the bundled sample image (or a user-picked one) — lets the
  user sanity-check that a freshly-trained model is looking at the
  right features before they commit to using it clinically.

### Why

Clinical adoption of ML in pathology + hematology hinges on
interpretability. A pathologist will not sign off on a model's
output that says "this is a mitotic figure, 0.94 confidence"
without being able to ask "what did you see?" — the same way they
would interrogate a junior trainee's call. Today the app has no
answer to that question; it's the single most-likely reason a
pilot user will say "interesting demo, but I wouldn't use this on
real cases."

The compute cost is real (Grad-CAM adds ~50-200 ms per image,
heavier on detection where it's per-box) but the use case
(reviewing individual difficult cases, not bulk screening) makes
that acceptable. Worth gating behind a per-prediction toggle so
the bulk path stays fast.

### Acceptance criteria

**Backend (`server/vrl_yolo/engine/explain.py` — new module)**

- New dependency: a vetted PyTorch CAM library that supports both
  classification and YOLO detection heads. Candidates:
  `pytorch-grad-cam` (broad, well-maintained, supports Eigen-CAM
  + Grad-CAM + Grad-CAM++ + HiResCAM), or a fork-and-port of
  `ultralytics`-specific implementations (e.g. YOLO-grad-cam) if
  pytorch-grad-cam's YOLO support proves shaky.
- `explain_detection(model, image, box_index, method="eigen-cam")
  -> ExplanationResult` returns a heatmap as a numpy uint8 array
  the same HxW as the input image + the JET-coloured RGB overlay
  pre-baked + a confidence-weighting note.
- `explain_classification(model, image, target_class=None,
  method="grad-cam") -> ExplanationResult` mirrors the detection
  helper but operates on the whole image. `target_class=None`
  means "top-1 prediction."
- Hooks layer registration into the model's last conv block;
  picks the layer per-task (detect = neck's last conv; classify =
  backbone's last conv). Per-backbone layer overrides live in a
  small registry dict keyed by model architecture.
- Caches per-image / per-target so toggling "show/hide" doesn't
  recompute. Cache TTL = lifetime of the inference request.

**API**

- New `POST /api/predict/{task}/explain` endpoint:
  `{model: str, image_path: str, box_index?: int, target_class?:
  int, method?: "grad-cam" | "eigen-cam" | "grad-cam++"}` →
  returns a base64-encoded overlay PNG + numerical heatmap stats
  (min / max / mean activation, useful for "is the model looking
  at anything specific at all?").
- New optional `?explain=true` param on the existing
  `POST /api/inference/single` and `/api/inference/folder` so
  bulk runs can generate explanations in one pass when needed.
- The folder-batch endpoint returns explanations only when
  explicitly requested (default off — preserves bulk speed).

**Frontend**

- `/predict` single view gains a **Why?** button next to each
  prediction. Click → modal with the heatmap overlay + an opacity
  slider (0–100%) + method selector (Eigen-CAM default, switchable).
  For detection, the modal shows one box at a time with prev/next
  navigation through the boxes.
- `/predict` folder view: per-row Why? button on the results
  table. Opens the same modal scoped to the row's image.
- `/settings` gains an **Explanations** section: default method,
  default opacity, "Include in reports by default" toggle.
- PDF + XLSX report templates gain an opt-in "Include
  explanations" checkbox in the export dialog. When ON, each
  prediction page in the PDF gets a side-by-side
  source-image / explanation-overlay layout; XLSX gets an extra
  column with embedded thumbnails of the overlay.

**Per-task UI variation**

- Detection: per-box, click a box on the overlay to switch which
  one is being explained. Picker matches `/predict`'s existing
  box-hover affordance.
- Classification: per-class radio in the modal — Top-1, Top-2,
  ... Top-5. Lets the user compare "the model said dog (0.7) but
  also wolf (0.2) — what was it looking at for each?"

### Open questions

1. **Library choice.** `pytorch-grad-cam` is the obvious default
   but its YOLO support is community-maintained, not Ultralytics-
   blessed. Alternative: build a thin Ultralytics-native CAM
   wrapper on top of their `model.model.model[-2]` layer access.
   Trade-off: library = less code we own, more upstream-dependency
   risk; in-house = full control, ~3 days of additional work.
2. **Detection method default.** Eigen-CAM gives smoother
   heatmaps that overlay nicely but is less faithful to "which
   pixels were most important." Grad-CAM++ is more faithful but
   noisier. Recommend **Eigen-CAM as the user-facing default**
   (clinically more legible) with method-switching in the modal
   for power users.
3. **Performance budget.** Single-image CAM is fine (sub-second).
   Folder-batch with N=100 images + per-image CAM is roughly
   N × 100ms = 10s extra on a fast GPU; multi-minute on CPU.
   Default OFF for folder batch is right; surface an estimate
   ("Will add ~12s to the batch — proceed?") at the moment the
   user toggles it ON.
4. **Trained-model layer registration.** A user-imported YOLOv5
   or older Ultralytics checkpoint may not match the YOLO26 /
   YOLOv8 layer-name pattern. Fall back to "Eigen-CAM on the last
   Conv2d in the backbone" via reflection; warn the user if the
   detected layer doesn't look reasonable.
5. **Storage of generated overlays.** Don't store by default
   (recompute per request — cheap enough). Surface a per-report
   "embed in PDF" path that's a one-shot bake.
6. **Confidence-weighted overlay.** Should low-confidence
   detections show a "weaker" heatmap (lower max activation)
   visibly? Or should every overlay normalise to [0, 1] regardless
   of underlying box confidence? Recommend **show raw scale +
   surface a numerical "peak activation" stat** beside the
   overlay so the user can tell the difference between
   "model was confident and focused" vs "model guessed in the
   noise."
7. **Clinical wording.** The Why? modal needs careful copy. "The
   model focused on this region when predicting [class]" is
   accurate but easy to misread as "the model SAW [class] in this
   region." Probably worth running the modal copy past a clinical
   collaborator pre-pilot.
8. **Per-class vs per-feature explanations.** Grad-CAM gives "why
   this class." SHAP-style explanations would give "feature-wise
   contributions" but require a different infrastructure. Out of
   scope for v1.1 — stick to CAM-family for the first iteration.

### Complexity

**Medium-large (1–2 weeks).** The backend explain module is the
biggest piece — getting the layer registration robust across the
YOLO26 / YOLOv8 / user-import set takes most of the time. Backend
tests can use synthetic small models (no real Ultralytics weights
needed for unit coverage; integration tests hit the bundled
`yolo26n` checkpoint). Frontend modal + reports integration is
straightforward; the PDF template change is the trickiest of the
UI pieces because it requires re-flowing two-up layouts.

### Skills to reuse

- **`shap`** — confirm SHAP is NOT the right tool for image CAM
  (it isn't); use as a sanity reference for what richer
  explainability looks like.
- **`pathml`** / **`histolab`** — pathology-specific heatmap
  conventions when designing the overlay defaults (colormap,
  opacity, legend).
- **`clinical-reports`** — patterns for embedding visual
  explanations into PDF report templates without breaking
  print-page layout.
- **`code-review`** + **`security-review`** — explanations expose
  internal model state to the UI; verify nothing leaked includes
  PHI or training-set memorisation hints.

---

## 7. MCP integration (Claude / ChatGPT / any compatible client)

### What

Ship an **MCP (Model Context Protocol) server** as part of the desktop
binary. The MCP server exposes a curated set of VRL-YOLO-GUI's
capabilities as tools that any MCP-compatible LLM client can call:

- **Claude Desktop** (claude.ai/download)
- **Claude Code** (CLI + IDE plugins)
- **ChatGPT desktop apps** (Apple / Windows clients with MCP
  client support)
- Any third-party MCP-client implementation

A clinician opens Claude Desktop and asks *"show me the last 5
classify runs and which one had the best top-1"* — Claude calls the
`list_training_history(task="classify", limit=5)` tool on
VRL-YOLO-GUI and answers from the data. Or: *"run prediction on the
folder I just dropped on my desktop with my best mitosis model"* —
Claude calls `list_models(task="detect")`, asks the user to confirm
which checkpoint, calls `predict_folder(path, model)`, summarises
the result.

The MCP server is **off by default**, opt-in via Settings (security
+ data-flow caveats made explicit on enable), and binds to
**localhost only** in v1 of the feature.

### Why

Two distinct power-user wins:

1. **Conversational composition of the app's primitives.** Today
   every workflow is a multi-click navigation: drop a folder →
   pick a model → wait → export. With MCP, the LLM can compose
   primitives ("for each of the last 3 classify runs, run their
   best.pt on this validation folder and tell me which one
   generalises best") — useful for the research half of the
   audience.
2. **Cross-tool workflows.** A clinician already living in
   ChatGPT or Claude for clinical drafting can pull the app's
   outputs *into* that conversation ("here's the prediction
   summary CSV the model just produced; help me write the
   diagnostic note") without context-switching. Lowers the
   cognitive cost of integrating ML into the existing
   note-writing workflow.

Strategic: shipping MCP early (post-pilot, pre-v2) puts the app
in front of the ChatGPT / Claude user audiences without needing
those audiences to install a separate plugin — they configure
once, the tools appear.

### Acceptance criteria

**MCP server (`server/vrl_yolo/mcp/` — new sub-package)**

- New optional dependency: `mcp` (the official Python MCP SDK).
  Listed as an `extras_require = ["mcp"]` in `pyproject.toml`
  rather than a default dep — the server is opt-in.
- **Transport: stdio (default) + HTTP/SSE (advanced).**
  - stdio is the standard for desktop MCP clients (Claude Desktop,
    ChatGPT desktop) — they spawn the server as a subprocess and
    pipe JSON-RPC over stdin/stdout. v1 ships stdio only.
  - HTTP/SSE deferred to v1.2 (would let remote MCP clients
    connect across the network — needs auth + TLS thinking that's
    out of scope for the first iteration).
- The stdio server is a **separate entry point** from the desktop
  app: `python -m vrl_yolo.mcp` or a generated `vrl-yolo-mcp`
  script. It connects to the same FastAPI backend over
  `http://127.0.0.1:<port>/api/...` — sharing the existing
  endpoints, not duplicating logic. Auth via a bearer token
  rotated per app launch.
- Bearer token + port are read from a small JSON manifest the
  desktop app writes to a known path (e.g.
  `<storage>/mcp/manifest.json`) on launch. The MCP server reads
  the manifest at startup. Token rotation per launch.

**Exposed tools (v1 scope)**

Predict surface:
- `list_models(task: "detect" | "classify" | "all" = "all") ->
  list[Model]` — wraps `GET /api/models`.
- `predict_single(model: str, image_path: str) -> Prediction` —
  wraps `POST /api/inference/single`.
- `predict_folder(model: str, folder_path: str, output_format?:
  "csv" | "xlsx" | "pdf") -> BatchResult` — wraps
  `/api/inference/folder` + report export.

Train surface:
- `list_datasets() -> list[Dataset]` — wraps `GET /api/datasets`.
- `list_training_history(task?, status?, dataset_id?, limit=20)
  -> list[TrainingRun]` — wraps `GET /api/training/history`.
- `start_training(task, dataset_id, base_model, epochs?, imgsz?,
  batch?, name?, description?) -> TrainingJob` — wraps
  `POST /api/training/run`.
- `get_training_status(job_id: str) -> TrainingJob` — wraps
  `GET /api/training/{job_id}`.
- `save_run_to_library(job_id: str, name?: str) -> Model` —
  wraps `POST /api/training/{job_id}/save`.

System surface (read-only):
- `get_app_info() -> AppInfo` — version, storage path, hardware
  probe result.

**Frontend — Settings + first-run flow**

- New `/settings` section: **External integrations**.
- Toggle: **Enable MCP server (experimental)** — default OFF.
- When toggled ON:
  - Modal explains: "An MCP server lets external LLM clients
    (Claude, ChatGPT, etc.) call your local VRL-YOLO-GUI tools.
    The server runs on localhost only; no data leaves your
    machine without you starting the conversation."
  - Inline list of allowed tools (read above) with per-tool
    enable/disable toggles. Defaults: all read tools ON,
    `start_training` + `save_run_to_library` OFF (write tools
    behind explicit opt-in).
  - "Copy Claude Desktop config" + "Copy Claude Code config"
    buttons that produce the JSON snippet to paste into the
    client's MCP-server settings file. Snippet includes the
    bearer token and the path to the `vrl-yolo-mcp` binary.
- When toggled OFF: server doesn't launch, manifest file deleted.

**Permissions + audit**

- Every MCP tool invocation writes a row to a new
  `mcp_audit` table in `<storage>/training.db` (extends the F3
  schema with v3 migration): `timestamp, tool_name,
  arguments_json, response_summary, client_id`. Visible at
  `/settings/mcp/audit` as a read-only table — let the user see
  exactly what Claude / ChatGPT called and when.
- `start_training` + `save_run_to_library` (write tools) prompt
  the user via a system notification on every call:
  "Claude Desktop wants to start a training run with these
  settings — Allow / Deny" with a 60-second timeout (deny on
  timeout). Confirmation can be skipped per-session for
  power users (default: always confirm).

**Bundled binary**

- macOS .app + Windows .exe bundle includes
  `vrl-yolo-mcp` as a sibling helper (same PyInstaller spec
  with a second entry point, or a second PyInstaller invocation
  in `scripts/build-release.py`).
- macOS install.command (F5 carry-forward) extended to also
  print "MCP server available at `<path>/vrl-yolo-mcp` — see
  Settings → External integrations to enable."

### Open questions

1. **Transport choice for v1.** stdio is the safe default —
   matches every existing desktop MCP client. HTTP/SSE adds
   network surface (TLS, CORS, auth replay) that's worth
   handling as a separate phase once stdio is proven.
2. **Tool granularity.** Each FastAPI route can be one MCP tool,
   or we can compose ("run a training and tell me when it
   finishes" = one tool that returns a streaming job). v1:
   one-to-one mapping with the existing routes — keeps the
   surface predictable and lets the LLM client compose. Revisit
   if pilot feedback says LLMs are clumsy at composition.
3. **Auth model.** Bearer-token-per-launch is the simplest
   meaningful auth. Real concern: if the manifest file leaks
   (malware reads `<storage>/mcp/manifest.json`), the attacker
   gets a 24-hour key into the training surface. Mitigation:
   manifest stored with `0600` perms; rotate token on every
   launch + every settings change.
4. **Write-tool defaults.** Default off (recommended) feels
   right — users who want to drive training from Claude can
   enable explicitly and accept the per-call confirmation. The
   alternative (default on with per-call confirmation) is more
   permissive but harder to undo if the user clicks Allow once
   by accident.
5. **What about model upload / deletion?** Explicitly out of v1
   MCP scope. Bulk-delete, model delete, dataset delete all
   stay UI-only — too easy to wreck a workflow with a
   well-meaning LLM call.
6. **Audit retention.** F3 has an opt-in auto-purge>30d for
   training history; mirror the same pattern for MCP audit.
   Default OFF (privacy-conservative; user opts in to forget).
7. **PHI in tool responses.** The current API returns image
   paths, not image contents. Folder paths leak directory
   structure to the LLM — for a clinician with patient-named
   folders this is potentially sensitive. Surface a setting:
   "Send absolute paths to MCP clients" — default OFF, fall
   back to anonymised stubs (`<dataset>/...` instead of
   `/Users/jdoe/Patients/Smith-2024/...`).
8. **MCP client compatibility matrix.** Claude Desktop, Claude
   Code, and the ChatGPT desktop apps all implement MCP
   slightly differently in terms of tool-discovery + streaming
   semantics. Need a v1.2 follow-up to verify the integration
   against each major client + document known limitations.
9. **License compatibility.** AGPL on the desktop binary + an
   MCP server that another (potentially proprietary) LLM client
   calls — does the LLM client become AGPL-encumbered? Read of
   the license: no, MCP is a network-protocol boundary and the
   client doesn't link into our code. Worth a formal
   confirmation from the licensing reference before shipping.

### Why post-pilot

Three reasons MCP shouldn't ship pre-v1.0:

1. The pilot is testing whether the existing UI flows work for
   clinicians. Adding an LLM-driven entry path muddles that
   signal.
2. The MCP feature surface depends on F3 + F4's data model
   (history + library) being stable. Both just landed in May;
   another release cycle of bug-shake before exposing them
   externally is prudent.
3. The auth + audit posture needs design review with an
   external security-aware reader. Pre-pilot is too early to
   front-load that work.

### Complexity

**Medium (3–5 days for v1 scope).** Heaviest pieces: bundling the
helper binary into both macOS .app and Windows .exe (the existing
PyInstaller spec is single-entry-point and needs a second
configuration), the per-call confirmation flow on write tools
(needs a small IPC layer between the MCP server process and the
desktop app's UI), the v3 migration for the audit table. The
tool implementations themselves are thin wrappers — FastAPI
routes already exist for every one. Settings UI is mostly
copy-paste of F3 / F5 patterns.

### Skills to reuse

- **`mcp-server-patterns`** (in
  `~/.claude/skills/mcp-server-patterns`) — patterns for tool
  registration, error handling, and transport choice. **This is
  the primary reference.**
- **`claude-api`** — for the Claude Desktop / Claude Code
  integration examples + the test harness for MCP tool calls.
- **`x-api`** / **`google-workspace-ops`** — pattern references
  for how to design bearer-token auth + per-call confirmation
  flows that don't annoy real users.
- **`security-review`** — must-run before shipping. The MCP
  surface introduces a new auth boundary; the security review
  should cover token rotation, manifest perms, write-tool
  scope, audit retention, and PHI-in-paths concern from open
  question #7.

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

Original phasing (when these were all post-pilot ideas):

- **P-models-polish** (#1) — independent, lands as a quick patch.
- **P-history-and-library** (#2 → #3 → #4 as a single coherent
  feature set) — one larger phase, since #3's persistence is what
  makes #4's "last_used_at + run_count" meaningful, and #4's
  library list is what makes #3's history page useful as a filter
  destination.

**Actual phasing as shipped** (user reordered to land before P7
Polish): each item gets its own version-bumped phase commit so the
in-app changelog tracks them individually. #5 (auto-save toggle)
slots naturally after #3 since its history record gets richer with
F3's `library_path` column, but is shippable any time as it's
backend-free.

### When to revisit

After the v1 pilot (P10). If pilot users repeatedly ask "where do my
old runs go?" or "do I really have to re-upload this dataset?", these
move from "future ideas" to "v1.1 commitments."
