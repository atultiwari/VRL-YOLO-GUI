# Carry-forwards

> Known limitations / deferred work that's been deliberately not fixed in
> shipped versions. Each item is a real gap, not a bug we don't know about.
> Sorted by likelihood of hitting in real use, not by complexity.
>
> **Last edit: 2026-05-19 (item #3 closed in v0.8.6 / P5.fix-6 — splitter now supports preserve-existing-splits. All deferred items resolved.).**

Each entry is self-contained so a future session can pick it up cold without
re-reading the whole P5 fix chain.

---

## 1. Graceful job-group SIGTERM on Cmd+Q

| | |
|---|---|
| **Status** | ✅ Resolved in v0.8.5 / P5.fix-5 — see [Resolved section](#resolved) below |
| **First flagged** | v0.8.1 / P5.fix-1 (re-flagged in fix-2, fix-3, fix-4) |
| **Severity** | Medium — user-visible "training silently keeps running after I quit" |
| **Blocks pilot?** | Recommend fixing before pilot users hit it |

### What's happening today

When the user hits **Cmd+Q** while a training run is in progress, the app
exits *immediately* via `os._exit(0)` — that's the macOS shutdown
workaround we shipped in P5.fix-2 to prevent the
`QSurface::~QSurface` → `QThreadStorageData::get` static-destructor crash.

The training subprocess (running Ultralytics under `train_runner.py`) is a
**child** of the main app process. When the parent dies abruptly via
`os._exit` without sending a termination signal, macOS's `launchd` adopts
the orphaned child and it keeps running silently in the background until
it finishes all its epochs.

### Concrete impact

- CPU / RAM / MPS keep getting consumed by the orphaned training run, with
  no visible UI. On a long run (200 epochs, large dataset) that's hours of
  unattended work the user thought they cancelled.
- The `best.pt` file still gets written to disk on completion, but the
  `JobManager` that knew about that run is dead — so there's no
  "Save to library" prompt, and `/predict` doesn't see the trained model
  unless the user re-launches the app and manually imports it via the
  `/models` Import button.
- Quietly confusing if the user pressed Cmd+Q *because* the run was taking
  too long: it doesn't actually cancel the training, it just hides the UI.

### Why deferred

The strict goal of P5.fix-1 / fix-2 was "Cmd+Q doesn't crash." Adding
"and also cancel any running training first" is a separate concern that
needs its own thinking — what timeout do we wait? Do we hard-exit anyway
if SIGTERM doesn't take? Do we ask the user "training is in progress —
really quit?" before exiting?

### Reference code

- `src-pyloid/main.py::_install_macos_shutdown_workaround` — the
  `QEvent::Close` filter that calls `_macos_hard_exit("QEvent.Close
  intercepted")`. This is where the SIGTERM-and-wait would go, *before*
  the `os._exit(0)`.
- `server/vrl_yolo/engine/training.py::JobManager.cancel` — already
  knows how to send `SIGTERM` to a single job's process group on POSIX
  (and `CTRL_BREAK_EVENT` on Windows). Just needs a new `cancel_all_and_wait`
  caller.
- `server/vrl_yolo/engine/training.py::JobManager.list_jobs` — returns
  all current jobs; we'd filter to `status in {"queued", "running"}`.

### Options for fixing

**Option A: Best-effort silent cancel (simplest).** Before `os._exit(0)`,
walk active jobs and SIGTERM each one. Wait up to ~3 seconds total for
exits, then hard-exit regardless. User sees nothing different at quit
time except their training actually stops.

```python
def _hard_exit_with_job_cleanup(reason: str, job_manager) -> None:
    active = [j for j in job_manager.list_jobs()
              if j.snapshot()["status"] in {"queued", "running"}]
    for job in active:
        job_manager.cancel(job.job_id)
    # Brief wait for SIGTERM to take.
    deadline = time.time() + 3.0
    while time.time() < deadline:
        if all(j.snapshot()["status"] not in {"queued", "running"}
               for j in active):
            break
        time.sleep(0.1)
    _macos_hard_exit(reason)
```

Wiring: `_install_macos_shutdown_workaround` needs to take the
JobManager (or fish it off `app.state.job_manager` at hook time).

**Option B: Confirmation prompt.** Show a native QMessageBox "Training is
in progress — quit anyway?" before exiting. More UX-correct but adds
another modal interaction at quit time, which may itself complicate the
close cascade (we're inside the `QEvent::Close` filter — modal dialogs
during event filtering are dicey).

**Option C: Persist job state to disk, allow re-attaching on next launch.**
Heaviest. JobManager state would survive app restarts, the UI could
show "There's a training run from your last session — view it?" Lots of
plumbing; only worth it if pilot users repeatedly say "I wish I could
quit and come back later."

### Decision points (answer before implementing)

1. **Cancel silently or prompt?** Option A vs Option B. Pilot UX preference.
2. **Cancel timeout** — 3s? 5s? Long enough for Ultralytics to flush
   `best.pt`, short enough that the user doesn't think the Cmd+Q is broken.
3. **Hard-exit if cancel hangs?** Almost certainly yes — the close crash
   we were preventing in the first place is worse than an orphaned process.

### Recommended path

Option A. Smallest change, covers the actual reported problem, no UX
ambiguity. Revisit Option C if pilot feedback asks for "resume training
after quit."

---

## 2. `python-pyloid-desktop-packaging` skill needs corrections

| | |
|---|---|
| **Status** | ✅ Resolved 2026-05-19 — skill updated in place, see [Resolved section](#resolved) below |
| **First flagged** | v0.8.1 / P5.fix-1; corrected in fix-2 but skill not updated |
| **Severity** | Low for this project, high for any *future* Pyloid project |
| **Blocks pilot?** | No |

### What's happening today

The skill at `~/.claude/skills/python-pyloid-desktop-packaging/SKILL.md`
is the reference doc I (Claude) loaded at the start of P0 to set up
VRL-YOLO-GUI's packaging. Two pieces of advice in it are now provably
wrong on macOS 26.x with Pyloid 0.27 + PySide6 6.9:

**Wrong claim #1:** "Hook `QCoreApplication::aboutToQuit` and call
`os._exit(0)` to bypass the static-destructor crash. `aboutToQuit` is
emitted synchronously inside `QCoreApplication::quit()`."

That's what v0.8.0 shipped. Cmd+Q still crashed because Pyloid's
`BrowserWindow.closeEvent` calls `QCoreApplication.quit()`, which on
macOS routes back through `libqcocoa` and re-enters
`[NSApplication terminate:]` recursively. That second terminate proceeds
straight to `libc exit()` without unwinding back to
`QCoreApplication::exec()`'s cleanup — which is the only place that
actually emits `aboutToQuit`. The hook never runs.

**Missing warning #2:** the skill doesn't warn against installing an
event filter on `QApplication` when `QWebEngineView` is in play. I tried
exactly that in v0.8.1 as "the obvious next step." It silently crashed
startup with `PySide::typeName(QObject const*)` dereferencing null inside
`QObjectWrapper::eventFilter` — because PySide6 6.9 can't always resolve
the Python wrapper for events flowing from internal C++ objects during
QWebEngineView construction.

### Concrete impact for THIS project

Zero. VRL-YOLO-GUI's `src-pyloid/main.py` already has the correct fix
(window-scoped `QEvent::Close` filter on the underlying QMainWindow,
plus `aboutToQuit` as a fallback). v0.8.4 ships and works.

### Concrete impact for OTHER projects

The next time anyone (me, Atul, or another Claude Code user) builds a
Pyloid + QtWebEngine desktop app and consults the skill, they'll fall
into both traps in sequence:

1. Read skill, implement `aboutToQuit` hook, ship.
2. App crashes on Cmd+Q. "But I followed the skill!"
3. Implement app-wide `QEvent::Quit` filter as the obvious next step.
4. App now crashes at *startup* — silently, no log trace beyond "Pyloid
   window created, then nothing."
5. Re-do the full P5.fix-1 → fix-2 diagnosis-and-recovery dance.

### Why deferred

Pure shared-infrastructure polish. Updating the skill doesn't make the
VRL-YOLO-GUI `.dmg` any better. The right time is when there's a quiet
moment between project phases.

### Reference code (the correct pattern, for skill examples)

- `src-pyloid/main.py::_install_macos_shutdown_workaround(window)` —
  takes the Pyloid window, walks `window._window._window` up to four
  nested `_window` attributes to find the underlying `QMainWindow`,
  installs a `QEvent::Close` filter on THAT object, keeps the
  `aboutToQuit` connection as a fallback.
- `src-pyloid/main.py::_maybe_install_auto_quit_for_test` — env-gated
  test hook (`VRL_YOLO_GUI_TEST_AUTO_QUIT_S=N`) that lets the close
  path be exercised on a headless dev machine. Worth promoting as a
  pattern in the skill so other projects can verify their workaround
  without needing a real Cmd+Q event.

### Options for updating the skill

**Option A: In-place corrections.** Edit the existing
"macOS quit-time crash" section to (a) describe the re-entrant-terminate
path, (b) replace the `aboutToQuit`-only example with the window-scoped
filter pattern, (c) add a clear "DO NOT install event filters on
QApplication when QWebEngineView is present" warning citing the
`PySide::typeName` crash signature, (d) reference VRL-YOLO-GUI as the
reference implementation. ~60 lines of skill edits.

**Option B: Promote VRL-YOLO-GUI to "reference implementation" status.**
Same as Option A but also reorganise the skill so the quit-handling
section pulls its example *directly* from VRL-YOLO-GUI rather than
inlining it. Slightly more durable — if the pattern evolves again,
only the project needs updating, not the skill.

**Option C: Bundle the env-gated test hook into the skill's
"verification" guidance.** Currently the skill's verification step is
"repeatedly Cmd+Q the app and watch DiagnosticReports." With
`VRL_YOLO_GUI_TEST_AUTO_QUIT_S` (or skill-equivalent
`<APP>_TEST_AUTO_QUIT_S`), verification becomes scriptable and CI-able.

### Decision points

1. **Edit in place or restructure?** Option A is fastest; Option B is
   more durable. Probably A unless the skill needs other restructuring
   anyway.
2. **Generalize VRL-YOLO-GUI's window-walk?** Pyloid's
   `window._window._window` nesting is project-specific naming, but
   the 4-deep walk pattern is general — worth promoting.

### Recommended path

Option A. Get the warnings into the skill so the next project doesn't
repeat the same diagnostic loop. Promote VRL-YOLO-GUI's
`_maybe_install_auto_quit_for_test` pattern as the verification helper.

---

## 3. Splitter is all-or-nothing

| | |
|---|---|
| **Status** | ✅ Resolved 2026-05-19 in v0.8.6 / P5.fix-6 — see [Resolved section](#resolved) below |
| **First flagged** | v0.8.3 / P5.fix-3 |
| **Severity** | Low — only affects users with curated splits |
| **Blocks pilot?** | Probably not, but worth confirming with pilot users |

### What's happening today

When the user clicks **Prepare splits…** in `/train/dataset` (either for
detect via `split_dataset` or classify via `split_imagefolder`), the
backend:

1. Collects **every image** from wherever it currently sits — flat at
   root, in `train/`, in `val/`, in `test/`, anywhere.
2. Shuffles them with the seed.
3. Redistributes per the new ratios.

This intentionally throws away any pre-existing split decisions. The
docstring of `split_imagefolder` says so explicitly:

> "The splitter doesn't care if a dataset was previously split unevenly;
> it re-shuffles from scratch using the seed."

### Concrete impact

**Scenario A: hand-curated val sets.** A pathologist intentionally placed
the hardest mitosis cases in `val/` so the model gets evaluated on the
cases they care about most. They click Prepare splits to re-stage a
flat dataset into the Ultralytics-ready shape. Their curated val gets
re-shuffled randomly. Quality of evaluation degrades silently.

**Scenario B: add-a-test-split.** A user has a Roboflow export with
`train/` + `valid/` but no `test/`. They want to JUST generate a test
split without touching the curated train/valid distribution. They can't —
clicking Prepare splits reshuffles all three.

**Scenario C: idempotency confusion.** A user splits 80/10/10, runs
training, then opens Prepare splits again to check the ratios. The
slider reads 80/10/10 (correct) but clicking "Split & re-inspect"
re-shuffles the dataset, changing which images are in val. The seed
makes this deterministic but not obvious — same seed gives the same
shuffle, but if the source data has changed at all (e.g. user dropped
in a few new images via re-upload) the shuffle differs.

### Why deferred

The primary use case is "user drops a flat folder, splits aren't right,
generate them." Preserving curated splits is a power-user / clinical-
research edge case. For a v1 clinical pilot it's almost certainly fine —
most pathologists will drop a folder and let the splitter decide.
Revisit if pilot feedback says otherwise.

### Reference code

- `server/vrl_yolo/engine/dataset.py::split_dataset` — detect splitter.
  Walks `_find_image_label_pairs` to collect everything, shuffles,
  redistributes.
- `server/vrl_yolo/engine/dataset.py::split_imagefolder` — classify
  splitter. Walks `_collect_imagefolder_images` (which explicitly looks
  in both flat AND split locations), stratifies per class, redistributes.
- `apps/web/app/train/dataset/page.tsx::SplitModal` — the UI. Currently
  has no "preserve existing splits" option.

### Options for fixing

**Option A: "Preserve existing splits" toggle.** Add a checkbox to the
modal (default off — "regenerate from scratch"). When on, the backend
detects which images already live in train/val/test, keeps those
assignments, and only redistributes images that are unassigned (e.g.
in the flat `<class>/` dirs or in a new upload).

```
[ ] Preserve existing splits — only assign new / un-classified images
```

Backend: `split_dataset(..., preserve_existing=True)` — a flag that
makes the splitter skip images already in a split dir, distribute only
the rest.

**Option B: Refuse to re-split.** If `train/` (and any of `val/`,
`valid/`, `test/`) already exist, refuse to split with a clear error:
"This dataset already has splits. Delete them first (or click Reset)
if you want to regenerate." Forces the user to make the decision
explicitly.

**Option C: Surface the seed prominently.** Don't change behaviour;
just make it more obvious that re-clicking with the same seed gives the
same split. Cheapest "fix"; doesn't help users with curated splits.

**Option D: Diff-aware splitting.** If pre-existing splits sum to 100%
of the source images, preserve them entirely (no-op). If new images
have been added, distribute only the new ones. Most "magic" but also
most surprising — fails closed differently depending on user state.

### Decision points

1. **Default behaviour:** preserve-on or preserve-off? Affects what
   happens to existing users when this lands.
2. **Surface in UI:** checkbox in modal, or warning before Split &
   re-inspect button activates?
3. **Detect-side parity:** the same option needs to make sense for both
   classify (`<class>/` dirs) and detect (`images/`+`labels/` pairs).
   Detect's split is more complex because images can be split without
   labels and vice versa.

### Recommended path

Option A with checkbox default OFF (current behaviour is the default).
Power users who care about preserving curated splits opt in. Simplest
backward-compatible change.

---

## When to revisit

- **After tomorrow's thorough testing** of v0.8.4: if anything in the
  testing exposes orphan-on-quit symptoms, item #1 jumps to "blocking."
- **Before P6 (Train on Colab) starts**: the skill update (#2) is worth
  doing first since P6 will also lean on Pyloid + QtWebEngine packaging.
- **During pilot prep**: revisit splitter behaviour (#3) once we know
  what shape pilots' datasets actually arrive in.

## Resolved

History of carry-forwards that have been closed. Kept here so a future
session can see *what was diagnosed and how it was fixed* without
digging through commit history; the open-items list above should stay
focused on what's actually pending.

### ✅ Item #1 — Graceful job-group SIGTERM on Cmd+Q

| | |
|---|---|
| **Closed in** | v0.8.5 / P5.fix-5 (2026-05-18) |
| **Time open** | v0.8.1 → v0.8.4 (4 successive patches re-flagged this) |
| **Path taken** | Option A — silent best-effort cancel with a 3 s wait |
| **Decisions** | Silent (no prompt) per Cmd+Q being an explicit quit intent; 3 s timeout (long enough to flush `best.pt`, short enough Cmd+Q still feels responsive); hard-exit if cancel hangs past the cap |

**What landed** (full detail in `docs/PHASE-STATUS.md`, `CHANGELOG.md` 0.8.5, and the
`fix(p5.fix-5):` commit):

- New `_cancel_active_jobs_best_effort(fastapi_app, timeout_s=3.0)` helper in
  `src-pyloid/main.py`. Pulls `app.state.job_manager`, filters to
  `status in {queued, running}`, calls `job_manager.cancel(job_id)` on each
  (which already SIGTERMs the process group on POSIX and CTRL_BREAK_EVENT
  on Windows), polls every 100 ms for clean exit, and returns when all
  jobs leave running/queued or the timeout expires. All errors swallowed +
  step-logged so an unhandled exception can't re-enter the close cascade.
- `_install_macos_shutdown_workaround(window)` grew a second parameter
  (the FastAPI app, named `fastapi_app` to avoid shadowing the existing
  `app = QApplication.instance()` local). Both the `QEvent::Close` filter
  (Cmd+Q path) and the `aboutToQuit` fallback now call the cancel helper
  immediately before `_macos_hard_exit(...)`.
- Verified with `PYTHONUNBUFFERED=1 VRL_YOLO_GUI_TEST_AUTO_QUIT_S=4
  uv run --extra ml python src-pyloid/main.py` — clean exit, no regression
  on the no-active-jobs path. Real-job cancellation exercised as part of
  the thorough v0.8.5 test pass.

**Why this path** over the alternatives:
- Option B (confirmation prompt) ruled out: modal dialogs inside a
  `QEvent::Close` filter risk re-entering the close cascade the workaround
  exists to skip.
- Option C (persist job state, allow re-attaching) ruled out: heavy
  scaffolding for a use case ("I wish I could quit and come back later")
  that pilot users haven't asked for yet. Revisit only on real demand.

**Carry-forwards from the fix itself**:
- Linux / Windows still orphan training subprocesses on app quit (subprocess
  was started with its own session/process group). Pilot is macOS-only; will
  revisit when we ship for those platforms. NOT tracked as a new
  carry-forward yet because no Linux/Windows binary is in pilot scope.
- Skill `python-pyloid-desktop-packaging` still documents the older
  approach. Tracked separately as carry-forward item #2 — **resolved
  2026-05-19, see below.**

### ✅ Item #2 — `python-pyloid-desktop-packaging` skill needs corrections

| | |
|---|---|
| **Closed in** | Skill edit at `~/.claude/skills/python-pyloid-desktop-packaging/SKILL.md`, 2026-05-19 |
| **Time open** | v0.8.1 → v0.8.5 (5 successive patches lived with the stale skill) |
| **Path taken** | Option A (in-place corrections) + Option C (env-gated test hook in verification). Option B (restructure to pull example from VRL-YOLO-GUI) rejected — would add a cross-repo dependency in the skill for marginal durability gain. |

**What landed** (full diff in the skill file itself):

- **TL;DR row at line 37** rewritten to describe the window-scoped
  `QEvent::Close` filter pattern plus the explicit "NOT on the QApplication"
  warning. One-liner, points at the detailed section.
- **Section "macOS quit-time crash" at line 404** rewritten. Kept the
  7-step root-cause analysis (still correct — the static-destructor chain
  hasn't changed). Added a date-stamped revision banner. Added two
  "What initially looked right but isn't" subsections:
  - **Wrong attempt #1:** `aboutToQuit`-only — fails on macOS 26.x because
    Pyloid's `BrowserWindow.closeEvent` calls `QCoreApplication.quit()`,
    which on macOS re-enters `[NSApplication terminate:]` recursively and
    proceeds straight to `libc exit()` without unwinding through
    `QCoreApplication::exec()`'s cleanup (which is the only place that
    emits `aboutToQuit`).
  - **Wrong attempt #2:** app-wide `QEvent::Quit` filter on QApplication —
    `PySide::typeName(QObject const*)` derefs null inside
    `QObjectWrapper::eventFilter` during `QWebEngineView` construction,
    silent startup crash, no traceback or `.ips` report.
- Replaced the code example with the working **window-scoped pattern**:
  - 4-deep `_window` walk to locate the `QMainWindow`.
  - Module-level `_quit_event_filter` reference (otherwise Python GCs the
    filter QObject and Qt's raw pointer dangles).
  - Explicit `super().__init__()` in the filter class.
  - Filter installed **AFTER** `pyloid.create_window` returns.
  - `aboutToQuit` connection kept as a fallback for non-Cmd+Q paths.
- Added a **"Critical wiring rules"** list summarising the four
  not-obvious-from-the-code constraints.
- Added a **"One thing this doesn't cover"** note that points readers
  at v0.8.5 (`9159d0e`) for the orphan-subprocess-on-quit pattern, so
  the next Pyloid project doesn't repeat the same diagnostic loop.
- **Verification block** replaced with the env-gated `_TEST_AUTO_QUIT_S`
  test hook pattern (scriptable + CI-able, vs the old "repeatedly Cmd+Q
  manually and watch DiagnosticReports"). Names the env var per-project
  (skill prescribes `MYAPP_TEST_AUTO_QUIT_S`; VRL-YOLO-GUI uses
  `VRL_YOLO_GUI_TEST_AUTO_QUIT_S`).
- **Checklist at line 1042** updated to match.
- **Reference citation:** `VRL-YOLO-GUI` at commit `5bc93cc` (v0.8.2 /
  P5.fix-2) for the canonical form of the base fix.

**Why this path** over the alternatives:

- **Option B** (restructure to pull the example directly from
  VRL-YOLO-GUI) rejected because the skill is currently self-contained
  and that's a feature, not a bug — every cross-repo dependency in a
  skill is a place where the skill silently rots when the upstream
  project moves.
- The skill is already long and battle-tested; in-place corrections
  preserve all the surrounding context (the static-destructor steps,
  the "Why this is loss-free" rationale, the cross-platform note) while
  fixing only the wrong parts.

**Carry-forwards from the fix itself**: none. The skill is now the
single source of truth again for new Pyloid projects.

### ✅ Item #3 — Splitter is all-or-nothing

| | |
|---|---|
| **Closed in** | v0.8.6 / P5.fix-6 (2026-05-19) |
| **Time open** | v0.8.3 → v0.8.5 (3 successive releases lived with the all-or-nothing splitter) |
| **Path taken** | Option A (preserve-existing checkbox in modal, default OFF). Sub-decisions agreed during the design pass: smart default = ON when dataset has any recognised split / OFF for flat layout; empty case = disable submit + hint (no backend round-trip); slider labels = "X preserved + Y new = Z" when preserve ON. |

**What landed** (full detail in `docs/PHASE-STATUS.md` P5.fix-6 section,
`CHANGELOG.md` 0.8.6, and the `fix(p5.fix-6):` commit):

- **Backend splitter rewrite.** `_find_image_label_pairs` and
  `_collect_imagefolder_images` now tag each image with its current
  split (or `None` for flat); both share `_existing_split_for(img,
  root, val_output_name=...)` for path-component recognition,
  normalised to each task's output convention (`valid` for detect,
  `val` for classify). `split_dataset` and `split_imagefolder` take
  `preserve_existing: bool = False`; when True, preserved images skip
  the shuffle and ratios apply only to the flat pool. Classify keeps
  per-class stratification on the flat pool with the existing
  `max(1, ...)` train-minimum guarantee. Raises a typed `ValueError`
  with the message `"preserve_existing=True but every image is already
  in a split — nothing to redistribute. Uncheck Preserve to reshuffle
  from scratch."` when there's nothing flat (mapped to 400 by the route).
- **New `unassigned_image_count` on `DatasetInfoOut`.** Inspector paths
  (`_imagefolder_split_layout` + `_inspect_roboflow_yolo`) now count
  flat images that coexist with a split layout. Without this, the
  modal's flat-count derivation would silently miss them in mixed
  layouts and disable the Split button incorrectly. Default 0 so old
  API responses degrade gracefully; the frontend has a `?? 0` fallback.
- **SplitDatasetRequest** got `preserve_existing: bool = False`.
- **Frontend `SplitModal`** gained the checkbox + the
  "X preserved + Y new = Z" slider labels + the empty-case guard. The
  default state is ON when `hasExistingSplits` (any split with name in
  {train, val, valid, validation, test}), OFF otherwise.
- **Verification:** 7-case smoke battery (classify pure-flat/pure-split/
  mixed-preserve/pure-split-preserve-raises; detect pure-flat/
  mixed-preserve/pure-split-preserve-raises) all pass. FastAPI
  TestClient confirms `unassigned_image_count` is reported correctly
  for mixed layouts. Frontend `tsc --noEmit` is clean.

**Why this path** over the alternatives:
- Option B (refuse to re-split when splits already exist) ruled out
  because it forces a destructive "delete first" step on the user for
  what should be a non-destructive operation.
- Option C (just surface the seed) ruled out — doesn't solve the
  actual problem of preserving curated splits.
- Option D (diff-aware splitting that's a no-op when sums match) ruled
  out as too clever — different behaviour depending on user state is
  surprising.

**Carry-forwards from the fix itself**:
- Splits view on `/train/dataset` doesn't show `unassigned_image_count`
  outside the modal. Pilot-feedback-driven follow-up if confusing.
- Doesn't carve a test split out of existing train (different
  semantic operation; not what the splitter is for).

---

## How to add new carry-forwards

When a P-phase or fix lands and we deliberately defer something:

1. Add a short note in the `Known limitations (deferred)` section of
   the matching `apps/web/lib/changelog.ts` entry and `CHANGELOG.md`.
2. Add a one-line bullet in the `Carried-forward` section of the
   matching `docs/PHASE-STATUS.md` phase block.
3. **Add a full section here** with the same structure as items 1-3
   above (status table, what's happening, concrete impact, why deferred,
   reference code, options, decision points, recommended path).

That third step is what makes the deferral actionable later — bullets
in PHASE-STATUS rot fast and don't give a future session enough to act
on without re-deriving the whole problem.
