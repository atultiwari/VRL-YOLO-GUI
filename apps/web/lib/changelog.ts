/**
 * In-app changelog source of truth.
 *
 * Each entry maps a shipped version to a phase, git tag, commit short SHA,
 * and the features / fixes that became functional in that build. The
 * /changelog page renders these; CHANGELOG.md at the repo root mirrors
 * the same data for GitHub viewers.
 *
 * Update protocol (on every phase commit):
 *   1. Bump `pyproject.toml` `version` so `/api/health` reports the new value.
 *   2. Add a new entry at the TOP of `RELEASES` with status: "current".
 *   3. Flip the previously-current entry to status: "shipped".
 *   4. Mirror the entry into CHANGELOG.md.
 *   5. Tag the commit (e.g. v0.3-p2-predict-classify) and push.
 */

export type ReleaseStatus = "current" | "shipped";

export interface ReleaseEntry {
  /** Semver string that matches pyproject.toml at this commit. */
  version: string;
  /** PLAN.md phase identifier — "P0", "P1", "P1.fix-1", "P2", … */
  phase: string;
  /** Short human title for the phase. */
  title: string;
  /** Annotated git tag, or null for between-phase fix commits. */
  tag: string | null;
  /** Short commit SHA (7 chars) the entry was cut from. */
  commit: string;
  /** ISO date — usually the day of the commit. */
  date: string;
  /** Latest shipped release flips to "current" until the next entry lands. */
  status: ReleaseStatus;
  /** What's functional in the binary as of this version. */
  features: string[];
  /** Bugs squashed in this version. */
  fixes: string[];
  /** Carried-forward gaps that the next phase will close. */
  knownLimitations?: string[];
}

export const RELEASES: ReleaseEntry[] = [
  {
    version: "0.13.0",
    phase: "F5",
    title: "Auto-save trained models + macOS first-launch helper in .dmg",
    tag: "v0.13-f5-autosave",
    commit: "PENDING",
    date: "2026-05-21",
    status: "current",
    features: [
      "**Auto-save trained models to the library** (Settings toggle, default ON). New row in the Train section of /settings. When ON, the moment a training run hits status === 'completed' AND bestPt is populated AND the run hasn't already been saved, the desktop kicks off the existing save-to-library flow automatically. Green toast appears: 'Auto-saved as \"<filename>\". Open Models to use it for prediction.' useRef-guarded so a re-render or WS replay can't double-fire.",
      "**Auto-save also fires on /train/history/view** when the user opens a completed run that finished while they were elsewhere. Same useRef guard; if the row already has library_path populated, the effect no-ops.",
      "**Manual Save to library button stays available** on both /train/run and /train/history/view regardless of the auto-save setting — covers users who flipped it OFF, users whose auto-save failed, and experimental sweeps where each checkpoint needs review.",
      "**macOS install assets bundled in the .dmg** (closes the unsigned-app first-launch Gatekeeper friction one of our test installs hit on v0.12.0). Two new files sit next to the .app icon when the DMG is mounted: install.command (double-click in Finder to clear `com.apple.quarantine`; handles 'app not in /Applications' + 'no write permission' edge cases) and README-MACOS-FIRST-RUN.txt (two-step quick-start + full Gatekeeper explainer + 3 manual alternatives + troubleshooting). Source files at assets/install/macos/; scripts/build-release.py::maybe_macos_dmg stages them alongside the .app and passes to create-dmg.",
    ],
    fixes: [],
    knownLimitations: [
      "Auto-save only fires on the two pages that watch for completion (/train/run and /train/history/view). A clinician who closes both pages mid-training and comes back later will see the run as 'completed' in /train/history; auto-save fires the moment they open the detail page. There's no background job for fully-headless auto-save.",
      "Auto-save deliberately doesn't auto-set-as-default. To keep manual + auto save behaviour consistent, manual save ALSO drops its setDefaultModel call — saving to library and marking as default are now two distinct actions. Users who relied on the implicit coupling need one extra click on /models.",
      "install.command hard-codes /Applications as the install target. Users who put the .app elsewhere need to run `xattr -dr com.apple.quarantine` manually on their chosen path (documented in the README).",
      "install.command needs Terminal access. Locked-down environments where Terminal is disabled need to use the right-click→Open path documented in the README.",
      "The DMG layout is the basic Finder window — no custom background polish. Functional today; future packaging polish if needed.",
    ],
  },
  {
    version: "0.12.0",
    phase: "F3",
    title: "Persistent training history — SQLite + /train/history + edit-lock removed",
    tag: "v0.12-f3-history",
    commit: "9ca25b5",
    date: "2026-05-21",
    status: "shipped",
    features: [
      "**Persistent training-run history.** Every run (local + Colab) writes to SQLite at `<storage_root>/training.db` from the moment training starts. The `training_runs` table carries the full lifecycle context — name + description (F2), task, dataset_id + snapshot, base_model, hyperparams, accelerator, started_at, finished_at, status, epoch_current, error_message, best_pt_path, library_path, final_metrics — and updates on every terminal event + after save_to_library succeeds. Schema is hand-rolled (`schema_version` int + ordered migrations); F3 ships v1. Fresh installs migrate v0→v1 transparently.",
      "**`/train/history` page** — sortable + filterable table of every run ever. Filter chips: Task / Status / Dataset. Sort: Most recent / Name (A→Z) / Duration. Empty state suggests starting a run. Rows whose dataset folder has been deleted show greyed + line-through with a tooltip; Re-run disabled. Manual 'Clean up runs older than 30 days' button.",
      "**`/train/history/view?id=<job_id>` detail page** — replays the run's complete event stream from `events.jsonl(.gz)` into the same recharts components `/train/run` uses. Header shows name + description with inline edits (the F2 edit-lock is gone!), Started / Finished / Elapsed timestamps, status badge, hyperparams + final metrics cards, error message if the run failed. Re-run / Save to library / Delete actions.",
      "**6 new history routes**: `GET /history` (paginated + filtered list), `GET /history/{id}` (detail row), `GET /history/{id}/events` (NDJSON stream for chart replay), `DELETE /history/{id}?delete_checkpoint=…` (row + optional checkpoint), `POST /history/{id}/rerun` (StartTrainingBody prefill payload), `POST /history/purge?older_than_days=N` (bulk cleanup). Declared *before* the `/{job_id}` routes so the `/history` literals beat the path-parameter match.",
      "**F2's PATCH edit-lock is removed.** `PATCH /api/training/{id}` now accepts edits on completed/failed/cancelled runs by routing through `HistoryDb.update_metadata` (was: 409 Conflict). Live runs still update in-memory state; the same edit mirrors to history. `/train/run`'s 'Editing locked after the run finishes' hint is gone — the pencils stay live the whole time.",
      "**Per-run `events.jsonl(.gz)` sidecar.** New `engine/event_log.py` writes line-buffered JSONL during the run, gzips in a daemon thread the moment status hits terminal (5–10× disk savings on a 200-epoch run). Reader auto-picks `.gz` over `.jsonl`. All disk errors caught + logged so a glitch can't take down training.",
      "**F3 §9 auto-purge setting.** New `auto_purge_old_runs: boolean` toggle in a new **Train** section of `/settings` (default **OFF**). When ON, `/train/history` calls purge on mount and shows a small toast. Library checkpoints stay in `/models` — only history rows + replay events are removed. F5 (coming in v0.13) adds its auto-save toggle to this same Train section.",
      "**Sidebar entry: 'Training history'** under the Train section. Re-run from any row prefills the wizard at `/train/configure?from=<history_id>`; the configure page fetches the rerun payload + dataset and applies them to the train store.",
      "**32 new backend tests** in `tests/test_history.py` covering migrations, HistoryDb writer/reader semantics, EventLog round-trips (compressed + uncompressed), JobManager integration, all 6 new routes end-to-end. 89 total backend tests across the project, all green.",
    ],
    fixes: [],
    knownLimitations: [
      "History DB grows unbounded by default. Auto-purge is OFF by default and capped at 30 days when ON. Pilot users who don't enable it accumulate rows + sidecars indefinitely (typical compressed run ~500 KB).",
      "Re-run from a Colab row prefills the local-training wizard (per PLAN-F3 decision 6). The user opens the Colab modal again from /train/configure if they want a fresh Colab session.",
      "No bulk-select / bulk-delete in the history table — Delete is one row at a time.",
      "The detail page doesn't show free-form stdout log lines — only the structured event chart-replay. Future work.",
      "The two _record_to_info() helpers in routers/models.py + routers/training.py are still duplicated, carrying forward from F2.",
    ],
  },
  {
    version: "0.11.0",
    phase: "F2",
    title: "Training-run name + description + app-wide timezone setting",
    tag: "v0.11-f2-run-naming",
    commit: "fd429fc",
    date: "2026-05-21",
    status: "shipped",
    features: [
      "**Optional Name + Description on every training run.** New 'Name this run' card on `/train/configure` sits above the Model & preset card. Name is a single-line input (max 200 chars) with a **live placeholder** showing the auto-generated default — `<Task> · <dataset-stub> · YYYY-MM-DD HH:MM` in the user's preferred TZ — that rebuilds when task or dataset change (and ticks forward every 60 s so the timestamp stays current). Description is a multi-line textarea (max 2000 chars). Both flow through to `POST /api/training/start` and `POST /api/training/colab/connect`; backend `JobManager.start()` + `start_colab_job()` accept `name` + `description` kwargs and fall back to `_default_run_name()` when empty.",
      "**Inline name + description editing on `/train/run`** while the run is in flight. Run name replaces statusLabel as the page's h1. Pencil icon next to the name → inline input → Enter or Save commits via `PATCH /api/training/{id}`. Description shows below the name as italic text; a separate pencil opens a popover modal with a textarea. Both edit affordances disappear once `status` is terminal, replaced with a grey hint pointing at F3 for completed-run history edits.",
      "**Started / Finished / Elapsed timestamps on `/train/run`.** All three render through the new `formatDate()` + `formatElapsed()` helpers in `apps/web/lib/format-date.ts` so they respect the user's TZ setting.",
      "**New `PATCH /api/training/{job_id}`** route + `UpdateTrainingMetadataRequest` schema + `JobManager.update_metadata()` method. Gated to `status in {queued, running}` — completed/failed/cancelled jobs return **409 Conflict** (the request is well-formed; the resource state forbids the edit). Empty string for `name` resets to the auto-default; empty string for `description` clears it; `None` for either field means 'don't touch'.",
      "**Filename derivation from the run name on save-to-library.** `JobManager.save_to_library()` now slugifies `job.name` and saves as `<slug>.pt` instead of the old `trained-<stub>.pt`. Falls back to the legacy shape when the slug comes out empty. Disambiguates name collisions with `-<job_id[:8]>` so no two saves overwrite each other. A clinician saving 20 trained classify runs now sees meaningful names in `/models` instead of `trained-9b3a1c4e.pt` × 20.",
      "**Unicode-safe naming via `python-slugify>=8.0`** (new base dep). Slugify runs with `allow_unicode=True` and `lowercase=False` so a run named `\"फेफड़े वर्गीकरण\"` becomes a filename with the Devanagari preserved (not transliterated to `phephre-vargikaran`). Case is preserved too so `\"Lung Classify Run\"` → `Lung-Classify-Run.pt`.",
      "**App-wide timezone setting (wide scope, F2 §9).** New 'Timezone' section in `/settings` with a system-default radio (auto-detected zone shown beneath) + a custom-zone radio with a searchable IANA combobox populated from `Intl.supportedValuesOf('timeZone')` (~420 zones). Live preview shows the current time in the selected zone. Every timestamp render in the UI — configure placeholder, `/train/run` Started/Finished, future surfaces — routes through `apps/web/lib/format-date.ts` and reads this setting. `usePreferredTimezone()` hook subscribes components to changes so the UI repaints without a page refresh.",
      "**22 new backend tests** in `tests/test_training_naming.py` covering helpers, dataclass snapshot, manager update_metadata semantics, PATCH route mapping, save-to-library slug derivation (Unicode + empty fallback + collision disambiguation), and both training-start + colab-connect routes accepting the new fields. Synthetic JobManager fixtures — no subprocesses, no real ultralytics. All 58 backend tests green.",
    ],
    fixes: [
      "**`POST /api/training/{id}/save-to-library` 500'd with a pydantic `ValidationError: path Field required`** since v0.10.0 / F1. The training router has its own `_record_to_info()` helper that wasn't updated when F1 added the new `path` field to `ModelInfo`. The existing `test_save_to_library_downloads_best_pt` in the Colab smoke tests wrapped the save call in a broad `except Exception: pass`, silently swallowing this validation error — that's why CI never caught it. Fixed with a one-line `path=str(record.path)` addition + an in-line comment about the duplication, plus a new regression test `test_save_to_library_route_returns_valid_model_info` that hits the route end-to-end and asserts the response is a validatable ModelInfo. Caught by the user during F2 manual verification.",
    ],
    knownLimitations: [
      "Editing name / description on a completed run is intentionally blocked (PATCH returns 409). Re-enables when F3's persistent training-history layer lands — the edit needs somewhere durable to live, not in-memory `JobManager` state that disappears at app quit.",
      "No keyboard shortcut to open the description popover — click-only for now. Add `e` as a hint when F3's history page introduces multiple per-row edit affordances.",
      "Timezone setting doesn't trigger a `formatRelative()` rebuild on the second. Relative labels ('3 min ago') update lazily on the next render. Acceptable for v1; revisit if pilot users notice stale 'ago' labels.",
      "The two `_record_to_info()` helpers in `routers/models.py` and `routers/training.py` are still duplicated, with a warning comment in both. Tolerable for now (8-line helper, low change rate), but worth de-duplicating into a shared helper module the next time `ModelInfo` gains another field.",
    ],
  },
  {
    version: "0.10.0",
    phase: "F1",
    title: "Models library: delete + reveal on disk + path on every card",
    tag: "v0.10-f1-models-polish",
    commit: "788dee3",
    date: "2026-05-21",
    status: "shipped",
    features: [
      "**Delete user-imported or locally-trained checkpoints from the library.** `DELETE /api/models/{name}` route + `ModelRegistry.delete(name)`. Hard-delete (macOS Finder Trash is the system safety net; `models/` lives under `~/Library/Application Support/`). Bundled weights are rejected with **HTTP 403** ('read-only — they live in the install tree and `scripts/fetch-models.py` would re-fetch them anyway') rather than 400, so the frontend can distinguish policy-rejected from malformed. Deleting a model that's the per-task default drops its entry from `defaults.json` and `get_defaults()` falls back to any remaining model of the right task on the next read.",
      "**Reveal a checkpoint in the OS file manager.** `POST /api/models/{name}/reveal`. Lives on the backend because the QtWebEngine renderer is sandboxed — it can't spawn `open` / `explorer` / `xdg-open`. Per-OS dispatch: macOS `open -R '<path>'` (selects in Finder), Windows `explorer /select,<path>` (selects in Explorer — no space after the comma), Linux `xdg-open <parent_dir>` (containing folder, since xdg-open has no /select equivalent). `subprocess.run(check=False)` so a non-zero file-manager exit doesn't fail the request.",
      "**`path` field on every `ModelInfo` response.** Absolute on-disk path surfaced via the API for the first time. Bundled, user-imported, and trained-locally checkpoints all carry it.",
      "**Path row + Reveal + Delete buttons on every model card.** 'On disk · `<abs path>`' rendered in monospace, truncated with `title` for hover. Reveal button on every card (bundled too — consistent affordance). Delete button on user/trained cards; bundled cards show the button disabled with a tooltip 'Bundled models are read-only'. Delete click opens a confirmation modal that quotes the file name + full path; on success invalidates the `['models']` query so the card disappears without a page reload.",
      "**Eight new backend tests in `tests/test_models_api.py`** (first dedicated model-API test file): user delete removes file + record; bundled delete → 403 + file untouched; missing name → 404; deleting the current default clears it from defaults.json; deleting tolerates the file already being missing; path field present on list + single responses; reveal dispatches the right command per-OS; reveal returns 404/410 without ever calling subprocess on the failure paths. Synthetic `_inspect` so the suite runs in <1 s without the `ml` extra.",
    ],
    fixes: [],
    knownLimitations: [
      "Delete is unguarded against in-flight inference / training jobs. If you delete a model mid-inference, the YOLO instance the request captured stays alive but its path is now a dead pointer; the inference completes, the next request fails to load (file missing), the user sees a clear error. Tracked as an F1 carry-forward.",
      "Soft-delete / Trash / Undo is not implemented — hard-delete only. macOS Finder Trash is the safety net; revisit if pilot users repeatedly ask 'I deleted the wrong one, can I recover it?'",
      "No 'warn if a saved prediction report references this model' guard in the delete confirmation (the FUTURE-FEATURES.md acceptance criterion). That guard requires the persistent training-history layer from F3 to be meaningful. Plain confirmation modal for now; cross-reference lands in F3.",
    ],
  },
  {
    version: "0.9.1",
    phase: "P6.fix-1",
    title: "Run on Colab callout now visible on all hardware (was MPS/CUDA-hidden)",
    tag: "v0.9.1",
    commit: "b2dbe46",
    date: "2026-05-20",
    status: "shipped",
    features: [],
    fixes: [
      "**Run on Colab callout is now visible on every hardware kind, not just CPU.** The callout was gated by `hardware?.kind === \"cpu\"` since P6b, which meant clinicians on MacBooks (MPS) or Linux/Windows machines with NVIDIA GPUs (CUDA) couldn't see the *Run on Colab* button at all — the entire Colab feature was unreachable from the UI on those machines. Caught by the user testing on an MPS MacBook. The callout now adapts its copy to the detected hardware: **CPU** keeps the loud warning (\"This machine has no GPU — local training will be slow\"), **MPS** softens to \"Want a faster GPU? Train on a free Colab T4 instead — often faster than Apple Silicon MPS for YOLO training\", **CUDA** quietest (\"Train on a free Google Colab GPU instead. Useful if you'd rather not pin this machine's GPU during training\"). One callout component, three copy variants picked from a switch on `hardware.kind`.",
    ],
    knownLimitations: [],
  },
  {
    version: "0.9.0",
    phase: "P6",
    title: "Train on Colab — resilience polish, reconnect-with-backoff, retry on best.pt fetch, pilot test plan",
    tag: "v0.9-p6-train-colab",
    commit: "46c4092",
    date: "2026-05-20",
    status: "shipped",
    features: [
      "**Reconnect-with-backoff on tunnel drops.** `engine/colab_reader.py` now wraps the WebSocket read loop in an outer retry loop. Each attempt does a quick `GET /status?token=…` pre-flight (3 s timeout) so the reader can distinguish three failure modes instead of treating every drop the same: **auth** (HTTP 401 — notebook cell restarted with a new token, abandon immediately with a clear message), **network** (any other HTTP error / URLError — sleep + retry with exponential backoff: 2/4/8/16/32/60 s, capped at 20 attempts ≈ 18 min total), **ok** (proceed to open the WS). Free Colab GCs the runtime every few minutes; this rides through those blips without manual reconnect.",
      "**`connection` events surface reconnect state to the UI.** The reader emits synthetic `{type: 'connection', status: 'reconnecting' | 'reconnected' | 'abandoned', attempt, delay_s, message}` events into `job.events`, which the existing WS fan-out forwards to the browser. `/train/run` renders a `ColabConnectionBanner` with task-specific copy and palette (amber while reconnecting + spinner showing attempt count and back-off delay, green when reconnected — banner clears itself, red when abandoned). Frontend `TrainingEvent` union extended.",
      "**Cancel mid-backoff is clean.** `TrainingJob` gains a `_reader_stop_event: threading.Event` for Colab jobs; `JobManager.cancel()` sets it (alongside the existing POST /cancel best-effort), and the reader checks it in every backoff sleep + read loop. Result: clicking Cancel on a job whose tunnel is already dead doesn't leave the reader spinning for 18 minutes — it exits in <1 s with `cancelled` status.",
      "**Retry-on-failure for `fetch_best_pt`.** `engine/colab.py::fetch_best_pt` now tries up to 3 times with 2/4/8 s exponential backoff on transient network failures. Fail-fast on HTTP 401 (token changed — retry won't help) and 409 (training isn't complete — retry won't help until it is). Internal `_stream_best_pt_once` tags exceptions with a `retryable` attribute so the retry loop knows when to bail vs back off. Save-to-library now survives a Cloudflare blip mid-download instead of making the clinician re-click.",
      "**`docs/PILOT-TEST.md`** — the 9-step end-to-end plan from PLAN-P6.md §7 expanded into an executable checklist with per-step pass criteria, expected outputs, and a troubleshooting table covering every error message the user might see (stale URL, token rejected, tunnel unreachable, payload mismatch). Includes the deliberate-disconnect step for verifying the reconnect banner end-to-end against a real Colab cell.",
      "**Six new smoke tests cover the P6c contract** (`tests/test_colab_integration_smoke.py`): tunnel-drop emits a `reconnecting` connection event; cancel during backoff flips status to `cancelled` within seconds; `_preflight` returns `auth` for HTTP 401 + `network` for unreachable hosts (this is the direct contract test for the reconnect-loop's classification); `fetch_best_pt` retries on transient errors + fails fast on non-retryable HTTP codes. Full suite: 23/23 passing.",
    ],
    fixes: [
      "Before P6c, a single transient WebSocket close (Cloudflare propagation hiccup, Colab runtime GC) would synthesise an `error` event and mark the job failed — even though training was still running on the Colab side. Now the reader announces a reconnect attempt and recovers transparently when the tunnel comes back.",
      "Before P6c, cancelling a Colab job whose tunnel was already dead would POST /cancel to nowhere (no-op) and leave the reader thread alive. The desktop UI showed the job as still running until the WS naturally timed out. Now `cancel()` signals the stop event so the reader exits within the current backoff window.",
    ],
    knownLimitations: [
      "No automatic re-paste-URL UI on the run page. When the reader abandons due to a token change, the user has to navigate back to /train/configure, click Run on Colab again, and paste the new URL. A dedicated Reconnect modal on /train/run that takes a new URL is post-pilot polish.",
      "best.pt download doesn't use HTTP Range — retry restarts from byte 0. For 5-80 MB checkpoints on Cloudflare quick-tunnels this is acceptable; revisit if pilot users report large checkpoints failing repeatedly.",
      "The pilot test plan in docs/PILOT-TEST.md hasn't been executed yet — that's a clinician + dataset task, not a Claude task. Pilot verification is the gate on declaring v1.0.",
    ],
  },
  {
    version: "0.8.9",
    phase: "P6b",
    title: "Train on Colab — desktop Run on Colab callout + Connect modal + Colab-backed jobs",
    tag: "v0.8.9-p6b-colab-desktop",
    commit: "6ca2f73",
    date: "2026-05-20",
    status: "shipped",
    features: [
      "**Run on Colab callout on /train/configure** — when the accelerator probe returns `cpu`, a yellow card now sits between the hyperparameter section and the Start training button: *\"This machine has no GPU — local training will be slow. Train on a free Google Colab GPU instead.\"* with a Run on Colab button. Clinicians on CPU-only Macs / Windows boxes no longer stumble into accidental overnight CPU runs.",
      "**Connect to Colab modal** — task-aware (detect vs classify), shows the GitHub-anchored Colab notebook URL with Copy + Open buttons (Open opens the URL in the system browser via window.open, which Pyloid routes through QWebEngine's external-URL handler), takes the `trycloudflare.com?token=…` URL from the cell, and calls the backend's pre-flight to validate. Errors surface in-modal in plain English (stale URL, wrong token, unreachable host, wrong payload shape) instead of as raw HTTP failures.",
      "**`engine/colab.py`** — desktop-side bridge to the Colab worker. `ColabSession` carries the parsed base URL + token + the GET /status response so callers can seed a TrainingJob in one round trip; `connect(tunnel_url)` does a 3 s `GET /status?token=…` pre-flight and raises `ColabConnectError` with clinician-readable text on every failure mode; `request_cancel(session)` POSTs /cancel; `fetch_best_pt(session, dest)` streams /best.pt to disk with `shutil.copyfileobj`. Stdlib-only (urllib) — no new HTTP client dependency.",
      "**`engine/colab_reader.py`** — daemon-thread WebSocket reader that translates remote `_VRL_EVENT` payloads into `job.append_event` calls, the exact same code path the local subprocess reader uses. Uses `websockets.sync.client.connect` so no asyncio thread juggling. Synthesises an `error` event if the Colab cell stops before a terminal event arrives, so the desktop UI flips out of live-charts state cleanly instead of spinning forever.",
      "**`JobManager.start_colab_job(tunnel_url)`** — parallel entry point alongside the existing `start(...)`. Returns a `TrainingJob` shaped identically to a local run (with `accelerator_kind='colab'` and `_colab_session` set instead of `_process`), so `/train/run` and the existing `/api/training/{id}/stream` WebSocket fan-out consume Colab events with zero changes. `cancel()` branches on `_colab_session`: POST /cancel to the tunnel for Colab jobs, SIGTERM the subprocess group for local. `save_to_library()` lazy-downloads best.pt through the tunnel for Colab jobs before the existing copy-to-models logic runs.",
      "**`POST /api/training/colab/connect`** — accepts `{ tunnel_url }`, calls `manager.start_colab_job`, returns `{ job_id }`. Maps `ColabConnectError` to a clean HTTP 400 with the original clinician-readable detail message, so the frontend can render it without translation.",
      "**`connectColab()` API helper** — `apps/web/lib/api.ts`. Signature matches `startTraining()` so the configure page's success handler (set active job + push to /train/run) works for both local and Colab jobs interchangeably.",
      "**P6b integration smoke test suite** — `tests/test_colab_integration_smoke.py` (9 passing tests) stands up a real ColabServer on localhost, treats it as a tunnel, and exercises `engine.colab.connect` (success + missing-token + bad-scheme + unreachable-host), `JobManager.start_colab_job` (seed shape + reader-thread event propagation + terminal-event status flip), `JobManager.cancel` (POSTs through to the tunnel), and `JobManager.save_to_library` (downloads best.pt + lands in models/<task>/).",
    ],
    fixes: [
      "Colab-side `JobState` and `/status` response gained `imgsz` + `batch` so the desktop's connect pre-flight has the full training config in one round trip; previously the desktop would have needed to wait for the replayed `start` event over WS to populate those fields.",
    ],
    knownLimitations: [
      "No reconnect-with-backoff on WebSocket drops. The current reader thread surfaces an `error` event if the tunnel goes down, but the desktop doesn't yet attempt to reconnect when the Colab cell is restarted. Ships in P6c.",
      "best.pt download isn't resumable. If the tunnel drops mid-download, the user re-clicks *Save to library*. Tracked for P6c polish.",
      "End-to-end pilot test against real Colab + a clinical dataset (the 9-step plan in docs/PLAN-P6.md §7) hasn't run yet — that's P6c.",
    ],
  },
  {
    version: "0.8.8",
    phase: "P6a",
    title: "Train on Colab — companion notebooks + Colab runtime (no desktop integration yet)",
    tag: "v0.8.8-p6a-colab-notebook",
    commit: "8e3f08d",
    date: "2026-05-20",
    status: "shipped",
    features: [
      "**Two companion Colab notebooks** — `notebooks/01_train_detect_colab.ipynb` (detection) and `notebooks/02_train_classify_colab.ipynb` (classification). Five-cell thin orchestrators: mount Drive → clone the repo → edit a config dict → start the local server + Cloudflare quick-tunnel → run training. The notebook URLs are GitHub-anchored so any fix lands the next time the clinician opens Colab.",
      "**Colab-side runtime modules** under `notebooks/_runtime/`: `colab_tunnel.py` (downloads cloudflared on first use, parses the `trycloudflare.com` URL from stdout, returns a live `TunnelHandle`), `colab_server.py` (FastAPI mini-server exposing `GET /status`, `WS /events`, `GET /best.pt`, `POST /cancel` — all token-authenticated per docs/PLAN-P6.md §4.6), `colab_runner.py` (Ultralytics training driver that publishes events through the server's fan-out queue and honours cancellation requests between epochs).",
      "**Shared wire-protocol module** — extracted the metric-key dictionaries, `_emit`, `safe_metric`, and `extract_metrics` into `server/vrl_yolo/engine/_runner_common.py`. Both `train_runner.py` (local subprocess) and `colab_runner.py` (Colab in-process) import from it, so when Ultralytics renames a metric key in a minor version the fix lands once instead of drifting silently between runners.",
      "**Clinician-facing guide** — `docs/COLAB-GUIDE.md` walks through Drive layout for both tasks, where to find the Colab notebook URL, GPU runtime setup, config-cell editing, what to expect from the cell output, and how to paste the URL into the desktop modal that's coming in P6b. Includes a troubleshooting section for the common failure modes (stale tunnel URL, Drive auth re-prompt, missing GPU).",
      "**End-to-end smoke test suite** — `tests/test_colab_server_smoke.py` spins up a real uvicorn instance and verifies token enforcement on every route, the `/status` JSON shape, the `best.pt` 409→200 transition once `complete` fires, WebSocket auth rejection, and event replay (events published before the WS connects are sent on subscribe so the desktop can disconnect/reconnect mid-run without losing history). Eight tests pass on a fresh checkout via `uv run --extra ml pytest tests/test_colab_server_smoke.py -q`.",
    ],
    fixes: [],
    knownLimitations: [
      "No desktop UI yet — `/train/configure` doesn't surface a *Run on Colab* button, and there's no *Connect to Colab* modal. Coming in P6b (`v0.8.9-p6b-colab-desktop`).",
      "No reconnect-with-backoff on WebSocket drops. The current server replays on subscribe so reconnect-via-page-refresh works, but the desktop's auto-reconnect logic ships in P6c.",
      "best.pt download isn't resumable. If the tunnel drops mid-download, the user re-clicks *Save to library*. Tracked for P6c polish.",
      "Cloudflare quick-tunnels still print a new URL every cell run. Named tunnels with a stable URL are post-pilot — see docs/PLAN-P6.md §4.5.",
    ],
  },
  {
    version: "0.8.7",
    phase: "P5.fix-7",
    title: "Bundle our own dist-info — version badge no longer reports `0.0.0+source`",
    tag: "v0.8.7",
    commit: "400ba79",
    date: "2026-05-19",
    status: "shipped",
    features: [],
    fixes: [
      "**Top-right version badge now reports the real shipped version** (e.g. `v0.8.7`) instead of the `v0.0.0+source` fallback that every PyInstaller-bundled release from v0.8.5 through v0.8.6 was showing. Cause: PyInstaller's `--collect-submodules vrl_yolo` bundles our package's source but not its `dist-info` metadata, so `importlib.metadata.version(\"vrl-yolo-gui\")` raised `PackageNotFoundError` at runtime and `_resolve_version()` returned the placeholder. `Info.plist`'s `CFBundleShortVersionString` was always correct (PyInstaller writes it from the `--name` + read-from-pyproject path); only the runtime-read API version was wrong. /api/health is the load-bearing read — the topbar pulls it once on first paint.",
      "Fix: add `--copy-metadata vrl-yolo-gui` to the PyInstaller invocation in `scripts/build-release.py`. One-line build-script change; no Python source change. The bundle ships ~1 KB of extra metadata; runtime version-lookup now succeeds. Dev mode (`uv run python src-pyloid/main.py`) was already correct because uv installs the package editably with proper dist-info.",
    ],
    knownLimitations: [
      "Doesn't backfill the badge on installs of v0.8.5 / v0.8.6 — those binaries are shipped as-is. Re-install from the v0.8.7 release to see the fix on your laptop.",
    ],
  },
  {
    version: "0.8.6",
    phase: "P5.fix-6",
    title: "Preserve existing splits — splitter no longer always reshuffles",
    tag: "v0.8.6",
    commit: "c5ae06e",
    date: "2026-05-19",
    status: "shipped",
    features: [
      "**Prepare splits now has a Preserve existing assignments checkbox.** Until v0.8.5, clicking Prepare splits on a dataset that already had `train/` + `val/` (or `valid/`) hand-curated by the user would gather every image from anywhere under the dataset root, reshuffle them by seed, and redistribute — destroying hand-curated splits. Users with a Roboflow export who just wanted to *add* a test split couldn't do it without losing the curated train/valid distribution. v0.8.6 fixes this: when the checkbox is on (default ON when the dataset already has at least one recognised split, OFF for a flat layout), images already in `train/` / `val|valid|validation/` / `test/` stay in those splits, and the ratios apply only to flat / unassigned images. Classify stratification still applies per-class to the flat pool. Detect carries each preserved image's label along (or its missing-label state).",
      "**Modal shows the impact before you click Split.** When Preserve is on AND there are preserved images in a split, the slider labels read `Train (10 preserved + 4 new = 14 images)` instead of just `Train (14 images)`. Test row uses the same format. When Preserve is on but every image is already in a split, the Split button greys out with the message *Every image is already in a split — nothing to redistribute. Uncheck Preserve to reshuffle from scratch.* — that's a UI-side guard so the case is caught before the backend round-trip; backend also enforces it with a clean 400 for direct API callers.",
    ],
    fixes: [
      "Inspector now reports `unassigned_image_count` on `DatasetInfoOut` so the frontend can tell whether a mixed layout (split + flat at root) has anything for Preserve to redistribute. Without this, the modal's flat-count derivation off `dataset.splits` would silently miss flat images that the inspector hides behind a split-layout report — disabling the Split button when it shouldn't be. Implementation: `_imagefolder_split_layout` scans non-reserved sibling dirs for image counts; `_inspect_roboflow_yolo` scans `<root>/images/`. Old API responses that omit the field default to 0 on the frontend (graceful degradation).",
      "Backend splitter internals (`_find_image_label_pairs`, `_collect_imagefolder_images`) now tag each image with its current split (`\"train\"` / `\"valid\"|\"val\"` / `\"test\"` / `None` for flat), normalised to the splitter's output convention so a `valid/` input survives the round-trip as `valid/` for detect and `val/` for classify. Both splitters share `_existing_split_for` for path-component recognition.",
    ],
    knownLimitations: [
      "Splits view on `/train/dataset` still doesn't surface the unassigned image count outside the Prepare-splits modal — a user with a mixed layout sees `train: 10 · val: 4` on the page and might not realise 6 flat images exist. Not blocking pilot; surfacing this is a small follow-up if pilot users get confused. The modal itself shows the count correctly when opened.",
      "Preserve doesn't currently let a user CARVE a test split out of existing train (i.e. \"I have train+val with no test, give me a test from train\"). That's a different operation semantically — the splitter is fundamentally a \"distribute a pool of images\" op. Out of scope here.",
    ],
  },
  {
    version: "0.8.5",
    phase: "P5.fix-5",
    title: "Graceful job cancel on Cmd+Q (training subprocess no longer orphaned)",
    tag: "v0.8.5",
    commit: "9159d0e",
    date: "2026-05-18",
    status: "shipped",
    features: [],
    fixes: [
      "**Cmd+Q during a training run now actually stops the training.** v0.8.2 fixed the macOS Cmd+Q crash by intercepting `QEvent::Close` and calling `os._exit(0)` to bypass the QSurface / QThreadStorage static-destructor race. That works, but `os._exit` is abrupt — it doesn't unwind Python, which means the training subprocess (Ultralytics under `train_runner.py`) gets reparented to launchd and keeps running silently in the background. CPU / RAM / MPS stay pinned for the rest of the run, the eventual `best.pt` is invisible to the (now dead) JobManager, and the user thinks Cmd+Q cancelled their training when really it only hid the UI. The new `_cancel_active_jobs_best_effort(app, timeout_s=3.0)` walks every running / queued job through `JobManager.cancel()` (which already SIGTERMs the process group on POSIX), polls for clean exit, and only then proceeds to `_macos_hard_exit`. Wired into both the `QEvent::Close` filter (Cmd+Q path) and the `aboutToQuit` fallback (e.g. SIGTERM from a signal handler).",
      "Best-effort means best-effort: if a job hangs past the 3 s cap, we hard-exit anyway. Leaving a partial checkpoint on disk is a strictly better outcome than the close crash this code was originally written to prevent, and SIGTERM almost always lands in well under 3 s for an Ultralytics run. Every step logs through the existing `step:` print pattern so `launch.log` shows the cancellation trail.",
      "The function signature for `_install_macos_shutdown_workaround` grew a second parameter (the FastAPI app), so the close filter can reach `app.state.job_manager` at fire time. Renamed the parameter `fastapi_app` to avoid shadowing the existing `app = QApplication.instance()` local. Verified the existing `VRL_YOLO_GUI_TEST_AUTO_QUIT_S=4` smoke still exits cleanly with no active jobs (no-op cancel path), proving the install + intercept chain didn't regress.",
    ],
    knownLimitations: [
      "**Linux / Windows still orphan the training subprocess** on app quit. Subprocess is started with `start_new_session=True` (POSIX) / `CREATE_NEW_PROCESS_GROUP` (Windows), so the parent dying doesn't propagate. Pilot is macOS-only — out of scope here. Will revisit when we ship for those platforms.",
      "Cancellation logic runs from the main Qt thread inside an event filter, so it blocks the UI for up to 3 s. That's intentional — the alternative is returning to the close cascade, which is the crash path we explicitly bypass. Cmd+Q with a training run mid-epoch will feel marginally laggier than without one; the user sees it as the training shutting down, which is the right mental model.",
      "Skill `python-pyloid-desktop-packaging` still doesn't document this pattern. Tracked separately in `docs/CARRY-FORWARDS.md` item #2.",
    ],
  },
  {
    version: "0.8.4",
    phase: "P5.fix-4",
    title: "Subprocess env-var dispatch (Train opened a second app + stuck at epoch 0)",
    tag: "v0.8.4",
    commit: "a86da1b",
    date: "2026-05-18",
    status: "shipped",
    features: [],
    fixes: [
      "**Pressing Start training no longer spawns a second Pyloid window, and the training subprocess no longer stalls at \"Waiting for first epoch…\".** Both symptoms were the same root cause: `JobManager.start()` spawned the training subprocess with `[sys.executable, \"-m\", \"vrl_yolo.engine.train_runner\", ...]`. That works fine in dev (where `sys.executable` is `python3.11`), but PyInstaller's bootloader in the frozen `.app` IGNORES `-m module` and just re-runs the bundled entry script — so the subprocess booted a second Pyloid window instead of the training runner, and the parent JobManager sat there waiting for events on a stdout that would never produce any.",
      "Fix: env-var sentinel. `src-pyloid/main.py` now reads `VRL_YOLO_GUI_SUBPROCESS` at boot (after `multiprocessing.freeze_support()`) and, when set to `\"train_runner\"`, dispatches to `train_runner.main()` directly — skipping the entire Pyloid / uvicorn boot. `JobManager.start()` sets that env var in the child env (`_child_env()`) and switches the cmd from `-m module` to positional argv. Dev mode passes `main.py` explicitly so python has a script to run; frozen mode uses the bundled binary directly. Same dispatch path in both, so dev runs exercise the same code the frozen `.app` will hit.",
      "Defensive: dispatch also bails out if `--multiprocessing-fork` appears in `sys.argv`, in case a future CPython release changes when `freeze_support()` intercepts mp-worker spawn args. Belt and braces.",
    ],
    knownLimitations: [
      "Same as v0.8.3: in-flight training subprocess is reparented to launchd on Cmd+Q. Follow-up.",
      "Module-level `_MAIN_PY = Path(__file__).resolve().parents[3] / \"src-pyloid\" / \"main.py\"` assumes training.py lives at `<repo>/server/vrl_yolo/engine/training.py` in dev. If the layout ever shifts, dev runs will raise a clear `RuntimeError(\"src-pyloid/main.py not found at ...\")` at training-start time. Frozen mode doesn't care — it uses the bundled binary directly.",
    ],
  },
  {
    version: "0.8.3",
    phase: "P5.fix-3",
    title: "Flat ImageFolder support + Prepare splits for classify + layout examples",
    tag: "v0.8.3",
    commit: "72dc1db",
    date: "2026-05-18",
    status: "shipped",
    features: [
      "**Flat ImageFolder layout is now recognised.** v0.8.0–v0.8.2 only detected the Ultralytics-ready split layout (`<root>/train/<class>/*.jpg`). The human-friendly flat layout (`<root>/<class>/*.jpg` — what doctors actually drop in when one folder per class is the natural way to organise lab images) was tagged \"Unknown layout\" and Continue was gated off. The inspector now accepts both shapes. Flat layouts are flagged with a clear warning saying training needs the splitter to run first.",
      "**Prepare splits now works for classification.** The same `POST /api/datasets/{id}/split` endpoint dispatches on detected task: detect routes to the existing YOLO splitter (image+label pairs, rewrites `data.yaml`); classify routes to the new `split_imagefolder` which stratifies per class and stages into `train/<class>/`, `val/<class>/`, and optionally `test/<class>/` — the exact shape Ultralytics' classify mode expects. Per-class stratification means a 10-image class doesn't accidentally land 9 in val and 1 in train.",
      "**Layout examples card on the dataset upload page.** A collapsible \"What does my dataset need to look like?\" card sits below the dropzone, showing 4 concrete ASCII trees: Roboflow YOLO, plain YOLO, flat ImageFolder, split ImageFolder. Open by default the first time; the collapsed state persists across visits via localStorage so frequent users aren't yelled at.",
      "**Prepare splits modal is task-aware.** Title, copy, slider label (Valid vs Val), and the validation-set warning all switch based on `dataset.task`. Detect users see Roboflow-shaped paths; classify users see `train/<class>/` / `val/<class>/` and the warning that Ultralytics' classify mode refuses to start without a val split.",
    ],
    fixes: [
      "`SplitModal`'s `totalPairs` used `Math.min(image_count, label_count)` everywhere — fine for detect, but collapsed classify totals to 0 because ImageFolder splits have `label_count: 0`. Classify branch now counts images directly.",
      "`needsSplitting()` now also surfaces the splitter for flat ImageFolder (single \"all\" pseudo-split) and for classify split-layouts missing val/. Previously classify always returned false, so the Prepare splits button never appeared even when training would fail without it.",
    ],
    knownLimitations: [
      "Same as v0.8.2: in-flight training subprocess is reparented to launchd rather than receiving a SIGTERM on Cmd+Q. Graceful job-group shutdown before the hard exit is still a follow-up.",
      "Layout examples card uses fixed ASCII trees; a future polish pass could swap them for SVG or render real previews of the user's dropped folder.",
      "Classify splitter merges images from all source locations (flat + any pre-existing train/val/test) and re-shuffles. If the user wanted to PRESERVE a hand-curated train/val/test split and just generate a missing test, they can't — Prepare splits is all-or-nothing. Acceptable for v1; might revisit if pilot feedback asks for it.",
    ],
  },
  {
    version: "0.8.2",
    phase: "P5.fix-2",
    title: "Window-scoped close filter (P5.fix-1 startup regression)",
    tag: "v0.8.2",
    commit: "5bc93cc",
    date: "2026-05-17",
    status: "shipped",
    features: [],
    fixes: [
      "**Startup regression introduced by v0.8.1 is fixed.** v0.8.1 installed a `QApplication`-level `QEvent::Quit` event filter to bypass the macOS Cmd+Q crash. That filter ran for every event for every QObject in the app — including the events QWebEngineView / QQuickWidget exchange during construction. Some of those events arrive from internal C++ objects whose Python wrappers PySide6 6.9 can't resolve, so `PySide::typeName(QObject const*)` deref'd null inside `sendThroughApplicationEventFilters` (confirmed via a `python3.11-*.ips` crash report from the local repro) and the process exited silently between `pyloid.create_window` and `pyloid.run()`. Bisecting by disabling just the `installEventFilter` line restored startup, confirming the filter was the killer.",
      "Replaced the app-wide `QEvent::Quit` filter with a **window-scoped `QEvent::Close` filter** installed AFTER `pyloid.create_window` returns. The filter is attached to the real `QMainWindow` reached by walking `window._window._window` (with a defensive 4-deep walk so future Pyloid releases that shift the field name don't silently no-op us). Scoping to one specific QObject means the filter only sees events delivered to that QObject — the PySide6 wrapper-resolution crash never gets a chance to fire. Catching `QEvent::Close` instead of `QEvent::Quit` puts us at the same place in the close cascade: it arrives at the QMainWindow before Pyloid's `closeEvent` runs, so we still pre-empt the `QCoreApplication.quit()` → re-entrant `[NSApplication terminate:]` path that was the original v0.7.1 / v0.8.0 crash.",
      "Kept the `aboutToQuit` fallback (for non-Cmd+Q paths that DO unwind through `exec()`), plus added per-step launch.log breadcrumbs (`step: macOS shutdown workaround installed …` / `step: QEvent.Close intercepted …`) so the next failure mode is one log-tail away from a diagnosis.",
      "Added a new env-gated test helper `_maybe_install_auto_quit_for_test()`: setting `VRL_YOLO_GUI_TEST_AUTO_QUIT_S=N` schedules a `QApplication.quit()` N seconds after `pyloid.run()` starts, so the close path can be exercised on a headless dev machine without sending real Cmd+Q. No-op when the env var is unset; ships in the binary so a clinician filing a bug can be asked to run with it set.",
    ],
    knownLimitations: [
      "Same as v0.8.1: in-flight training subprocess is reparented to launchd rather than receiving a SIGTERM. Graceful job-group shutdown before the hard exit is still a follow-up.",
      "Window-scoped filter assumes Pyloid's BrowserWindow exposes its QMainWindow within four `_window` hops. If a future Pyloid release reshapes that, the launch.log will print `macOS shutdown workaround skipped — could not locate underlying QMainWindow on 'BrowserWindow'` and the old crash returns. Worth a heads-up if you ever bump Pyloid.",
      "Upstream `python-pyloid-desktop-packaging` skill still documents the `aboutToQuit`-only fix AND doesn't warn against app-wide event filters — both should be updated.",
    ],
  },
  {
    version: "0.8.1",
    phase: "P5.fix-1",
    title: "macOS Cmd+Q event-filter shutdown (regressed startup; superseded by v0.8.2)",
    tag: "v0.8.1",
    commit: "543b40d",
    date: "2026-05-17",
    status: "shipped",
    features: [],
    fixes: [
      "**Cmd+Q on macOS no longer crashes the binary.** v0.8.0 (and every prior macOS build) inherited the `python-pyloid-desktop-packaging` skill's `aboutToQuit → os._exit(0)` workaround for the long-standing Qt6+QtWebEngine static-destructor race (`QSurface::~QSurface` → `QOpenGLContext::currentContext()` → `QThreadStorageData::get()` dereferences a null pointer deep inside `__cxa_finalize_ranges`). On macOS 26.x with PySide6 6.9 + Pyloid 0.27 that hook turned out to be **insufficient on the menu Cmd+Q path**: AppKit's `[NSApplication terminate:]` sends a `QEvent::Quit` to QApplication, Pyloid's `BrowserWindow.closeEvent` calls `QCoreApplication.quit()` from inside the close cascade, and `quit()` on macOS routes back through the Cocoa platform plugin and **re-enters `[NSApplication terminate:]` recursively** — proceeding straight to `libc exit()` without unwinding back to `QCoreApplication::exec()`'s cleanup, which is where `aboutToQuit` is actually emitted. The fallback hook never fired; the destructor chain ran; the process aborted.",
      "Replaced the single `aboutToQuit` connection with a `QApplication`-level event filter that catches `QEvent::Quit` **before** it reaches `tryCloseAllWidgetWindows`, and `os._exit(0)`s right there. We never run any closeEvent, never re-enter terminate, never reach `__cxa_finalize_ranges`. The `aboutToQuit` hook is kept as a fallback for code paths that DO unwind through `exec()` (e.g. a SIGTERM signal handler calling `app.quit()` from a normal context).",
      "Module-level reference (`_quit_event_filter`) keeps the QObject alive past the function's stack frame — Qt holds a raw pointer via `installEventFilter`, and CPython would otherwise free it the moment the local went out of scope, crashing the next event delivery.",
    ],
    knownLimitations: [
      "In-flight training subprocess does not receive a SIGTERM before the parent exits via `os._exit(0)` — the child is reparented to launchd and runs to completion or is reaped by the OS. Plumbing a graceful job-group shutdown before the hard exit lands in a follow-up; this fix is scoped to stopping the crash.",
      "The upstream `python-pyloid-desktop-packaging` skill at `~/.claude/skills/python-pyloid-desktop-packaging/SKILL.md` still documents `aboutToQuit` alone as the fix. That should be updated to reflect the re-entrant-terminate path observed here so other Pyloid projects don't repeat the same incomplete workaround.",
    ],
  },
  {
    version: "0.8.0",
    phase: "P5",
    title: "Train — Classification local run",
    tag: "v0.8-p5-train-classify",
    commit: "1d104f7",
    date: "2026-05-17",
    status: "shipped",
    features: [
      "**Classification training is live.** The /train task picker no longer gates the Classification card behind \"P5\" — pick it, drop an ImageFolder (`train/<class>/*.jpg`, optionally with `val/<class>/*.jpg`), tune, hit Start, watch live top-1/top-5 accuracy curves alongside training loss, save the trained checkpoint into the model library, and run it on slide patches in /predict.",
      "**Dataset wizard accepts ImageFolder for training.** The inspector already recognised it (warning copy aside); P5 wires Continue past the dataset page and adds a friendly warning when the user's selected task on /train doesn't match the layout they dropped (e.g. classify task + Roboflow YOLO folder).",
      "**Configure page branches per task.** Classification filters the model picker to `*-cls` weights, swaps the image-size chip ladder to 96–384 (anchored at 224 — the size yolo*-cls.pt was distilled at), hides the YOLO class-name editor (ImageFolder dir names ARE the class names), and re-probes /api/hardware with `task=classify` for batch-size suggestions (classify head fits ~2× detect at the same VRAM).",
      "**Live charts switch on the job's task.** Detection still draws box/cls/dfl loss + mAP50/mAP50-95; classification draws train/loss + validation top-1/top-5 accuracy on a 0..1 axis. `TrainingJobInfo.task` is the source of truth, so the chart re-renders correctly even after a refresh.",
      "**Save-to-library routes per task.** A classify run's `best.pt` lands in `<storage_root>/models/classify/trained-<short_id>.pt`, the registry rescan picks it up, and the run page sets it as the new classify default so /predict is one click away.",
      "Backend: `engine/train_runner.py` gained a `--task` arg + classify metric-key probes (`metrics/accuracy_top1`, `metrics/accuracy_top5`, `train/loss` with `train/cls_loss` fallback) and routes `data=` to the ImageFolder root for classify vs `data.yaml` for detect. `engine/training.py` `JobManager.start()` now takes `task`, validates the dataset shape per task, persists `task` on `TrainingJob`, and `save_to_library()` routes by job.task instead of hard-coded detect. `TrainingMetrics` schema gains nullable `loss` / `top1` / `top5` fields that coexist with the detect-only fields.",
    ],
    fixes: [
      "The dataset inspector's ImageFolder warning no longer parrots \"classification is P5 — configure page is detection-only for now\"; it now surfaces the actually-useful warnings (missing val/ split, single-class dataset) and stays silent when the layout is clean.",
      "The /train task picker's `disabled` flag and the configure page's hard-coded `task: \"detect\"` in the hardware-probe query key are both gone — selecting classify on /train now actually drives every downstream surface.",
      "`/train/configure` re-seeds epochs + image_size from the new task's preset when the user switches detect ↔ classify, so 640px doesn't linger from a previous detect session into a classify run.",
    ],
    knownLimitations: [
      "Classification training reports `train/loss` as `null` on some Ultralytics 8.4+ builds where the value sits under `train/cls_loss` only after the validation pass. The chart connects across nulls; the dropped points are silent rather than crashing the stream.",
      "Confusion matrix + per-class precision/recall reports for classify are P7-polish — the run page shows live top-1/top-5 but doesn't yet render a confusion grid at completion.",
      "Multi-tenant training is still out of scope; one in-flight job per JobManager. A queued status flips straight to running on submit.",
      "Colab tunnel handoff for classify (PLAN.md §11) lands in P6 alongside detect.",
    ],
  },
  {
    version: "0.7.1",
    phase: "P4b.fix-1",
    title: "Models — Download + rename + ml-import safety net",
    tag: null,
    commit: "2c0ced6",
    date: "2026-05-17",
    status: "shipped",
    features: [
      "**Download** button on every model card in /models. Streams the `.pt` file via `GET /api/models/{name}/download` with `Content-Disposition: attachment` so QtWebEngine's downloadRequested handler (P3b.fix-1) lands it in ~/Downloads/. Works for bundled, imported, and locally-trained models alike — clinicians wanted a one-click backup of a freshly-trained checkpoint without spelunking into `<storage_root>`.",
      "**Rename** button on imported + trained checkpoints. Inline edit on the card title; Enter saves, Esc cancels. `.pt` extension auto-appended if missing. Empty / colliding / unsanitised names are rejected on both client and backend (`POST /api/models/{name}/rename`). The rename also updates `defaults.json` so a renamed default stays the default.",
      "Bundled weights are read-only (the install tree gets re-fetched by `scripts/fetch-models.py` anyway), so the Rename button doesn't show on bundled cards — only Download.",
    ],
    fixes: [
      "When the venv is built without the `ml` extra, `/api/models` used to return 500 because the `from ultralytics import YOLO` inside `registry._inspect()` raised an uncaught `ModuleNotFoundError`. Now the import lives inside the try block and `ImportError` becomes a clean `ModelLoadError`; the scan loop drops the failing entry and `/api/models` returns an empty list with 200, so the frontend renders the friendly \"No detection models — run scripts/fetch-models.py --task detect\" message instead of a generic error page.",
    ],
  },
  {
    version: "0.7.0",
    phase: "P4b",
    title: "Train — Detection local run",
    tag: "v0.7-p4b-train-detect-run",
    commit: "2e42d9d",
    date: "2026-05-17",
    status: "shipped",
    features: [
      "**Local training actually runs.** Press \"Start training\" on /train/configure and the backend spawns an Ultralytics subprocess against your dataset. Per-epoch metrics stream live to /train/run via WebSocket with two Recharts curves (box/cls/dfl loss + mAP50 / mAP50-95), a progress bar, and a scrolling log tail.",
      "**Class-name editor** on /train/configure — rename each class in place before training. Names are written into the dataset's `data.yaml` and embedded in the trained checkpoint so /predict shows them automatically. Empty / duplicate names are rejected on both client and backend.",
      "Placeholder-name detection: plain-YOLO datasets that come without a `data.yaml` get `class_0…class_N` placeholders that the editor highlights in amber, with a callout reminding you to rename before training.",
      "**Cancel in-flight training** via a SIGTERM to the subprocess group (`start_new_session=True` on POSIX, `CREATE_NEW_PROCESS_GROUP` on Windows). The /train/run page shows a Cancel button while the run is queued/running.",
      "**Save-to-library** copies the run's `best.pt` into `<storage_root>/models/detect/trained-<short_id>.pt`, refreshes the registry, sets it as the new detection default, and surfaces an \"Open in Predict\" button so the doctor lands one click away from running their fresh model on slide patches.",
      "Backend subprocess wrapper (`engine/training.py` + `engine/train_runner.py`): job manager keeps an in-memory event log, a reader thread tails subprocess stdout, JSON-line events (`{_VRL_EVENT: true, type, ...}`) are interleaved with raw log lines, the WebSocket handler replays every event so a refresh lands a coherent snapshot.",
      "New routes: `POST /api/training/start` (returns 202 + job_id), `GET /api/training/{id}`, `WS /api/training/{id}/stream`, `POST /api/training/{id}/cancel`, `POST /api/training/{id}/save-to-library`, plus `PATCH /api/datasets/{id}/classes` for the rename editor.",
      "Hardware-aware: training inherits the configure-page accelerator probe (CUDA / MPS / CPU). Cross-version metric-key probes (`metrics/mAP50(B)` vs `metrics/mAP_0.5`) so the same UI works across Ultralytics 8.3 / 8.4.",
    ],
    fixes: [
      "Ultralytics auto-suffixed run names: the job manager pre-creates `<output_dir>/<job_id>/` so we know where to find `best.pt`, but Ultralytics would write to `<job_id>-2/` because `exist_ok` defaulted to `False`. Now passing `exist_ok=True` to `model.train()` so the run lands exactly where the manager expects it.",
    ],
    knownLimitations: [
      "Some loss metrics (box / cls / dfl) come through as `null` on certain Ultralytics versions where they live under different keys than the validation mAPs. The chart connects across nulls; the failing keys are dropped silently rather than crashing the stream.",
      "Training jobs are kept in-memory only — restarting uvicorn (e.g. via `run-desktop --clean`) loses the job snapshot. The on-disk `<storage_root>/training/<job_id>/` run artefacts survive, so you can still grab `best.pt` manually.",
      "Classification training is still detection-only at the UI level; P5 ships the classify branch (`task=classify` ImageFolder + top-1/top-5 metrics).",
      "Colab tunnel handoff (PLAN.md §11) lands in P4c — when no accelerator is detected, the wizard currently still lets you start a CPU run instead of suggesting Colab.",
    ],
  },
  {
    version: "0.6.1",
    phase: "P4a.fix-1",
    title: "Train — Dataset upload fix + split helper",
    tag: null,
    commit: "debf84b",
    date: "2026-05-17",
    status: "shipped",
    features: [
      "**Prepare splits** tool — for plain-YOLO datasets (images/+labels/ at root) and Roboflow exports that only ship a train split, click \"Prepare splits…\" to reshuffle into a clean train / valid / test layout with sliders for the ratios + a random seed.",
      "Backend `POST /api/datasets/{id}/split`: collects every image+label pair across the existing layout (any of plain YOLO, train-only Roboflow, or fully-split Roboflow), shuffles by seed, redistributes, wipes the old tree, and rewrites data.yaml. Preserves the dataset's UUID so the wizard store doesn't lose track.",
      "Class names are preserved from existing data.yaml when present; for plain YOLO without a yaml, the splitter walks label files to find the max class id and emits `class_0..N` placeholders (rename them later in P4b).",
      "Yellow callout on /train/dataset when no validation split is detected — clicking \"Prepare splits…\" opens the modal. After a successful split, a smaller \"Re-split\" button stays available for tweaking ratios.",
      "Backend tolerates ratios summing to 1.0 ± 0.001 (frontend rounds via integer percentages → divide by 100, so the sum sometimes drifts by a hair).",
    ],
    fixes: [
      "Roboflow YOLO datasets like `data.yaml + train/images + train/labels` were detected as \"Unknown layout\" in v0.6.0 — the FolderDropzone we built for Predict was MIME-filtered to images, so `data.yaml` and all the `.txt` label files were dropped at the browser level before they ever reached the backend. FolderDropzone now takes a `mode: 'images' | 'any'` prop; the Train wizard passes `mode=\"any\"` so the full dataset (yaml + labels + images) makes it through.",
    ],
  },
  {
    version: "0.6.0",
    phase: "P4a",
    title: "Train — Detection wizard",
    tag: "v0.6-p4a-train-detect-wizard",
    commit: "08d5f46",
    date: "2026-05-17",
    status: "shipped",
    features: [
      "New three-step training wizard at /train → /train/dataset → /train/configure (with /train/run as a P4b preview placeholder).",
      "/train task picker: Detection card opens the dataset wizard; Classification is gated behind a 'P5' badge so the doctor knows it's coming.",
      "Dataset upload + auto-inspect: drop a folder, see the format (Roboflow YOLO / plain YOLO / COCO / Pascal VOC / ImageFolder), per-split image + label counts, class list, and any warnings before committing to a run.",
      "Real upload progress bar via XMLHttpRequest (fetch still doesn't expose upload-progress events), with an in-flight Cancel button backed by AbortController.",
      "Backend dataset inspector (`server/vrl_yolo/engine/dataset.py`): path-traversal-safe upload writer, format auto-detection, class-balance counters; 4 GB total-size cap.",
      "Hardware probe at `/api/hardware`: returns kind/name/vram_gb/suggested_batch_size; the configure page reads it on mount and pre-fills the batch slider with a sensible default.",
      "Configure page: model picker (detect models only), preset radio (Quick=5ep / Standard=50ep / Best=200ep / Custom), image-size chip selector, batch-size slider with live hardware hint, summary card showing steps/epoch + total steps.",
      "Train state persisted to localStorage (Zustand) so reload / close-reopen during the wizard doesn't blow up the 200-image upload.",
      "Dataset rehydrate endpoint `GET /api/datasets/{id}` — configure page re-fetches on mount; if the dataset was wiped from disk (e.g. via a Reset desktop storage run), the user bounces back to /train/dataset.",
    ],
    fixes: [],
    knownLimitations: [
      "Training itself doesn't run yet — /train/run is a preview that shows the configured payload. P4b lands the actual subprocess + live metric WebSocket + results page.",
      "Classification training is detected (ImageFolder layouts get a friendly summary) but the configure page is detection-only. P5 ships the classify branch.",
      "Plain YOLO datasets (no data.yaml) require you to fill in class names — currently we surface a warning, but the configure page doesn't yet have a class-naming editor. Plan to add this in P4b alongside the run page.",
      "Datasets are uploaded over multipart — fast on a local Pyloid window but awkward on slow networks. A native folder-picker bridge for desktop mode lands in P7.",
    ],
  },
  {
    version: "0.5.1",
    phase: "P3b.fix-1",
    title: "Predict — Downloads fix",
    tag: null,
    commit: "cd1a92b",
    date: "2026-05-17",
    status: "shipped",
    features: [],
    fixes: [
      "CSV / XLSX / PDF export buttons in /predict folder mode now actually deliver a file — the v0.5.0 build had them silently dropping the download because QtWebEngine blocks downloads until something connects to the profile's `downloadRequested` signal. Pyloid's window doesn't ship a download manager, so the export request reached the backend, returned 200 with the right `Content-Disposition`, then the blob URL click went nowhere.",
      "Added `_install_download_handler()` in src-pyloid/main.py: auto-accepts every download, drops it in `~/Downloads/` with a unique-name suffix (e.g. `vrl-yolo-detect-...csv` → `vrl-yolo-detect-... (1).csv` if a file with the same name already exists), and logs the destination path via the `step:` prefix so the user can see where the file went in launch.log.",
    ],
  },
  {
    version: "0.5.0",
    phase: "P3b",
    title: "Predict — Reports, Import & Settings",
    tag: "v0.5-p3b-predict-reports",
    commit: "0d05150",
    date: "2026-05-17",
    status: "shipped",
    features: [
      "Settings page (new /settings route, sidebar entry under 'Preferences') with localStorage-backed preferences. First toggle: show / hide clinical workflow presets in /predict (default: hidden — the bundled COCO/ImageNet weights don't have clinical class names yet).",
      "Folder-batch image preview: click any row in the per-image table to see that file's image with detection boxes or the classify top-5 chart in a preview pane above the aggregate.",
      "Auto-select the first successful result so the preview pane never sits empty.",
      "Backend report generators: GET-then-download CSV, XLSX (per-image + aggregate sheets), and PDF (cover + summary + thumbnail grid + per-image table). ReportLab + OpenPyXL — no new dependencies.",
      "Frontend export toolbar (CSV / XLSX / PDF buttons) in the batch table card; PDF embeds up to 12 sample thumbnails resized to 480 px JPEG to keep payload size sane.",
      "/api/models/import: upload a .pt checkpoint, backend reads `model.task` + class names via Ultralytics, places it in `<storage_root>/models/<task>/`, refreshes the registry; user-imported models show up immediately with a `source: 'user'` card.",
      "/models page Import button: hidden file picker + mutation + query invalidation; shows backend errors verbatim (e.g. 'task=segment not supported in v1').",
      "Topbar pill now reads `v0.5.0 · predict — reports, import & settings` via the shared `useLiveVersion()` hook.",
    ],
    fixes: [],
    knownLimitations: [
      "Sliders still re-run on click only (live-update is deferred to a future polish pass — feedback was that it was lower priority than reports + import).",
      "Workflow presets hidden by default — clinical class names aren't in the bundled weights yet. Tracked to re-open in P10 (memory: project_presets_revisit).",
      "PDF thumbnail grid caps at 12 samples per report; the first 12 successful items by default. Curated selection lands when we add per-image flag annotations.",
      "No streaming batch WS endpoint yet — client-side iteration continues. Will be revisited when Train (P4) needs WS plumbing for live metrics.",
    ],
  },
  {
    version: "0.4.0",
    phase: "P3a",
    title: "Predict — Batch & Workflow Presets",
    tag: "v0.4-p3a-predict-batch",
    commit: "84dc3f8",
    date: "2026-05-17",
    status: "shipped",
    features: [
      "Folder mode: drop a folder of slide patches; the UI runs inference image-by-image with a live progress bar.",
      "Per-image results table — file, top class / box count, conf or count, inference ms — works for both detection and classification.",
      "Aggregate panel: detection rolls up per-class totals + max conf across the batch; classification rolls up the class distribution + flagged-count (top-1 below the review threshold).",
      "Recursive checkbox controls whether the dropzone walks subfolders or only the top level.",
      "Cancel button (`StopCircle`) aborts the in-flight batch — backed by `AbortController` plumbed through `runBatch()`.",
      "Workflow presets sidebar: 9 clinical workflows (histopathology mitosis / nuclei / tumour-subtype / Gleason; hematology WBC-diff / bone-marrow / malaria / smear-pathology / marrow-pattern). Picking one prefills model + conf + iou.",
      "`/api/presets` exposes the preset catalog from `engine/presets.py` (typed `Preset` dataclasses).",
      "Top-bar badge now reads from `/api/health` via a shared `useLiveVersion()` hook — no more hardcoded version strings.",
    ],
    fixes: [
      "Top-bar version pill was stuck at 'v0.1.0 · scaffolding' since P0; now reflects the running build (e.g. 'v0.4.0 · predict — batch & workflow presets').",
    ],
    knownLimitations: [
      "Sliders still re-run on click only — live updates land in P3b polish.",
      "User .pt import via the UI still returns 501 (lands in P3b).",
      "CSV / XLSX / PDF reports not yet implemented — P3b ships the task-aware report templates.",
      "Batch runs are sequential (concurrency = 1) on purpose; multi-GPU parallelism is a P10 problem.",
    ],
  },
  {
    version: "0.3.0",
    phase: "P2",
    title: "Predict — Classification",
    tag: "v0.3-p2-predict-classify",
    commit: "455efc8",
    date: "2026-05-17",
    status: "shipped",
    features: [
      "Single-image classification via Ultralytics' classify head — top-1 + top-5 returned for the full softmax distribution.",
      "/predict view task-switches based on the selected model: no SVG overlay, top-1 banner, top-5 bar chart (Recharts).",
      "Confidence slider repurposes as a review threshold — top-1 below the threshold renders a 'needs review' badge.",
      "Four new bundled classification weights: yolo26n-cls.pt, yolo26s-cls.pt, yolov8n-cls.pt, yolov8s-cls.pt (~37 MB).",
      "/api/inference/single now returns a discriminated union (detect | classify); FastAPI documents both shapes in OpenAPI.",
      "In-app /changelog page lists per-build features, fixes, and known limitations.",
    ],
    fixes: [],
    knownLimitations: [
      "Sliders don't live-update inference — still click-to-rerun (live updates planned for P3).",
      "User .pt import via the UI still returns 501 (lands in P3).",
      "Folder batch + CSV/XLSX/PDF reports not yet implemented (P3).",
    ],
  },
  {
    version: "0.2.1",
    phase: "P1.fix-1",
    title: "Cold-start race fix",
    tag: null,
    commit: "427093d",
    date: "2026-05-17",
    status: "shipped",
    features: [],
    fixes: [
      "Pyloid window no longer races uvicorn's lifespan startup — `window.load_url` waits for `Server.started`; backend ready in ~55 ms instead of ~12 s.",
      "Registry scan + torch import deferred out of FastAPI lifespan; first /api/models call does a lazy scan (~1.7 s) and caches.",
    ],
  },
  {
    version: "0.2.0",
    phase: "P1",
    title: "Predict — Detection",
    tag: "v0.2-p1-predict-detect",
    commit: "2acd8f5",
    date: "2026-05-17",
    status: "shipped",
    features: [
      "Single-image detection via Ultralytics YOLO — boxes (xyxy + xywhn), per-class counts, accelerator + inference timing in the response.",
      "Apple Silicon MPS auto-detected; first inference cold-loads ~3.6 s, subsequent calls ~50–100 ms.",
      "/predict view: drop zone, model picker, confidence + IoU sliders, SVG box overlay with stable per-class colours, counts table.",
      "/models page lists bundled + user models grouped by task with a 'Set as default' mutation that persists to disk.",
      "Four bundled detection weights: yolo26n.pt, yolo26s.pt, yolov8n.pt, yolov8s.pt (~53 MB).",
      "Model registry persists per-task defaults to <storage_root>/models/defaults.json.",
      "Python pinned to 3.11 via `.python-version`; dev + CI converge.",
    ],
    fixes: [],
  },
  {
    version: "0.1.0",
    phase: "P0",
    title: "Scaffolding",
    tag: "v0.1-p0-scaffolding",
    commit: "d06e9e2",
    date: "2026-05-17",
    status: "shipped",
    features: [
      "Pyloid desktop window opens, embedded uvicorn serves /api/health (200).",
      "Repo layout finalised: server/vrl_yolo/ (flat module), apps/web/ (Next.js 15 + Tailwind v4), src-pyloid/, scripts/, packaging/, models/.",
      "Six router stubs return 501 with the phase they land in — discoverable from /openapi.json.",
      "AGPL-3.0 LICENSE + COMMERCIAL-LICENSE.md template + NOTICE for upstream component licenses.",
      "GitHub Actions release workflow: macos-14 (arm64) + windows-latest (x64) matrix.",
      "macOS-specific packaging recipe in scripts/build-release.py: devtool-bundle strip, Team-ID inside-out resign, Info.plist version stamp, .dmg wrap, aboutToQuit → os._exit shutdown workaround.",
    ],
    fixes: [],
  },
];

/** Convenience accessor — UI uses this for the "you're on" indicator. */
export function currentRelease(): ReleaseEntry {
  return RELEASES.find((r) => r.status === "current") ?? RELEASES[0];
}
