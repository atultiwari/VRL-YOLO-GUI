# Changelog

All notable changes to **VRL YOLO GUI** are recorded here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the same data
drives the in-app `/changelog` view (source at
[`apps/web/lib/changelog.ts`](apps/web/lib/changelog.ts)).

The project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Per-phase tags (e.g. `v0.3-p2-predict-classify`) annotate each phase
boundary in [`PLAN.md`](PLAN.md); see [`docs/PHASE-STATUS.md`](docs/PHASE-STATUS.md)
for the running tracker.

---

## [0.14.1] — 2026-05-21 · F4.fix-1: macOS .dmg build fix — dangling-symlink sweep + `symlinks=True` on copytree

**Tag:** `v0.14.1`

### Fixed
- **macOS-arm64 GitHub Actions release builds now succeed.** Both `v0.13-f5-autosave` and `v0.14-f4-dataset-library` failed in CI at the new DMG-staging step that F5 introduced in `scripts/build-release.py::maybe_macos_dmg`. The post-build cleanup step removes PySide6 devtool `.app` bundles (Assistant, Designer, Linguist, qtdiag, pyside6-*) but PyInstaller's PySide6 hook drops sibling symlinks pointing at those bundles; deleting the real directories left dangling symlinks behind. The new `shutil.copytree(app_path, stage_dir / app_path.name)` then tried to follow them and exploded with `FileNotFoundError: '.../PySide6/Assistant.app'`. Two surgical fixes in `scripts/build-release.py`:
  - **`strip_nested_macos_bundles`** now skips symlinks in its first pass (was implicitly following them via `Path.is_dir()` which follows symlinks) and adds a second pass that unlinks any broken symlinks left behind by the strip. The second pass uses `is_symlink() and not exists()` to detect the dangling state — `exists()` follows symlinks while `is_symlink()` does not.
  - **`maybe_macos_dmg`** — the `shutil.copytree(...)` call now passes `symlinks=True` so Qt framework `Versions/Current → A` symlinks are preserved as symlinks rather than followed (which also bloated the staged copy and made the .dmg larger than necessary). Also tolerates any broken symlinks that slip through.
- **Verification.** Targeted synthetic-bundle test reproduces the exact failing PySide6 layout (real `Assistant.app`/`Designer.app`/`Linguist.app` directories with sibling symlinks pointing into them, a `QtWebEngineProcess.app` placed in `QtWebEngineCore.framework/Helpers/`, and a `QtCore.framework/Versions/Current → A` symlink). 14/14 checks pass: strip removes exactly the 3 devtool bundles, sibling symlinks are cleaned up automatically, `QtWebEngineProcess.app` (the Pyloid webview helper Qt spawns at runtime — must not be touched) is preserved, `Versions/Current` resolves to a valid target, and `copytree(symlinks=True)` round-trips the bundle including the `Versions/Current` symlink intact.

### Notes
- No application-code changes — the fix is build-pipeline-only. Backend test count stays at 116. Windows builds were never affected (only macOS exercises this code path).
- Anyone who needs an unsigned `.dmg` from v0.13 (F5) can rebuild from the `v0.13-f5-autosave` tag now that the script is fixed; we are not retroactively retagging F5.

---

## [0.14.0] — 2026-05-21 · F4: Dataset library — naming + library tab + /datasets page + delete + history cross-reference

**Tag:** `v0.14-f4-dataset-library` (**last item in the F-chain** — F1–F5 are now all shipped; after this, the project returns to the original PLAN.md §14 phase sequence with P7 Polish next.)

### Added
- **SQLite schema v2 with new `datasets` table.** New `_migrate_v1_to_v2` adds the table (id, name, description, created_at) alongside F3's `training_runs`. Fresh installs migrate v0→v1→v2 transparently; existing v1 installs auto-migrate to v2 on next launch. **First-launch backfill** — every dataset folder already under `<storage>/datasets/` gets a default-named row (`"Dataset <id[:8]>"`) inserted via `INSERT OR IGNORE` so users with pre-F4 installs immediately see all their old datasets in the new library with the auto-generated name. The backfill is idempotent: a user who has already renamed a dataset keeps their custom name; a folder dropped onto disk after upgrade gets a row on the next migrate.
- **`HistoryDb.dataset_stats()` + meta methods.** One-pass aggregator (`SELECT dataset_id, MAX(started_at), COUNT(*) ... GROUP BY dataset_id`) for the cross-referenced last-used + run-count stats. New `get_dataset_meta` / `list_dataset_meta` / `upsert_dataset_meta` / `delete_dataset_meta` parallel to the existing F2/F3 patterns. Empty-string for `name` on update resets to `"Dataset <id[:8]>"` default (same semantics as F2's PATCH).
- **`JobManager.list_active_jobs_for_dataset(id)` helper.** Returns running + queued jobs whose `dataset_root.name` matches. Used by `DELETE /api/datasets/{id}`'s 409 guard.
- **Three new dataset routes** in `routers/dataset.py`:
  - `GET /api/datasets` — paginated list cross-referenced with HistoryDb. Returns `{rows: [...], partial: [...]}` so the UI can render a separate "Couldn't read" section for folders that exist on disk but fail `inspect_dataset()`. Default sort: most-recently-used DESC (NULL last), tie-break by created_at DESC.
  - `DELETE /api/datasets/{id}` — wipes the folder + meta row. Returns **409 Conflict** with the run name(s) if any queued/running training job is using the dataset. F3 history rows stay (orphan-flagged via the `dataset_missing` boolean). Library checkpoints under `models/<task>/` are NOT touched — separate user-owned artifact.
  - `PATCH /api/datasets/{id}` — edit name + description with F2-style semantics (`None`=untouched, empty `name`=reset to default, empty `description`=clear). 204 No Content on success; 404 if folder gone.
- **`POST /api/datasets/inspect` extended** with optional `?name=&description=` query params. Backend upserts the meta row right after `inspect_dataset()` succeeds so the user's chosen name appears in the library on first list.
- **`/datasets` top-level page** (new sidebar entry "Datasets" under Train). Browse-mode rendering of the shared library-table component. Header has an "Upload new dataset" button that lands on `/train/dataset`.
- **`/datasets/view?id=<id>` detail page** (query-param URL, wrapped in Suspense for static-export compat — same pattern as F3's history detail). Inline-editable name + description, summary cards (Task / Format / Images / Splits), splits table, classes pills, recent runs list (top 10) linking to each run's detail, action row (Re-split / Use for training / Delete).
- **"Pick from library" tab on `/train/dataset`.** Tab toggle above the existing dropzone — "Drop a folder" stays the default. Picker mode of the library table shows "Use this" CTA; click → fetches the dataset + jumps to inspect-and-confirm with it pre-selected, skipping the upload step entirely.
- **"Name this dataset (optional)" card on `/train/dataset`** in the Drop-a-folder tab. Two inputs (Name + Description, max 200/2000 chars) above the dropzone; the values ride on the multipart upload's query string.
- **Shared `components/datasets/library-table.tsx`** component used in both pages. Picker mode (Use this CTA) vs browse mode (Open link). Sort dropdown (Most recently used / Most runs / Newest first). **Inline rename on every row** — hover-to-reveal pencil icon next to the name swaps it for an input with Save/Cancel + Enter/Escape shortcuts (same UX as F2's run-name editor on `/train/run`). Saves immediately via PATCH; lets users rename all 45 backfilled rows from one screen instead of opening each detail page.
- **Soft-mention delete confirmation modal.** When `run_count > 0`, the modal shows an amber warning row: *"N training runs reference this dataset. History records stay; saved checkpoints stay in /models. Delete them separately from there if needed."* Decision 5 from PLAN-F4 §8.
- **Separate "Couldn't read" section** below the main library table for any folder where `inspect_dataset()` raises. Partial rows are still deletable so users can reclaim orphan disk space. Decision 5 from PLAN-F4 §8.
- **`/train/history` dataset filter upgraded** to use friendly names from `/api/datasets` instead of raw UUID stubs. Orphan dataset_ids (referenced by history rows whose folder has been deleted) still show in the dropdown with a "(deleted)" suffix so the user can filter by them. Also wires the `?dataset=<id>` query param so the library's "X runs" link prefills the filter; the page is now wrapped in Suspense for the static-export `useSearchParams` requirement.
- **27 new backend tests** covering the schema v2 migration (fresh + idempotent + backfill + non-clobber on rerun), the new `HistoryDb` meta methods (upsert insert/update/reset-on-empty/None-untouched, delete returns False for unknown, get returns None for unknown), the PATCH route (200 + 204 + 404 paths), the `GET /api/datasets` list (empty / with-rows / with-history-cross-reference / with-partial / sort order), the DELETE route (204 / 404 unknown / 409 with active run / preserves-history-rows), and `dataset_stats()` (groups correctly / empty on fresh install). **116 total backend tests across the project, all green.**

### Changed
- `JobManager.start()` and `start_colab_job()` continue to write history rows on a dataset's first reference; the new F4 list view cross-references the same `dataset_id` column without any change to those write paths.
- The two `_record_to_info()` helpers in `routers/models.py` and `routers/training.py` are still duplicated, carrying forward from F2 with a warning comment in both. Tolerable for now; revisit when `ModelInfo` gains another field.

### Known limitations (deferred)
- **No bulk-rename or bulk-delete on the library table.** Each row's actions are one-at-a-time. The hover-to-reveal pencil makes per-row rename fast, but a clinician with 45 datasets named `Dataset <stub>` will still click 45 pencils to rename them all. Bulk-edit is a future polish item if pilot users hit it.
- **Re-splitting a dataset** still goes through the existing `/train/dataset` Prepare-splits modal — the detail page's "Re-split via wizard" action just links there. F4 doesn't introduce a new re-split surface.
- **No global search across datasets** (by name or by class). The sort dropdown covers the common cases for now; revisit if pilot libraries grow past ~30 datasets and the user wants a search box.
- **The `_record_to_info()` duplication** between `routers/models.py` and `routers/training.py` is still tolerated (carried forward from F2 and F3).

---

## [0.13.0] — 2026-05-21 · F5: Auto-save trained models + macOS first-launch helper in .dmg

**Tag:** `v0.13-f5-autosave` (fourth of the post-v0.9 Future-Features chain; F4 still pending. Also bundles a non-feature DMG packaging fix for the long-standing unsigned-app Gatekeeper friction.)

### Added
- **Auto-save trained models to the library** (Settings toggle, default **ON**). New `AppSettings.auto_save_trained_models: boolean` field; new row in the Train section of `/settings` (next to the F3 auto-purge toggle). When ON, the moment a training run hits `status === "completed"` AND `bestPt` is populated AND the run hasn't already been saved, the desktop kicks off the existing `save_to_library` flow automatically. A small green toast appears on `/train/run` saying *"Auto-saved as `<filename>`. Open Models to use it for prediction."* The `useRef`-guarded `useEffect` makes this a one-shot per page mount; a re-render or WS replay can't double-fire. **Frontend-only feature** — no backend changes needed; uses the existing `POST /api/training/{id}/save-to-library` route.
- **Auto-save also fires on `/train/history/view`** when the user opens a completed run that finished while they were elsewhere (the classic "walked away during an overnight run, came back hours later, navigated to history" path). Same useRef guard; if the row already has `library_path` populated, the effect no-ops. Toast appears on the detail page in the same shape.
- **Manual "Save to library" button stays available** on both `/train/run` and `/train/history/view` regardless of the auto-save setting — covers (a) users who flipped auto-save OFF, (b) users whose auto-save failed (the row's `library_path` stays null on failure so the button reappears), and (c) experimental sweeps where the user wants to review each checkpoint before keeping it.
- **macOS install assets bundled inside the .dmg** (closes the unsigned-app first-launch Gatekeeper friction one of our test installs hit on v0.12.0). Two new files now sit next to the `.app` icon when a clinician mounts the DMG: **`install.command`** (double-click in Finder to clear the `com.apple.quarantine` xattr from the installed `.app`; the script handles the "app not in /Applications yet" case + the "no write permission" case with a `sudo` suggestion) and **`README-MACOS-FIRST-RUN.txt`** (plain-text two-step quick-start at the top; full Gatekeeper explainer + three manual alternatives + troubleshooting + project links below). Source files live at `assets/install/macos/`; `scripts/build-release.py::maybe_macos_dmg` now stages them alongside the .app in a temp directory and passes it to `create-dmg` so both helpers land in the DMG root window. Window size bumped from 540×380 to 560×440 to fit the second row of icons.

### Changed
- **Manual "Save to library" no longer marks the saved model as the per-task default.** F5 made auto-save deliberately *not* auto-set-as-default (a clinician training 10 experimental runs in a row shouldn't have their `/predict` default thrash 10 times). For symmetry, the manual save path also drops its `setDefaultModel` call — so both manual and auto save now do exactly one thing: copy `best.pt` into the library. Marking a model as the per-task default becomes a separate explicit action via the existing "Set as default" button on each `/models` card. **Behavioural shift:** users who previously relied on the implicit "save = also make default" coupling will need one extra click on `/models` to mark their fresh checkpoint as the default. Called out here so the change is visible.

### Fixed
- Nothing user-visible — this is a feature release. F5 implementation surfaced no new bugs.

### Known limitations (deferred)
- **Auto-save only fires on the two pages that watch for completion** (`/train/run` and `/train/history/view`). A clinician who closes both pages mid-training and reopens the app later — say, from a cold start the next morning — will see the run in `/train/history` as "completed" with no library checkpoint; auto-save fires the moment they open the detail page. There's no background job that auto-saves runs without a user-facing page open. Acceptable for v1 — clinicians watching a multi-hour run will naturally land on one of those pages.
- **Auto-save doesn't auto-set-as-default** (deliberate; see Changed). If pilot users repeatedly complain that the new manual setDefaultModel step is friction, we revisit with a per-task "auto-set-as-default" sub-setting in v1.1.
- **install.command doesn't work if the user copied the .app outside /Applications.** The script hard-codes `/Applications/VRL YOLO GUI.app` as the target path. Most users follow the standard drag-to-Applications flow shown in the DMG window so this is fine, but power users running from `~/Applications` or elsewhere need to run `xattr -dr com.apple.quarantine` manually on their chosen path (the README documents the command).
- **install.command requires Terminal access.** macOS environments with Terminal disabled (rare on personal Macs, more common in locked-down hospital IT setups) can't double-click it. The README's Option A (right-click → Open) covers those users.
- **The DMG layout still looks like a basic Finder window** — no custom background image or polish beyond the two-row icon grid. Future packaging polish if needed; functional today.

---

## [0.12.0] — 2026-05-21 · F3: Persistent training history — SQLite + /train/history + edit-lock removed

**Tag:** `v0.12-f3-history` (third of the post-v0.9 Future-Features chain from `docs/FUTURE-FEATURES.md`; plan in `docs/PLAN-F3.md`; also added F5 to `docs/FUTURE-FEATURES.md` for the upcoming auto-save toggle.)

### Added
- **Persistent training-run history.** Every training run (local + Colab) now writes to a SQLite database at `<storage_root>/training.db` from the moment `JobManager.start()` / `start_colab_job()` fires. The `training_runs` table carries the full lifecycle context — name + description (from F2), task, dataset_id, dataset_snapshot, base_model, hyperparams, accelerator + device_arg, started_at, finished_at, status, epoch_current, error_message, best_pt_path, library_path, final_metrics_json — and gets updated on every terminal event (`complete` / `error` / `cancelled`) and again when `save_to_library` succeeds (to populate `library_path`). Schema is hand-rolled via a `schema_version` int + ordered `_migrate_vN_to_vM` functions in `server/vrl_yolo/engine/history_db.py`; F3 ships v1. Fresh installs migrate v0→v1 transparently on first lifespan startup; existing installs see their first training run appear in history when they next launch the app.
- **`/train/history` page** — sortable + filterable table of every run ever. Columns: Name · Task · Dataset · Started · Duration · Status · Best metric · In library? · Re-run / Delete actions. Filter chips for Task / Status / Dataset; sort by Most recent / Name (A→Z) / Duration. Empty state suggests starting a run from `/train`. Manual "Clean up runs older than 30 days" button calls the new purge route. Rows whose dataset folder has been deleted show the dataset cell greyed + line-through with a tooltip; Re-run is disabled for those.
- **`/train/history/view?id=<job_id>` detail page** — replays the run's complete event stream from disk (`events.jsonl.gz` if compressed, `events.jsonl` if still live) into the same recharts components `/train/run` uses (detect: loss + mAP charts; classify: loss + accuracy charts). Header shows Name + Description with inline edits via PATCH (the F2 edit-lock is gone — completed-run edits now land in the history row), Started / Finished / Elapsed timestamps via `formatDate`/`formatElapsed` (TZ-aware), status badge, full hyperparams + final metrics cards, error message if the run failed. Actions: Re-run · Save to library (if completed + best.pt exists + not already saved) · Delete. URL is query-param-based (not dynamic `[id]`) so it works with Next.js static export.
- **Six new history routes** in `server/vrl_yolo/api/routers/training.py`, declared *before* the `/{job_id}` routes so the `/history` literals beat the path-parameter match:
  - `GET /api/training/history` — paginated list (filter by `task` / `status` / `dataset_id`; sort by `started_at` / `name` / `duration`).
  - `GET /api/training/history/{id}` — single row + an `events_url` for the chart stream.
  - `GET /api/training/history/{id}/events` — NDJSON stream of the run's events from the sidecar (`application/x-ndjson`).
  - `DELETE /api/training/history/{id}?delete_checkpoint=…` — removes the row + per-run dir; optionally removes the library checkpoint too.
  - `POST /api/training/history/{id}/rerun` — returns a `StartTrainingBody`-shaped prefill payload for the wizard. Local-prefill semantics for Colab rows too (the old tunnel is dead; user re-opens the Colab modal from `/train/configure`).
  - `POST /api/training/history/purge?older_than_days=N` — deletes rows + per-run sidecar dirs older than the cutoff. Library checkpoints under `models/<task>/` are **NOT** touched — they're separate user artifacts.
- **F2's PATCH edit-lock removed.** `PATCH /api/training/{id}` now accepts edits on completed / failed / cancelled runs by routing them through `HistoryDb.update_metadata` (was: 409 Conflict). Live runs still update in-memory `TrainingJob.name/description` for the WS snapshot path; the same edit also mirrors to the history row so a refresh of `/train/history` sees it. Terminal-only rows (job evicted from `JobManager._jobs`) edit through the DB directly. `/train/run`'s "Editing locked after the run finishes (re-enabled when history persistence lands in F3)" hint is gone — the pencils stay live the whole time.
- **`events.jsonl(.gz)` sidecar** per run via the new `server/vrl_yolo/engine/event_log.py` module. Writer is line-buffered (each `append` flushes immediately), gzipped in a daemon thread the moment status hits a terminal value (5–10× disk savings on a 200-epoch run). Reader auto-picks `.gz` over `.jsonl` so the chart replay works regardless of compression state. All disk errors are caught + logged so a permission glitch or full disk can't take down a training run.
- **App-wide timezone-aware timestamp rendering on the history pages.** The list table's Started column, the detail page's Started / Finished / Elapsed row, and any future timestamp surface all route through F2's `formatDate()` / `formatElapsed()` so a TZ change in `/settings` repaints them.
- **F3 §9: opt-in auto-purge setting.** New `AppSettings.auto_purge_old_runs: boolean` toggle in the new **Train** section of `/settings` (default **OFF**). When ON, `/train/history` calls `POST /history/purge?older_than_days=30` on mount and shows a small toast (`"Auto-purged N runs older than 30 days"`). Library checkpoints stay in `/models` — only the history record + replay events are removed. F5 (auto-save trained models) will add another row to this same Train section in v0.13.
- **Sidebar entry: "Training history"** under the Train section, linking to `/train/history`. Icon: `History` from lucide-react.
- **Re-run prefill on `/train/configure`.** Click Re-run on a history row → navigates to `/train/configure?from=<history_id>` → on mount the page fetches the rerun payload + the dataset, applies them to the train store, prefills the runName + runDescription locally, and shows an accent banner ("Prefilled from run \"X\". Tweak any field before clicking Start."). Dataset-missing rows show a redirect notice and bounce back to `/train`. The dataset-redirect guard is wired to wait for the prefill effect before bouncing, so the user doesn't get sent back to `/train` mid-prefill.
- **32 new backend tests** in `tests/test_history.py` covering: schema migration (fresh install + idempotent); `HistoryDb` writers (insert / update_status / set_library_path / update_metadata / delete / purge_older_than); `HistoryDb` readers (list pagination + filters by task/status/dataset + sort variants + dataset_missing flag); `EventLog` (append + gzip + replay round-trip in both compressed + uncompressed shapes + idempotent close); `JobManager` integration (terminal event populates the row via the in-memory hook; save_to_library populates library_path); the F3-unlocked PATCH path on terminal rows (both still-in-memory and history-only); all six new routes end-to-end including filters, pagination, delete with/without checkpoint, purge with disk cleanup, rerun prefill payload shape. **89 total backend tests across the project, all green.**

### Fixed
- Nothing user-visible — F3 is a feature release. The F1 regression fix and F2's PATCH gate semantics flowed into this commit by way of the route refactor.

### Changed
- `JobManager` constructor signature gained a `history: HistoryDb | None` kwarg. Defaults to `None` so existing callers / tests that don't care about persistence don't have to wire one up.
- `JobManager.update_metadata()` return shape changed: now returns `TrainingJob | None`. `None` signals "the live job is gone; the edit landed in the history row" — the PATCH route fetches the row separately and builds the response from it. Live-job edits still return the `TrainingJob` as before.
- The `_record_to_info()` helper duplication between `routers/models.py` and `routers/training.py` is still present (F2 carry-forward). Tolerable for now; revisit when `ModelInfo` gains another field.

### Known limitations (deferred)
- **History DB grows unbounded by default.** Auto-purge is OFF by default and capped at 30 days when ON. Pilot users who don't enable it will accumulate rows + sidecars indefinitely (a typical 200-epoch run is ~500 KB compressed, so 1000 runs ≈ 500 MB — not a v1 concern but worth a follow-up if pilot lasts).
- **Re-run from a Colab row prefills the local-training wizard** (per PLAN-F3 decision 6). The user opens the Colab modal again from `/train/configure` if they want a fresh Colab session. Pre-filling the Connect modal directly is a future follow-up if pilot users ask for it.
- **No bulk-select in the history table.** Each row's Delete is a one-by-one operation. If a clinician wants to clean up 20 failed experimental runs, they click 20 times. Bulk-select + bulk-delete is a future polish item.
- **The history detail page doesn't show the raw log lines** from the run (only the structured event chart-replay). If a failed run's debug info lives in the free-form stdout the runner emitted, it's accessible via the events.jsonl but not surfaced in the UI. Future work.
- **`_record_to_info()` is still duplicated** in `routers/models.py` and `routers/training.py` with a warning comment in both. Carried forward from F2.

---

## [0.11.0] — 2026-05-21 · F2: Training-run name + description + app-wide timezone setting

**Tag:** `v0.11-f2-run-naming` (second of the post-v0.9 Future-Features chain from `docs/FUTURE-FEATURES.md`; plan in `docs/PLAN-F2.md`)

### Added
- **Optional Name + Description on every training run.** New "Name this run" card on `/train/configure` sits above the Model & preset card. Name is a single-line input (max 200 chars) with a **live placeholder** showing the auto-generated default — `<Task> · <dataset-stub> · YYYY-MM-DD HH:MM` in the user's preferred TZ — that rebuilds when task or dataset change (and ticks forward every 60 s so the timestamp stays current). Description is a multi-line textarea (max 2000 chars). Both flow through to `POST /api/training/start` and `POST /api/training/colab/connect` via two new optional fields on the request schemas; backend `JobManager.start()` + `start_colab_job()` accept `name` + `description` kwargs and fall back to `_default_run_name()` when the caller sends empty (UI-driven calls always send a non-empty name since the placeholder gets promoted to the value on submit). The metadata lives on `TrainingJob` and shows up in `snapshot()` / `TrainingJobInfo` everywhere.
- **Inline name + description editing on `/train/run`** while the run is in flight. The run name replaces `statusLabel` as the page's h1 (with the status moved into the meta row below). Click the pencil icon next to the name → inline input → Enter or Save commits via `PATCH /api/training/{id}` and `setSnapshot` reflects the change immediately. Description shows below the name as italic text (or `"No description."` in greyed-out non-italic if empty); a separate pencil opens a popover modal with a textarea + Save/Cancel. Both edit affordances disappear once `status` is terminal (completed / failed / cancelled), replaced with a grey hint *"Editing locked after the run finishes (re-enabled when history persistence lands in F3)."* `ApiError.message` surfaces inline as a small red banner if the PATCH fails.
- **Started / Finished / Elapsed timestamps on `/train/run`.** While running: `Started <time> · Elapsed Xm Ys`. After completion: `Started · Finished · Elapsed`. All three render through the new `formatDate()` + `formatElapsed()` helpers in `apps/web/lib/format-date.ts` so they respect the user's TZ setting.
- **New `PATCH /api/training/{job_id}`** route + `UpdateTrainingMetadataRequest` schema + `JobManager.update_metadata(job_id, *, name, description)` method. Gated to `status in {queued, running}` — completed/failed/cancelled jobs return **409 Conflict** (the request itself is well-formed; the resource state forbids the edit). Field semantics: `None` = "don't touch"; empty string for `description` clears it; empty string for `name` resets to the auto-generated default. History edits land in F3 once the persistent layer ships.
- **Filename derivation from the run name on save-to-library.** `JobManager.save_to_library()` now slugifies `job.name` via `_slugify_run_name()` and saves as `<slug>.pt` instead of the old `trained-<stub>.pt`. Falls back to `trained-<stub>.pt` if the slug comes out empty (pure punctuation). On slug collision with an existing file in the destination dir, suffixes with `-<job_id[:8]>` so neither file overwrites — typical when two runs use the same default-derived name within the same minute. A clinician saving 20 trained classify runs now sees meaningful names in `/models` instead of `trained-9b3a1c4e.pt` × 20.
- **Unicode-safe naming via `python-slugify>=8.0`** (new base dependency). Slugify runs with `allow_unicode=True` and `lowercase=False` so a run named `"फेफड़े वर्गीकरण"` becomes a filename with the Devanagari preserved (not transliterated to `phephre-vargikaran`). Case is also preserved so `"Lung Classify Run"` → `Lung-Classify-Run.pt`. Cap of 80 chars on the slug leaves headroom for the optional `-<job_id[:8]>` suffix.
- **App-wide timezone setting (wide scope, F2 §9).** New "Timezone" section in `/settings` with a system-default radio (showing the auto-detected zone) + a custom-zone radio with a searchable IANA combobox populated from `Intl.supportedValuesOf('timeZone')` (~420 zones; falls back to a curated 11-zone list on older environments). Live preview shows the current time in the selected zone. Settings persist to `localStorage` under the `timezone` key on the existing `AppSettings` shape. Every timestamp render in the UI — the configure placeholder, the `/train/run` Started/Finished labels, and any future timestamp surface — routes through `apps/web/lib/format-date.ts`'s `formatDate` / `formatTrainingTimestamp` / `formatRelative` / `formatElapsed` helpers, all of which read the setting. A `usePreferredTimezone()` hook lets components subscribe to setting changes so the UI repaints without a page refresh.
- **22 new backend tests** in `tests/test_training_naming.py`: `_default_run_name` format (detect + classify); `_slugify_run_name` cases (ASCII case preservation, Devanagari preservation, pure-punctuation → empty, length cap); `TrainingJob.snapshot()` surfaces name + description; `JobManager.update_metadata()` semantics (running edit OK, empty name resets to default, None field untouched, completed/failed/unknown all rejected); `PATCH /api/training/{id}` route (200 / 409 completed / 409 failed / 404 unknown); `save_to_library` filename derivation (slug used, Unicode preserved, empty-slug fallback, collision disambiguation); `POST /api/training/start` + `POST /api/training/colab/connect` both accept the new fields and pass them through to the manager.

### Fixed
- **`POST /api/training/{id}/save-to-library` 500'd with a pydantic `ValidationError: path Field required`** since v0.10.0 / F1 because the training router has its own `_record_to_info()` helper that wasn't updated when F1 added the new `path` field to `ModelInfo`. The existing `test_save_to_library_downloads_best_pt` in `tests/test_colab_integration_smoke.py` wraps the save call in a broad `except Exception: pass` (originally to tolerate a dummy-checkpoint registry-scan failure), which silently swallowed this validation error too — that's why CI never caught it. Fixed with a one-line `path=str(record.path)` addition + an in-line comment warning about the duplication, plus a new regression test `test_save_to_library_route_returns_valid_model_info` in `tests/test_training_naming.py` that hits the route end-to-end and asserts the response is a validatable `ModelInfo` with `path` present. Caught by the user during F2 manual verification when saving a trained `WBC-Yolov26-Final` to the library.

### Known limitations (deferred)
- **Editing name / description on a completed run is intentionally blocked.** PATCH returns 409 with a clinician-readable message pointing at F3. Re-enables when F3's persistent training-history layer lands (the edit needs somewhere durable to live, not in-memory `JobManager` state that disappears at app quit).
- **No keyboard shortcut to open the description popover.** Click-only for now. Add `e` as a hint when F3's history page introduces multiple per-row edit affordances.
- **Timezone setting doesn't trigger a `formatRelative()` rebuild on the second** — relative labels (`"3 min ago"`) update lazily on the next render, which in most cases is fine since they only appear after a state change. Acceptable for v1; revisit if pilot users notice stale "ago" labels.
- **The two `_record_to_info()` helpers in `routers/models.py` and `routers/training.py` are still duplicated**, with a warning comment in both. Tolerable for now (eight-line helper, change rate is low), but worth de-duplicating into a shared helper module the next time `ModelInfo` gains another field.

---

## [0.10.0] — 2026-05-21 · F1: Models library — delete + reveal on disk + path on every card

**Tag:** `v0.10-f1-models-polish` (first of the post-v0.9 Future-Features chain from `docs/FUTURE-FEATURES.md`)

### Added
- **Delete a user-imported or locally-trained checkpoint from the library.** New `DELETE /api/models/{name}` route + `ModelRegistry.delete(name)`. Hard-delete (Finder Trash is the macOS safety net; `models/` lives under `~/Library/Application Support/`). Bundled weights are rejected with **HTTP 403** ("read-only — they live in the install tree and `scripts/fetch-models.py` would re-fetch them anyway") rather than 400, so the frontend can distinguish policy-rejected from malformed. Deleting a model that's currently the per-task default drops the entry from `defaults.json`; `get_defaults()` then falls back to any remaining model of the right task on the next read, so the next request returns a coherent state. If the `.pt` file already disappeared (someone deleted it externally between `scan()` and the click), the registry tolerates the `FileNotFoundError` and still cleans up its in-memory record + defaults so the UI stops showing a ghost entry.
- **Reveal a checkpoint in the OS file manager.** New `POST /api/models/{name}/reveal` route. Has to live on the backend because the QtWebEngine renderer is sandboxed — it can't spawn `open` / `explorer` / `xdg-open` directly. Per-OS dispatch: macOS `open -R "<path>"` (selects the file in Finder), Windows `explorer /select,<path>` (selects in Explorer — note no space after the comma), Linux `xdg-open <parent_dir>` (opens the containing folder; xdg-open has no /select equivalent). `subprocess.run(check=False)` so a non-zero file-manager exit doesn't fail the request — the Finder window appearing IS the success signal. 404 if the model name is unknown; 410 Gone if the registry knows the name but the file vanished from disk.
- **`path` field on every `ModelInfo` response.** Absolute on-disk path surfaced via the API for the first time. Bundled, user-imported, and trained-locally checkpoints all carry it — consistent affordance across sources.
- **Path row on every model card** in `/models`. New section below Size: "On disk · `<absolute path>`" rendered in monospace, truncated with `title` for hover-to-reveal-full-path. A pathologist who trains 20 classify runs can now see where their checkpoints actually live without spelunking the storage root.
- **Reveal-in-Finder button** on every card (bundled too, per the F1 decision pass). Calls the new `/reveal` route; no success toast (the Finder window IS the signal). Errors surface inline at the bottom of the card via a small red banner.
- **Delete button** on user/trained cards. Bundled cards show the button disabled with a tooltip ("Bundled models are read-only"). Click opens a confirmation modal that quotes the file name + full path, calls `DELETE /api/models/{name}`, and on success invalidates the `["models"]` query so the card disappears without a page reload. On error the modal stays open with the `ApiError.message` inline so the user can read it and either retry or cancel.
- **Eight new backend tests in `tests/test_models_api.py`** (the project's first dedicated model-API test file): user delete removes file + record; bundled delete → 403 + file untouched; missing name → 404; deleting the current default clears it from defaults.json and `get_defaults()` falls back; deleting tolerates the file already being missing; path field present on both list + single responses; reveal dispatches `open -R` on Darwin, `explorer /select,<path>` on Windows, `xdg-open` on Linux; reveal returns 404 for unknown names + 410 for missing files without ever calling subprocess. Fixture uses a synthetic `_inspect` so the suite runs in <1 s without needing the `ml` extra or any real `.pt` content.

### Fixed
- Nothing user-visible — this is a feature release. F1 is the smallest of the four post-v0.9 features in `docs/FUTURE-FEATURES.md`, planned in `docs/PLAN-F1.md` and signed off before any code landed.

### Known limitations (deferred)
- **Delete is unguarded against in-flight inference / training jobs.** If you delete a model while a `POST /api/inference/single` is mid-flight, the YOLO instance the request captured stays alive in the request-scoped local but its `path` is now a dead pointer; the inference completes, the next request fails to load (file missing), and the user sees a clear error. No data loss, but worth a follow-up before pilot — tracked as a one-line F1 carry-forward (see `docs/CARRY-FORWARDS.md` after this release).
- **Soft-delete / Trash / Undo is not implemented.** Hard-delete only. macOS Finder Trash is the system-level safety net since `models/` lives under `~/Library/Application Support/`. If pilot users repeatedly ask "I deleted the wrong one, can I recover it?" we revisit.
- **No "warn if a saved prediction report references this model" guard** in the delete confirmation (called out in FUTURE-FEATURES.md item 1's acceptance criteria). That guard requires the persistent training-history layer from F3 to be meaningful. Plain confirmation modal for now; we add the cross-reference in F3.
- **`settings.mode === "desktop"` gate is not applied to the Reveal button** (FUTURE-FEATURES.md originally specified it). That setting doesn't exist yet — and this project is always-desktop by definition (Pyloid + QtWebEngine binary, no web-mode build). If a web build ever ships, this becomes a real gate.

---

## [0.9.1] — 2026-05-20 · P6.fix-1: Run on Colab callout now visible on all hardware (was MPS/CUDA-hidden)

**Tag:** `v0.9.1`

### Fixed
- **Run on Colab callout is now visible on every hardware kind, not just CPU.** The callout was gated by `hardware?.kind === "cpu"` since P6b, which meant clinicians on MacBooks (MPS) or Linux/Windows machines with NVIDIA GPUs (CUDA) couldn't see the *Run on Colab* button at all — the entire Colab feature was unreachable from the UI on those machines. Caught by the user testing on an MPS MacBook. The callout now adapts its copy to the detected hardware: **CPU** keeps the loud warning (*"This machine has no GPU — local training will be slow"*), **MPS** softens to *"Want a faster GPU? Train on a free Colab T4 instead — often faster than Apple Silicon MPS for YOLO training"*, **CUDA** quietest (*"Train on a free Google Colab GPU instead. Useful if you'd rather not pin this machine's GPU during training"*). One callout component, three copy variants picked from a switch on `hardware.kind`.

---

## [0.9.0] — 2026-05-20 · P6: Train on Colab — resilience polish, reconnect-with-backoff, retry on best.pt fetch, pilot test plan

**Tag:** `v0.9-p6-train-colab` (phase-completion tag; matches PLAN.md §14)

### Added
- **Reconnect-with-backoff on tunnel drops.** `engine/colab_reader.py` now wraps the WebSocket read loop in an outer retry loop. Each attempt does a quick `GET /status?token=…` pre-flight (3 s timeout) so the reader can distinguish three failure modes instead of treating every drop the same: **auth** (HTTP 401 — notebook cell restarted with a new token, abandon immediately with a clear message), **network** (any other HTTP error / URLError — sleep + retry with exponential backoff: 2/4/8/16/32/60 s, capped at 20 attempts ≈ 18 min total), **ok** (proceed to open the WS). Free Colab GCs the runtime every few minutes; this rides through those blips without manual reconnect.
- **`connection` events surface reconnect state to the UI.** The reader emits synthetic `{type: 'connection', status: 'reconnecting' | 'reconnected' | 'abandoned', attempt, delay_s, message}` events into `job.events`, which the existing WS fan-out forwards to the browser. `/train/run` renders a `ColabConnectionBanner` with task-specific copy and palette (amber while reconnecting + spinner showing attempt count and back-off delay, green when reconnected — banner clears itself, red when abandoned). Frontend `TrainingEvent` union extended.
- **Cancel mid-backoff is clean.** `TrainingJob` gains a `_reader_stop_event: threading.Event` for Colab jobs; `JobManager.cancel()` sets it (alongside the existing POST /cancel best-effort), and the reader checks it in every backoff sleep + read loop. Result: clicking Cancel on a job whose tunnel is already dead doesn't leave the reader spinning for 18 minutes — it exits in <1 s with `cancelled` status.
- **Retry-on-failure for `fetch_best_pt`.** `engine/colab.py::fetch_best_pt` now tries up to 3 times with 2/4/8 s exponential backoff on transient network failures. Fail-fast on HTTP 401 (token changed — retry won't help) and 409 (training isn't complete — retry won't help until it is). Internal `_stream_best_pt_once` tags exceptions with a `retryable` attribute so the retry loop knows when to bail vs back off. Save-to-library now survives a Cloudflare blip mid-download instead of making the clinician re-click.
- **`docs/PILOT-TEST.md`** — the 9-step end-to-end plan from PLAN-P6.md §7 expanded into an executable checklist with per-step pass criteria, expected outputs, and a troubleshooting table covering every error message the user might see (stale URL, token rejected, tunnel unreachable, payload mismatch). Includes the deliberate-disconnect step for verifying the reconnect banner end-to-end against a real Colab cell.
- **Six new smoke tests cover the P6c contract** (`tests/test_colab_integration_smoke.py`): tunnel-drop emits a `reconnecting` connection event; cancel during backoff flips status to `cancelled` within seconds; `_preflight` returns `auth` for HTTP 401 + `network` for unreachable hosts (this is the direct contract test for the reconnect-loop's classification); `fetch_best_pt` retries on transient errors + fails fast on non-retryable HTTP codes. Full suite: 23/23 passing.

### Fixed
- Before P6c, a single transient WebSocket close (Cloudflare propagation hiccup, Colab runtime GC) would synthesise an `error` event and mark the job failed — even though training was still running on the Colab side. Now the reader announces a reconnect attempt and recovers transparently when the tunnel comes back.
- Before P6c, cancelling a Colab job whose tunnel was already dead would POST /cancel to nowhere (no-op) and leave the reader thread alive. The desktop UI showed the job as still running until the WS naturally timed out. Now `cancel()` signals the stop event so the reader exits within the current backoff window.

### Known limitations (deferred)
- No automatic re-paste-URL UI on the run page. When the reader abandons due to a token change, the user has to navigate back to /train/configure, click Run on Colab again, and paste the new URL. A dedicated Reconnect modal on /train/run that takes a new URL is post-pilot polish.
- best.pt download doesn't use HTTP Range — retry restarts from byte 0. For 5-80 MB checkpoints on Cloudflare quick-tunnels this is acceptable; revisit if pilot users report large checkpoints failing repeatedly.
- The pilot test plan in docs/PILOT-TEST.md hasn't been executed yet — that's a clinician + dataset task, not a Claude task. Pilot verification is the gate on declaring v1.0.

---

## [0.8.9] — 2026-05-20 · P6b: Train on Colab — desktop Run on Colab callout + Connect modal + Colab-backed jobs

**Tag:** `v0.8.9-p6b-colab-desktop`

### Added
- **Run on Colab callout on `/train/configure`** — when the accelerator probe returns `cpu`, a yellow card now sits between the hyperparameter section and the Start training button: *"This machine has no GPU — local training will be slow. Train on a free Google Colab GPU instead."* with a Run on Colab button. Clinicians on CPU-only Macs / Windows boxes no longer stumble into accidental overnight CPU runs.
- **Connect to Colab modal** — task-aware (detect vs classify), shows the GitHub-anchored Colab notebook URL with Copy + Open buttons, takes the `trycloudflare.com?token=…` URL the cell printed, and calls the backend's pre-flight to validate. Errors surface in-modal in plain English (stale URL, wrong token, unreachable host, wrong payload shape) instead of as raw HTTP failures.
- **`engine/colab.py`** — desktop-side bridge to the Colab worker. `ColabSession` carries the parsed base URL + token + the GET /status response so callers can seed a TrainingJob in one round trip; `connect(tunnel_url)` does a 3 s `GET /status?token=…` pre-flight and raises `ColabConnectError` with clinician-readable text on every failure mode; `request_cancel(session)` POSTs /cancel; `fetch_best_pt(session, dest)` streams /best.pt to disk with `shutil.copyfileobj`. Stdlib-only (urllib) — no new HTTP client dependency.
- **`engine/colab_reader.py`** — daemon-thread WebSocket reader that translates remote `_VRL_EVENT` payloads into `job.append_event` calls, the exact same code path the local subprocess reader uses. Uses `websockets.sync.client.connect` so no asyncio thread juggling. Synthesises an `error` event if the Colab cell stops before a terminal event arrives, so the desktop UI flips out of live-charts state cleanly instead of spinning forever.
- **`JobManager.start_colab_job(tunnel_url)`** — parallel entry point alongside the existing `start(...)`. Returns a `TrainingJob` shaped identically to a local run (with `accelerator_kind='colab'` and `_colab_session` set instead of `_process`), so `/train/run` and the existing `/api/training/{id}/stream` WebSocket fan-out consume Colab events with zero changes. `cancel()` branches on `_colab_session`: POST /cancel to the tunnel for Colab jobs, SIGTERM the subprocess group for local. `save_to_library()` lazy-downloads best.pt through the tunnel for Colab jobs before the existing copy-to-models logic runs.
- **`POST /api/training/colab/connect`** — accepts `{ tunnel_url }`, calls `manager.start_colab_job`, returns `{ job_id }`. Maps `ColabConnectError` to a clean HTTP 400 with the original clinician-readable detail message, so the frontend can render it without translation.
- **`connectColab()` API helper** — `apps/web/lib/api.ts`. Signature matches `startTraining()` so the configure page's success handler (set active job + push to /train/run) works for both local and Colab jobs interchangeably.
- **P6b integration smoke test suite** — `tests/test_colab_integration_smoke.py` (9 passing tests) stands up a real ColabServer on localhost, treats it as a tunnel, and exercises `engine.colab.connect` (success + missing-token + bad-scheme + unreachable-host), `JobManager.start_colab_job` (seed shape + reader-thread event propagation + terminal-event status flip), `JobManager.cancel` (POSTs through to the tunnel), and `JobManager.save_to_library` (downloads best.pt + lands in models/<task>/).

### Fixed
- Colab-side `JobState` and `/status` response gained `imgsz` + `batch` so the desktop's connect pre-flight has the full training config in one round trip; previously the desktop would have needed to wait for the replayed `start` event over WS to populate those fields.

### Known limitations (deferred)
- No reconnect-with-backoff on WebSocket drops. The current reader thread surfaces an `error` event if the tunnel goes down, but the desktop doesn't yet attempt to reconnect when the Colab cell is restarted. Ships in P6c.
- best.pt download isn't resumable. If the tunnel drops mid-download, the user re-clicks *Save to library*. Tracked for P6c polish.
- End-to-end pilot test against real Colab + a clinical dataset (the 9-step plan in docs/PLAN-P6.md §7) hasn't run yet — that's P6c.

---

## [0.8.8] — 2026-05-20 · P6a: Train on Colab — companion notebooks + Colab runtime (no desktop integration yet)

**Tag:** `v0.8.8-p6a-colab-notebook`

### Added
- **Two companion Colab notebooks** — `notebooks/01_train_detect_colab.ipynb` (detection) and `notebooks/02_train_classify_colab.ipynb` (classification). Five-cell thin orchestrators: mount Drive → clone the repo → edit a config dict → start the local server + Cloudflare quick-tunnel → run training. The notebook URLs in `docs/COLAB-GUIDE.md` are GitHub-anchored so any fix lands the next time the clinician opens Colab.
- **Colab-side runtime modules** under `notebooks/_runtime/`: `colab_tunnel.py` (downloads cloudflared on first use, parses the `trycloudflare.com` URL from stdout, returns a live `TunnelHandle`), `colab_server.py` (FastAPI mini-server exposing `GET /status`, `WS /events`, `GET /best.pt`, `POST /cancel` — all token-authenticated per docs/PLAN-P6.md §4.6), `colab_runner.py` (Ultralytics training driver that publishes events through the server's fan-out queue and honours cancellation requests between epochs).
- **Shared wire-protocol module** — extracted the metric-key dictionaries, `_emit`, `safe_metric`, and `extract_metrics` into `server/vrl_yolo/engine/_runner_common.py`. Both `train_runner.py` (local subprocess) and `colab_runner.py` (Colab in-process) import from it, so when Ultralytics renames a metric key in a minor version the fix lands once instead of drifting silently between runners.
- **Clinician-facing guide** — `docs/COLAB-GUIDE.md` walks through Drive layout for both tasks, where to find the Colab notebook URL, GPU runtime setup, config-cell editing, what to expect from the cell output, and how to paste the URL into the desktop modal that's coming in P6b. Includes a troubleshooting section for the common failure modes (stale tunnel URL, Drive auth re-prompt, missing GPU).
- **End-to-end smoke test suite** — `tests/test_colab_server_smoke.py` spins up a real uvicorn instance and verifies token enforcement on every route, the `/status` JSON shape, the `best.pt` 409→200 transition once `complete` fires, WebSocket auth rejection, and event replay (events published before the WS connects are sent on subscribe so the desktop can disconnect/reconnect mid-run without losing history). Eight tests pass on a fresh checkout via `uv run --extra ml pytest tests/test_colab_server_smoke.py -q`.

### Known limitations (deferred)
- No desktop UI yet — `/train/configure` doesn't surface a *Run on Colab* button, and there's no *Connect to Colab* modal. Coming in P6b (`v0.8.9-p6b-colab-desktop`).
- No reconnect-with-backoff on WebSocket drops. The current server replays on subscribe so reconnect-via-page-refresh works, but the desktop's auto-reconnect logic ships in P6c.
- best.pt download isn't resumable. If the tunnel drops mid-download, the user re-clicks *Save to library*. Tracked for P6c polish.
- Cloudflare quick-tunnels still print a new URL every cell run. Named tunnels with a stable URL are post-pilot — see docs/PLAN-P6.md §4.5.

---

## [0.8.7] — 2026-05-19 · P5.fix-7: Bundle our own dist-info — version badge no longer reports `0.0.0+source`

**Tag:** `v0.8.7`

### Fixed
- **Top-right version badge now reports the real shipped version** (e.g. `v0.8.7`) instead of the `v0.0.0+source` fallback that every PyInstaller-bundled release from v0.8.5 through v0.8.6 was showing. Cause: PyInstaller's `--collect-submodules vrl_yolo` bundles our package's source but not its `dist-info` metadata, so `importlib.metadata.version("vrl-yolo-gui")` raised `PackageNotFoundError` at runtime and `_resolve_version()` returned the placeholder. `Info.plist`'s `CFBundleShortVersionString` was always correct (PyInstaller writes it from the `--name` + read-from-pyproject path); only the runtime-read API version was wrong. `/api/health` is the load-bearing read — the topbar pulls it once on first paint.
- Fix: add `--copy-metadata vrl-yolo-gui` to the PyInstaller invocation in `scripts/build-release.py`. One-line build-script change; no Python source change. The bundle ships ~1 KB of extra metadata; runtime version-lookup now succeeds. Dev mode (`uv run python src-pyloid/main.py`) was already correct because uv installs the package editably with proper dist-info.

### Known limitations (deferred)
- Doesn't backfill the badge on installs of v0.8.5 / v0.8.6 — those binaries are shipped as-is. Re-install from the v0.8.7 release to see the fix on your laptop.

---

## [0.8.6] — 2026-05-19 · P5.fix-6: Preserve existing splits — splitter no longer always reshuffles

**Tag:** `v0.8.6`

### Added
- **Prepare splits now has a Preserve existing assignments checkbox.** Until v0.8.5, clicking Prepare splits on a dataset that already had `train/` + `val/` (or `valid/`) hand-curated by the user would gather every image from anywhere under the dataset root, reshuffle them by seed, and redistribute — destroying hand-curated splits. Users with a Roboflow export who just wanted to *add* a test split couldn't do it without losing the curated train/valid distribution. v0.8.6 fixes this: when the checkbox is on (default ON when the dataset already has at least one recognised split, OFF for a flat layout), images already in `train/` / `val|valid|validation/` / `test/` stay in those splits, and the ratios apply only to flat / unassigned images. Classify stratification still applies per-class to the flat pool. Detect carries each preserved image's label along (or its missing-label state).
- **Modal shows the impact before you click Split.** When Preserve is on AND there are preserved images in a split, the slider labels read `Train (10 preserved + 4 new = 14 images)` instead of just `Train (14 images)`. Test row uses the same format. When Preserve is on but every image is already in a split, the Split button greys out with the message *Every image is already in a split — nothing to redistribute. Uncheck Preserve to reshuffle from scratch.* — that's a UI-side guard so the case is caught before the backend round-trip; backend also enforces it with a clean 400 for direct API callers.

### Fixed
- Inspector now reports `unassigned_image_count` on `DatasetInfoOut` so the frontend can tell whether a mixed layout (split + flat at root) has anything for Preserve to redistribute. Without this, the modal's flat-count derivation off `dataset.splits` would silently miss flat images that the inspector hides behind a split-layout report — disabling the Split button when it shouldn't be. Implementation: `_imagefolder_split_layout` scans non-reserved sibling dirs for image counts; `_inspect_roboflow_yolo` scans `<root>/images/`. Old API responses that omit the field default to 0 on the frontend (graceful degradation).
- Backend splitter internals (`_find_image_label_pairs`, `_collect_imagefolder_images`) now tag each image with its current split (`"train"` / `"valid"|"val"` / `"test"` / `None` for flat), normalised to the splitter's output convention so a `valid/` input survives the round-trip as `valid/` for detect and `val/` for classify. Both splitters share `_existing_split_for` for path-component recognition.

### Known limitations (deferred)
- Splits view on `/train/dataset` still doesn't surface the unassigned image count outside the Prepare-splits modal — a user with a mixed layout sees `train: 10 · val: 4` on the page and might not realise 6 flat images exist. Not blocking pilot; surfacing this is a small follow-up if pilot users get confused. The modal itself shows the count correctly when opened.
- Preserve doesn't currently let a user CARVE a test split out of existing train (i.e. "I have train+val with no test, give me a test from train"). That's a different operation semantically — the splitter is fundamentally a "distribute a pool of images" op. Out of scope here.

---

## [0.8.5] — 2026-05-18 · P5.fix-5: Graceful job cancel on Cmd+Q (training subprocess no longer orphaned)

**Tag:** `v0.8.5`

### Fixed
- **Cmd+Q during a training run now actually stops the training.** v0.8.2 fixed the macOS Cmd+Q crash by intercepting `QEvent::Close` and calling `os._exit(0)` to bypass the `QSurface` / `QThreadStorage` static-destructor race. That works, but `os._exit` is abrupt — it doesn't unwind Python, which means the training subprocess (Ultralytics under `train_runner.py`) gets reparented to launchd and keeps running silently in the background. CPU / RAM / MPS stay pinned for the rest of the run, the eventual `best.pt` is invisible to the (now dead) `JobManager`, and the user thinks Cmd+Q cancelled their training when really it only hid the UI. The new `_cancel_active_jobs_best_effort(app, timeout_s=3.0)` walks every running / queued job through `JobManager.cancel()` (which already SIGTERMs the process group on POSIX), polls for clean exit, and only then proceeds to `_macos_hard_exit`. Wired into both the `QEvent::Close` filter (Cmd+Q path) and the `aboutToQuit` fallback (e.g. SIGTERM from a signal handler).
- Best-effort means best-effort: if a job hangs past the 3 s cap, we hard-exit anyway. Leaving a partial checkpoint on disk is a strictly better outcome than the close crash this code was originally written to prevent, and SIGTERM almost always lands in well under 3 s for an Ultralytics run. Every step logs through the existing `step:` print pattern so `launch.log` shows the cancellation trail.
- The function signature for `_install_macos_shutdown_workaround` grew a second parameter (the FastAPI app), so the close filter can reach `app.state.job_manager` at fire time. Renamed the parameter `fastapi_app` to avoid shadowing the existing `app = QApplication.instance()` local. Verified the existing `VRL_YOLO_GUI_TEST_AUTO_QUIT_S=4` smoke still exits cleanly with no active jobs (no-op cancel path), proving the install + intercept chain didn't regress.

### Known limitations (deferred)
- **Linux / Windows still orphan the training subprocess** on app quit. Subprocess is started with `start_new_session=True` (POSIX) / `CREATE_NEW_PROCESS_GROUP` (Windows), so the parent dying doesn't propagate. Pilot is macOS-only — out of scope here. Will revisit when we ship for those platforms.
- Cancellation logic runs from the main Qt thread inside an event filter, so it blocks the UI for up to 3 s. That's intentional — the alternative is returning to the close cascade, which is the crash path we explicitly bypass. Cmd+Q with a training run mid-epoch will feel marginally laggier than without one; the user sees it as the training shutting down, which is the right mental model.
- Skill `python-pyloid-desktop-packaging` still doesn't document this pattern. Tracked separately in `docs/CARRY-FORWARDS.md` item #2.

---

## [0.8.4] — 2026-05-18 · P5.fix-4: Subprocess env-var dispatch (Train opened a second app + stuck at epoch 0)

**Tag:** `v0.8.4`

### Fixed
- **Pressing Start training no longer spawns a second Pyloid window, and the training subprocess no longer stalls at "Waiting for first epoch…".** Both symptoms were the same root cause: `JobManager.start()` spawned the training subprocess with `[sys.executable, "-m", "vrl_yolo.engine.train_runner", ...]`. That works fine in dev (where `sys.executable` is `python3.11`), but PyInstaller's bootloader in the frozen `.app` IGNORES `-m module` and just re-runs the bundled entry script — so the subprocess booted a second Pyloid window instead of the training runner, and the parent JobManager sat there waiting for events on a stdout that would never produce any.
- Fix: env-var sentinel. `src-pyloid/main.py` now reads `VRL_YOLO_GUI_SUBPROCESS` at boot (after `multiprocessing.freeze_support()`) and, when set to `"train_runner"`, dispatches to `train_runner.main()` directly — skipping the entire Pyloid / uvicorn boot. `JobManager.start()` sets that env var in the child env (`_child_env()`) and switches the cmd from `-m module` to positional argv. Dev mode passes `main.py` explicitly so python has a script to run; frozen mode uses the bundled binary directly. Same dispatch path in both, so dev runs exercise the same code the frozen `.app` will hit.
- Defensive: dispatch also bails out if `--multiprocessing-fork` appears in `sys.argv`, in case a future CPython release changes when `freeze_support()` intercepts mp-worker spawn args. Belt and braces.

### Known limitations (deferred)
- Same as v0.8.3: in-flight training subprocess is reparented to launchd on Cmd+Q. Follow-up.
- Module-level `_MAIN_PY = Path(__file__).resolve().parents[3] / "src-pyloid" / "main.py"` assumes training.py lives at `<repo>/server/vrl_yolo/engine/training.py` in dev. If the layout ever shifts, dev runs will raise a clear `RuntimeError("src-pyloid/main.py not found at ...")` at training-start time. Frozen mode doesn't care — it uses the bundled binary directly.

---

## [0.8.3] — 2026-05-18 · P5.fix-3: Flat ImageFolder support + Prepare splits for classify + layout examples

**Tag:** `v0.8.3`

### Added
- **Flat ImageFolder layout is now recognised.** v0.8.0–v0.8.2 only detected the Ultralytics-ready split layout (`<root>/train/<class>/*.jpg`). The human-friendly flat layout (`<root>/<class>/*.jpg` — what doctors actually drop in when one folder per class is the natural way to organise lab images) was tagged "Unknown layout" and Continue was gated off. The inspector now accepts both shapes. Flat layouts are flagged with a clear warning saying training needs the splitter to run first.
- **Prepare splits now works for classification.** The same `POST /api/datasets/{id}/split` endpoint dispatches on detected task: detect routes to the existing YOLO splitter (image+label pairs, rewrites `data.yaml`); classify routes to the new `split_imagefolder` which stratifies per class and stages into `train/<class>/`, `val/<class>/`, and optionally `test/<class>/` — the exact shape Ultralytics' classify mode expects. Per-class stratification means a 10-image class doesn't accidentally land 9 in val and 1 in train.
- **Layout examples card on the dataset upload page.** A collapsible "What does my dataset need to look like?" card sits below the dropzone, showing 4 concrete ASCII trees: Roboflow YOLO, plain YOLO, flat ImageFolder, split ImageFolder. Open by default the first time; the collapsed state persists across visits via `localStorage` so frequent users aren't yelled at.
- **Prepare splits modal is task-aware.** Title, copy, slider label (Valid vs Val), and the validation-set warning all switch based on `dataset.task`. Detect users see Roboflow-shaped paths; classify users see `train/<class>/` / `val/<class>/` and the warning that Ultralytics' classify mode refuses to start without a val split.

### Fixed
- `SplitModal`'s `totalPairs` used `Math.min(image_count, label_count)` everywhere — fine for detect, but collapsed classify totals to 0 because ImageFolder splits have `label_count: 0`. Classify branch now counts images directly.
- `needsSplitting()` now also surfaces the splitter for flat ImageFolder (single "all" pseudo-split) and for classify split-layouts missing val/. Previously classify always returned false, so the Prepare splits button never appeared even when training would fail without it.

### Known limitations (deferred)
- Same as v0.8.2: in-flight training subprocess is reparented to launchd rather than receiving a SIGTERM on Cmd+Q. Graceful job-group shutdown before the hard exit is still a follow-up.
- Layout examples card uses fixed ASCII trees; a future polish pass could swap them for SVG or render real previews of the user's dropped folder.
- Classify splitter merges images from all source locations (flat + any pre-existing train/val/test) and re-shuffles. If the user wanted to PRESERVE a hand-curated train/val/test split and just generate a missing test, they can't — Prepare splits is all-or-nothing. Acceptable for v1; might revisit if pilot feedback asks for it.

---

## [0.8.2] — 2026-05-17 · P5.fix-2: Window-scoped close filter (P5.fix-1 startup regression)

**Tag:** `v0.8.2`

### Fixed
- **Startup regression introduced by v0.8.1 is fixed.** v0.8.1 installed a `QApplication`-level `QEvent::Quit` event filter to bypass the macOS Cmd+Q crash. That filter ran for every event for every `QObject` in the app — including the events `QWebEngineView` / `QQuickWidget` exchange during construction. Some of those events arrive from internal C++ objects whose Python wrappers PySide6 6.9 can't resolve, so `PySide::typeName(QObject const*)` deref'd null inside `sendThroughApplicationEventFilters` (confirmed via a `python3.11-*.ips` crash report from the local repro) and the process exited silently between `pyloid.create_window` and `pyloid.run()`. Bisecting by disabling just the `installEventFilter` line restored startup, confirming the filter was the killer.
- Replaced the app-wide `QEvent::Quit` filter with a **window-scoped `QEvent::Close` filter** installed AFTER `pyloid.create_window` returns. The filter is attached to the real `QMainWindow` reached by walking `window._window._window` (with a defensive 4-deep walk so future Pyloid releases that shift the field name don't silently no-op us). Scoping to one specific `QObject` means the filter only sees events delivered to that `QObject` — the PySide6 wrapper-resolution crash never gets a chance to fire. Catching `QEvent::Close` instead of `QEvent::Quit` puts us at the same place in the close cascade: it arrives at the `QMainWindow` before Pyloid's `closeEvent` runs, so we still pre-empt the `QCoreApplication.quit()` → re-entrant `[NSApplication terminate:]` path that was the original v0.7.1 / v0.8.0 crash.
- Kept the `aboutToQuit` fallback (for non-Cmd+Q paths that DO unwind through `exec()`), plus added per-step launch.log breadcrumbs (`step: macOS shutdown workaround installed …` / `step: QEvent.Close intercepted …`) so the next failure mode is one log-tail away from a diagnosis.
- Added a new env-gated test helper `_maybe_install_auto_quit_for_test()`: setting `VRL_YOLO_GUI_TEST_AUTO_QUIT_S=N` schedules a `QApplication.quit()` N seconds after `pyloid.run()` starts, so the close path can be exercised on a headless dev machine without sending real Cmd+Q. No-op when the env var is unset; ships in the binary so a clinician filing a bug can be asked to run with it set.

### Known limitations (deferred)
- Same as v0.8.1: in-flight training subprocess is reparented to launchd rather than receiving a SIGTERM. Graceful job-group shutdown before the hard exit is still a follow-up.
- Window-scoped filter assumes Pyloid's `BrowserWindow` exposes its `QMainWindow` within four `_window` hops. If a future Pyloid release reshapes that, the launch.log will print `macOS shutdown workaround skipped — could not locate underlying QMainWindow on 'BrowserWindow'` and the old crash returns. Worth a heads-up if you ever bump Pyloid.
- Upstream `python-pyloid-desktop-packaging` skill still documents the `aboutToQuit`-only fix AND doesn't warn against app-wide event filters — both should be updated.

---

## [0.8.1] — 2026-05-17 · P5.fix-1: macOS Cmd+Q event-filter shutdown (regressed startup; superseded by v0.8.2)

**Tag:** `v0.8.1`

### Fixed
- **Cmd+Q on macOS no longer crashes the binary.** v0.8.0 (and every prior macOS build) inherited the `python-pyloid-desktop-packaging` skill's `aboutToQuit → os._exit(0)` workaround for the long-standing Qt6+QtWebEngine static-destructor race (`QSurface::~QSurface` → `QOpenGLContext::currentContext()` → `QThreadStorageData::get()` dereferences a null pointer deep inside `__cxa_finalize_ranges`). On macOS 26.x with PySide6 6.9 + Pyloid 0.27 that hook turned out to be **insufficient on the menu Cmd+Q path**: AppKit's `[NSApplication terminate:]` sends a `QEvent::Quit` to `QApplication`, Pyloid's `BrowserWindow.closeEvent` calls `QCoreApplication.quit()` from inside the close cascade, and `quit()` on macOS routes back through the Cocoa platform plugin and **re-enters `[NSApplication terminate:]` recursively** — proceeding straight to `libc exit()` without unwinding back to `QCoreApplication::exec()`'s cleanup, which is where `aboutToQuit` is actually emitted. The fallback hook never fired; the destructor chain ran; the process aborted.
- Replaced the single `aboutToQuit` connection with a `QApplication`-level event filter that catches `QEvent::Quit` **before** it reaches `tryCloseAllWidgetWindows`, and `os._exit(0)`s right there. We never run any closeEvent, never re-enter terminate, never reach `__cxa_finalize_ranges`. The `aboutToQuit` hook is kept as a fallback for code paths that DO unwind through `exec()` (e.g. a SIGTERM signal handler calling `app.quit()` from a normal context).
- Module-level reference (`_quit_event_filter`) keeps the `QObject` alive past the function's stack frame — Qt holds a raw pointer via `installEventFilter`, and CPython would otherwise free it the moment the local went out of scope, crashing the next event delivery.

### Known limitations (deferred)
- In-flight training subprocess does not receive a SIGTERM before the parent exits via `os._exit(0)` — the child is reparented to launchd and runs to completion or is reaped by the OS. Plumbing a graceful job-group shutdown before the hard exit lands in a follow-up; this fix is scoped to stopping the crash.
- The upstream `python-pyloid-desktop-packaging` skill at `~/.claude/skills/python-pyloid-desktop-packaging/SKILL.md` still documents `aboutToQuit` alone as the fix. That should be updated to reflect the re-entrant-terminate path observed here so other Pyloid projects don't repeat the same incomplete workaround.

---

## [0.8.0] — 2026-05-17 · P5: Train — Classification local run

**Tag:** `v0.8-p5-train-classify`

### Added
- **Classification training is live.** The `/train` task picker no longer gates the Classification card behind "P5" — pick it, drop an ImageFolder (`train/<class>/*.jpg`, optionally with `val/<class>/*.jpg`), tune, hit Start, watch live top-1/top-5 accuracy curves alongside training loss, save the trained checkpoint into the model library, and run it on slide patches in `/predict`.
- **Dataset wizard accepts ImageFolder for training.** The inspector already recognised it (warning copy aside); P5 wires Continue past the dataset page and adds a friendly warning when the user's selected task on `/train` doesn't match the layout they dropped (e.g. classify task + Roboflow YOLO folder).
- **Configure page branches per task.** Classification filters the model picker to `*-cls` weights, swaps the image-size chip ladder to 96–384 (anchored at 224 — the size `yolo*-cls.pt` was distilled at), hides the YOLO class-name editor (ImageFolder dir names ARE the class names), and re-probes `/api/hardware` with `task=classify` for batch-size suggestions (classify head fits ~2× detect at the same VRAM).
- **Live charts switch on the job's task.** Detection still draws box/cls/dfl loss + mAP50/mAP50-95; classification draws `train/loss` + validation top-1/top-5 accuracy on a 0..1 axis. `TrainingJobInfo.task` is the source of truth, so the chart re-renders correctly even after a refresh.
- **Save-to-library routes per task.** A classify run's `best.pt` lands in `<storage_root>/models/classify/trained-<short_id>.pt`, the registry rescan picks it up, and the run page sets it as the new classify default so `/predict` is one click away.
- Backend: `engine/train_runner.py` gained a `--task` arg + classify metric-key probes (`metrics/accuracy_top1`, `metrics/accuracy_top5`, `train/loss` with `train/cls_loss` fallback) and routes `data=` to the ImageFolder root for classify vs `data.yaml` for detect. `engine/training.py::JobManager.start()` now takes `task`, validates the dataset shape per task, persists `task` on `TrainingJob`, and `save_to_library()` routes by `job.task` instead of hard-coded detect. `TrainingMetrics` schema gains nullable `loss` / `top1` / `top5` fields that coexist with the detect-only fields.

### Fixed
- The dataset inspector's ImageFolder warning no longer parrots "classification is P5 — configure page is detection-only for now"; it now surfaces the actually-useful warnings (missing `val/` split, single-class dataset) and stays silent when the layout is clean.
- The `/train` task picker's `disabled` flag and the configure page's hard-coded `task: "detect"` in the hardware-probe query key are both gone — selecting classify on `/train` now actually drives every downstream surface.
- `/train/configure` re-seeds epochs + image_size from the new task's preset when the user switches detect ↔ classify, so 640px doesn't linger from a previous detect session into a classify run.

### Known limitations (deferred)
- Classification training reports `train/loss` as `null` on some Ultralytics 8.4+ builds where the value sits under `train/cls_loss` only after the validation pass. The chart connects across nulls; the dropped points are silent rather than crashing the stream.
- Confusion matrix + per-class precision/recall reports for classify are P7-polish — the run page shows live top-1/top-5 but doesn't yet render a confusion grid at completion.
- Multi-tenant training is still out of scope; one in-flight job per JobManager. A queued status flips straight to running on submit.
- Colab tunnel handoff for classify (PLAN.md §11) lands in P6 alongside detect.

---

## [0.7.1] — 2026-05-17 · P4b.fix-1: Models — Download + rename + ml-import safety net

No tag — between-phase patch.

### Added
- **Download** button on every model card in `/models`. Streams the `.pt` via `GET /api/models/{name}/download` with `Content-Disposition: attachment` so QtWebEngine's `downloadRequested` handler (P3b.fix-1) lands it in `~/Downloads/`. Works for bundled, imported, and locally-trained models alike — clinicians wanted a one-click backup of a freshly-trained checkpoint without spelunking into `<storage_root>`.
- **Rename** button on imported + trained checkpoints. Inline edit on the card title; Enter saves, Esc cancels. `.pt` extension auto-appended if missing. Empty / colliding / unsanitised names are rejected on both client and backend (`POST /api/models/{name}/rename`). The rename also updates `defaults.json` so a renamed default stays the default.
- Bundled weights are read-only (the install tree gets re-fetched by `scripts/fetch-models.py`), so the Rename button doesn't show on bundled cards — only Download.

### Fixed
- **`/api/models` no longer 500s when the `ml` extra is missing.** `registry._inspect()` had the `from ultralytics import YOLO` outside its `try` block, so a `ModuleNotFoundError` (typical after a `uv sync --extra dev --extra desktop` without `--extra ml`) bubbled up uncaught. The import is now inside the try and `ImportError` becomes a clean `ModelLoadError`; the scan loop drops the failing entry, `/api/models` returns an empty list with 200, and the frontend renders the friendly "No detection models — run scripts/fetch-models.py --task detect" message instead of a generic error page.

---

## [0.7.0] — 2026-05-17 · P4b: Train — Detection local run

**Tag:** `v0.7-p4b-train-detect-run`

### Added
- **Local training actually runs.** Press **Start training** on `/train/configure` and the backend spawns an Ultralytics subprocess against your dataset. Per-epoch metrics stream live to `/train/run` via WebSocket with two Recharts curves (box/cls/dfl loss + mAP50 / mAP50-95), a progress bar, and a scrolling log tail.
- **Class-name editor** on `/train/configure` — rename each class in place before training. Names are written into the dataset's `data.yaml` and embedded in the trained checkpoint so `/predict` shows them automatically. Empty / duplicate names are rejected on both client and backend (`PATCH /api/datasets/{id}/classes`).
- **Placeholder-name detection**: plain-YOLO datasets that come without a `data.yaml` get `class_0…class_N` placeholders that the editor highlights in amber, with a callout reminding you to rename them before training.
- **Cancel in-flight training** via a SIGTERM to the subprocess group (`start_new_session=True` on POSIX, `CREATE_NEW_PROCESS_GROUP` on Windows). The `/train/run` page shows a Cancel button while the run is queued/running.
- **Save-to-library** copies the run's `best.pt` into `<storage_root>/models/detect/trained-<short_id>.pt`, refreshes the registry, sets it as the new detection default, and surfaces an **Open in Predict** button so the doctor lands one click away from running their fresh model on slide patches.
- Backend subprocess wrapper (`engine/training.py` + `engine/train_runner.py`): job manager keeps an in-memory event log; a reader thread tails subprocess stdout; JSON-line events (`{_VRL_EVENT: true, type, …}`) are interleaved with raw log lines; the WebSocket handler replays every event on connect so a refresh lands a coherent snapshot.
- New routes: `POST /api/training/start` (returns 202 + `job_id`), `GET /api/training/{id}`, `WS /api/training/{id}/stream`, `POST /api/training/{id}/cancel`, `POST /api/training/{id}/save-to-library`.
- Hardware-aware: training inherits the configure-page accelerator probe (CUDA / MPS / CPU). Cross-version metric-key probes (`metrics/mAP50(B)` vs `metrics/mAP_0.5`) so the same UI works across Ultralytics 8.3 / 8.4.

### Fixed
- **Ultralytics auto-suffixed run names**: the job manager pre-creates `<output_dir>/<job_id>/` so we know where to find `best.pt`, but Ultralytics would write to `<job_id>-2/` because `exist_ok` defaulted to `False`. Now passing `exist_ok=True` to `model.train()` so the run lands exactly where the manager expects it.

### Known limitations (deferred)
- Some loss metrics (box / cls / dfl) come through as `null` on certain Ultralytics versions where they live under different keys than the validation mAPs. The chart connects across nulls; the failing keys are dropped silently rather than crashing the stream.
- Training jobs are kept in-memory only — restarting uvicorn (e.g. via `run-desktop --clean`) loses the job snapshot. The on-disk `<storage_root>/training/<job_id>/` run artefacts survive, so you can still grab `best.pt` manually.
- Classification training is still detection-only at the UI level; P5 ships the classify branch (`task=classify` ImageFolder + top-1/top-5 metrics).
- Colab tunnel handoff (PLAN.md §11) lands in P4c — when no accelerator is detected, the wizard currently still lets you start a CPU run instead of suggesting Colab.

---

## [0.6.1] — 2026-05-17 · P4a.fix-1: Train — Dataset upload fix + split helper

No tag — between-phase patch.

### Fixed
- **Roboflow YOLO datasets ship `data.yaml` + `train/images/` + `train/labels/`** and were being detected as "Unknown layout" in v0.6.0. The `FolderDropzone` we'd built for Predict was MIME-filtered to images, so `data.yaml` and all the `.txt` label files were dropped at the browser level before they ever reached the backend. `FolderDropzone` now takes a `mode: "images" | "any"` prop; the Train wizard passes `mode="any"` so the full dataset (yaml + labels + images) makes it through.

### Added
- **Prepare splits** tool — for plain-YOLO datasets (`images/` + `labels/` at root) and Roboflow exports that only ship a `train/` split, click "Prepare splits…" to reshuffle into a clean train / valid / test layout with sliders for the ratios + a random seed.
- Backend `POST /api/datasets/{id}/split`: collects every image+label pair across the existing layout (any of plain YOLO, train-only Roboflow, or fully-split Roboflow), shuffles by seed, redistributes, wipes the old tree, and rewrites `data.yaml`. Preserves the dataset's UUID so the wizard store doesn't lose track.
- Class names are preserved from existing `data.yaml` when present; for plain YOLO without a yaml, the splitter walks label files to find the max class id and emits `class_0..N` placeholders (rename them later in P4b).
- Yellow callout on `/train/dataset` when no validation split is detected — clicking **Prepare splits…** opens the modal. After a successful split, a smaller **Re-split** button stays available for tweaking ratios.
- Backend tolerates ratios summing to `1.0 ± 0.001` (frontend rounds via integer percentages → divide by 100, so the sum sometimes drifts by a hair).

---

## [0.6.0] — 2026-05-17 · P4a: Train — Detection wizard

**Tag:** `v0.6-p4a-train-detect-wizard`

### Added
- **Three-step training wizard**: `/train` (task picker) → `/train/dataset` (upload + inspect) → `/train/configure` (model + hyperparams). `/train/run` is a P4b preview placeholder.
- **Task picker** with Detection / Classification cards; Classification gated behind a "P5" badge.
- **Dataset upload + auto-inspect**: drop a folder, backend writes it to `<storage_root>/datasets/<uuid>/` and returns format / splits / classes / warnings. Supported formats: Roboflow YOLO (`data.yaml` + `train/images/+labels/`), plain YOLO (`images/`+`labels/`), COCO (`annotations.json`), Pascal VOC (`.xml`), ImageFolder (classify-only summary).
- **Real upload progress bar** via XHR with an in-flight Cancel button backed by `AbortController` — fetch still doesn't expose upload-progress events.
- **Path-traversal-safe upload writer** in `engine/dataset.py`: 4 GB total cap, hostile-path rejection, Windows-reserved character sanitisation per segment.
- **Hardware probe** at `GET /api/hardware?task=&imgsz=`: returns kind / name / vram_gb / suggested_batch_size, with a heuristic that scales by accelerator + VRAM + task (classify doubles the suggestion).
- **Configure page**: model picker (detect models), preset radio (Quick/Standard/Best/Custom), image-size chip selector, batch-size slider with a live hardware hint, summary card with steps/epoch + total steps.
- **Train state persisted to localStorage** (Zustand `vrl-yolo-gui.train.v1`) so a reload mid-wizard doesn't blow up the 200-image upload.
- **Dataset rehydrate** endpoint `GET /api/datasets/{id}` — the configure page re-fetches on mount; if the dataset is gone (e.g. storage was wiped), the user is bounced back to `/train/dataset`.

### Known limitations (deferred)
- Training itself doesn't run yet — `/train/run` is a preview. P4b ships the subprocess + live metric WebSocket + results page.
- Classification training is detected (ImageFolder summary) but the configure page is detection-only. P5 adds the classify branch.
- Plain YOLO datasets (no `data.yaml`) require you to fill in class names — currently a warning, no editor yet (P4b).
- Multipart upload is fast on a Pyloid window but awkward over slow networks. Native folder-picker bridge lands in P7.

---

## [0.5.1] — 2026-05-17 · P3b.fix-1: Predict — Downloads fix

No tag — between-phase patch.

### Fixed
- **Export buttons in `/predict` folder mode now actually deliver a file.** The v0.5.0 build had CSV / XLSX / PDF buttons silently dropping the download because QtWebEngine blocks downloads until something connects to the profile's `downloadRequested` signal. Pyloid's window doesn't ship a download manager, so the export request reached the backend, returned 200 with the right `Content-Disposition`, then the blob URL click went nowhere.
- Added `_install_download_handler()` in `src-pyloid/main.py`: auto-accepts every download, drops it in `~/Downloads/` with a unique-name suffix (e.g. `vrl-yolo-detect-...csv` → `vrl-yolo-detect-... (1).csv` if a file with the same name already exists), and logs the destination via the `step:` prefix so the user can see where the file went in `launch.log`.

---

## [0.5.0] — 2026-05-17 · P3b: Predict — Reports, Import & Settings

**Tag:** `v0.5-p3b-predict-reports`

### Added
- **Settings page** (new `/settings` route, sidebar entry under "Preferences") with localStorage-backed preferences via the `useSettings()` hook. First toggle: show / hide clinical workflow presets in `/predict`.
- **Workflow presets hidden by default** — the bundled COCO/ImageNet weights don't have clinical class names yet, so the presets prefilled sensible thresholds but produced misleading detections. Tracked to re-open in P10 once we ship fine-tuned demo weights (memory: `project_presets_revisit`).
- **Folder-batch image preview** — click any row in the per-image table to see that file's image with detection boxes or the classify top-5 chart in a preview pane above the aggregate. Auto-selects the first successful result so the preview is never empty after a run.
- **Report generators** (`server/vrl_yolo/engine/reports.py`): task-aware CSV (per-image table), XLSX (per-image + aggregate sheets), and PDF (cover + summary + thumbnail grid + per-image table). ReportLab + OpenPyXL — no new dependencies.
- **`/api/reports/{csv,xlsx,pdf}`** endpoints accept the batch results as JSON and stream the rendered file with the right `Content-Disposition` so the browser downloads directly.
- **Export toolbar** (CSV / XLSX / PDF buttons) in the batch table card. The PDF button resizes up to 12 representative images to 480 px JPEG client-side and base64-embeds them so the report has a thumbnail grid.
- **User model import** — `POST /api/models/import` accepts a `.pt` checkpoint, reads `model.task` + class names via Ultralytics, places it in `<storage_root>/models/<task>/`, refreshes the registry. Frontend Import button on `/models` triggers the upload and invalidates the `['models']` query so the new card appears.
- **Topbar pill** now reads `v0.5.0 · predict — reports, import & settings` via the shared `useLiveVersion()` hook.

### Known limitations (deferred)
- Sliders still re-run on click only — live update deferred to a future polish pass.
- PDF thumbnail grid caps at 12 samples per report. Curated selection arrives with per-image flag annotations.
- No streaming batch WS endpoint yet — client-side iteration continues. Will land when Train (P4) needs WS plumbing.

---

## [0.4.0] — 2026-05-17 · P3a: Predict — Batch & Workflow Presets

**Tag:** `v0.4-p3a-predict-batch`

### Added
- **Folder mode** in `/predict` — drop a folder of slide patches; the UI runs inference image-by-image with a live progress bar.
- **Per-image results table** — filename, top class / box count, conf or count, inference time. Task-aware: detection rows show boxes + top class, classification rows show top-1 + a "review" pill when below threshold.
- **Aggregate panel** — detection rolls up per-class totals + max conf across the batch; classification rolls up the class distribution + flagged-count (top-1 below the review threshold).
- **Recursive** checkbox controls whether the dropzone walks subfolders or sticks to the top level.
- **Cancel** button (`StopCircle`) aborts the in-flight batch — backed by `AbortController` plumbed through `runBatch()` in `apps/web/lib/batch.ts`.
- **Workflow presets** sidebar in `/predict`: 9 clinical workflows (histopathology mitosis / nuclei / tumour-subtype / Gleason; hematology WBC-diff / bone-marrow / malaria / smear-pathology / marrow-pattern). Picking one prefills model + conf + iou.
- `/api/presets` endpoint exposes the catalog from `server/vrl_yolo/engine/presets.py` (typed `Preset` dataclasses).

### Fixed
- Topbar version pill was stuck at "v0.1.0 · scaffolding" since P0; now reflects the running build via a shared `useLiveVersion()` hook (TanStack Query, deduped with the changelog page).

### Known limitations (deferred)
- Sliders still re-run on click only — live updates land in P3b polish.
- User `.pt` import via the UI still returns 501 (lands in P3b).
- CSV / XLSX / PDF reports not yet implemented — P3b ships the task-aware report templates.
- Batch runs are sequential (concurrency = 1) on purpose; multi-GPU parallelism is a P10 problem.

---

## [0.3.0] — 2026-05-17 · P2: Predict — Classification

**Tag:** `v0.3-p2-predict-classify`

### Added
- Single-image classification via Ultralytics' classify head — top-1 + top-5 returned for the full softmax distribution.
- `/predict` view task-switches based on the selected model: no SVG overlay, top-1 banner, top-5 bar chart (Recharts).
- Confidence slider repurposes as a **review threshold** — top-1 predictions below the threshold render a "needs review" badge.
- Four bundled classification weights: `yolo26n-cls.pt`, `yolo26s-cls.pt`, `yolov8n-cls.pt`, `yolov8s-cls.pt` (~37 MB).
- `/api/inference/single` now returns a discriminated union (`detect | classify`); FastAPI documents both shapes in OpenAPI.
- In-app `/changelog` page lists per-build features, fixes, and known limitations. Sidebar link with current-version badge.
- `pyproject.toml` is the single source of truth for version; `vrl_yolo.__version__` reads it via `importlib.metadata`.

### Known limitations (deferred)
- Sliders still re-run on click — live updates planned for P3.
- User `.pt` import via the UI still returns 501 (lands in P3).
- Folder batch + CSV / XLSX / PDF reports not yet implemented (P3).

---

## [0.2.1] — 2026-05-17 · P1.fix-1: Cold-start race fix

**Commit:** `427093d` (no tag — between-phase fix)

### Fixed
- Pyloid window no longer races uvicorn's lifespan startup — `window.load_url` waits for `uvicorn.Server.started`; backend ready in ~55 ms instead of ~12 s.
- Registry scan + torch import deferred out of FastAPI lifespan; first `/api/models` call does a lazy scan (~1.7 s) and caches.

---

## [0.2.0] — 2026-05-17 · P1: Predict — Detection

**Tag:** `v0.2-p1-predict-detect`

### Added
- Single-image detection via Ultralytics YOLO — boxes (xyxy + xywhn), per-class counts, accelerator + inference timing in the response.
- Apple Silicon MPS auto-detected; first inference cold-loads ~3.6 s, subsequent calls ~50–100 ms.
- `/predict` view: drop zone, model picker, confidence + IoU sliders, SVG box overlay with stable per-class colours, counts table.
- `/models` page lists bundled + user models grouped by task with a "Set as default" mutation that persists to disk.
- Four bundled detection weights: `yolo26n.pt`, `yolo26s.pt`, `yolov8n.pt`, `yolov8s.pt` (~53 MB).
- Model registry persists per-task defaults to `<storage_root>/models/defaults.json`.
- Python pinned to 3.11 via `.python-version`; dev + CI converge.

---

## [0.1.0] — 2026-05-17 · P0: Scaffolding

**Tag:** `v0.1-p0-scaffolding`

### Added
- Pyloid desktop window opens, embedded uvicorn serves `/api/health` (200).
- Repo layout finalised: `server/vrl_yolo/` (flat module), `apps/web/` (Next.js 15 + Tailwind v4), `src-pyloid/`, `scripts/`, `packaging/`, `models/`.
- Six router stubs return `501` with the phase they land in — discoverable from `/openapi.json`.
- AGPL-3.0 `LICENSE` + `COMMERCIAL-LICENSE.md` template + `NOTICE` for upstream component licenses.
- GitHub Actions release workflow: `macos-14` (arm64) + `windows-latest` (x64) matrix.
- macOS-specific packaging recipe in `scripts/build-release.py`: devtool-bundle strip, Team-ID inside-out resign, `Info.plist` version stamp, `.dmg` wrap, `aboutToQuit → os._exit` shutdown workaround.

---

[0.6.1]: https://github.com/atultiwari/VRL-YOLO-GUI/commits/main
[0.6.0]: https://github.com/atultiwari/VRL-YOLO-GUI/releases/tag/v0.6-p4a-train-detect-wizard
[0.5.1]: https://github.com/atultiwari/VRL-YOLO-GUI/commits/main
[0.5.0]: https://github.com/atultiwari/VRL-YOLO-GUI/releases/tag/v0.5-p3b-predict-reports
[0.4.0]: https://github.com/atultiwari/VRL-YOLO-GUI/releases/tag/v0.4-p3a-predict-batch
[0.3.0]: https://github.com/atultiwari/VRL-YOLO-GUI/releases/tag/v0.3-p2-predict-classify
[0.2.1]: https://github.com/atultiwari/VRL-YOLO-GUI/commit/427093d
[0.2.0]: https://github.com/atultiwari/VRL-YOLO-GUI/releases/tag/v0.2-p1-predict-detect
[0.1.0]: https://github.com/atultiwari/VRL-YOLO-GUI/releases/tag/v0.1-p0-scaffolding
