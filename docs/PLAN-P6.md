# P6 Plan — Train on Colab

> Concrete architecture + sub-phase breakdown for **Phase 6 — Train on
> Colab**, the next phase after the P5 fix chain. **Not yet committed to
> implementation** — this doc captures the design + open decisions for
> sign-off before any code lands. Source survey: the `yolo-gui`
> reference project at `/Users/atultiwari/Downloads/Projects/YOLO-GUI/yolo-gui/`
> (whose worked Cloudflare-tunnel + Drive pattern we partially borrow
> but topologically invert — see §1 below).
>
> Once signed off, this doc gets folded into `docs/PHASE-STATUS.md` as
> the P6 section. The plan stays editable as we learn things during
> implementation.

---

## 1. Architecture summary

**VRL-YOLO-GUI is the primary UI; Colab is an optional remote
training worker.** This is the inverse of `yolo-gui`, where Colab runs
the whole app and the user opens the tunnel URL in their browser.

```
Desktop (Pyloid + FastAPI + Next.js)              Colab (browser tab)
─────────────────────────────────────             ─────────────────────────
/train/configure → Run on Colab toggle            Notebook cell:
                                                   1. drive.mount('/content/drive')
User opens Colab notebook ────────────────►        2. Read user config
                                                   3. Start FastAPI mini-server
                                                      on 127.0.0.1:8765
                                                   4. Spawn cloudflared quick
                                                      tunnel → trycloudflare URL
                                                   5. Print URL to cell output
                                                   6. Start Ultralytics training
                                                      subprocess, stream events
                                                      to /events WS
User copies tunnel URL ◄──────────────── trycloudflare.com/abcdef-...

User pastes URL into ────────────────────────────► /events (WebSocket)
desktop's "Connect to Colab" sheet                   /status (GET)
                                                     /best.pt (GET — after training)

Desktop receives epoch events via WS ◄────── live metric stream
Renders live charts (same as local)

On completion:
Desktop downloads best.pt ◄────────────── /best.pt (one-shot)
through tunnel, saves to library
```

**Why this shape over the alternatives:**

- **Drive as event relay** (Colab writes events to Drive, desktop polls)
  rejected: ~10 s polling latency makes the live charts feel broken;
  needs Drive OAuth on the desktop side, which is a significant Pyloid
  webview hassle.
- **Pre-shared URL slot** (a server we operate that brokers Colab ↔
  desktop) rejected: introduces infrastructure we don't otherwise need.
- **User pasting the URL once** is acceptable v1 friction. Same as the
  reference. Adds 5 seconds to setup, removes a whole infrastructure
  category.
- **Drive for the dataset, tunnel for everything else** — Drive is the
  natural one-time-upload destination for the dataset (Colab's
  `drive.mount` is purpose-built), but events + artifacts both flow
  through the tunnel so the desktop never needs Drive credentials.

---

## 2. Component breakdown

### 2.1 Notebook + Colab-side runtime

| File | Purpose |
|---|---|
| `notebooks/01_train_detect_colab.ipynb` | Detect-task companion notebook |
| `notebooks/02_train_classify_colab.ipynb` | Classify-task companion notebook |
| `notebooks/_runtime/colab_server.py` | FastAPI mini-server: WS `/events`, GET `/status`, GET `/best.pt`, POST `/cancel` |
| `notebooks/_runtime/colab_tunnel.py` | Cloudflared quick-tunnel wrapper (download binary if needed, spawn, parse stdout for URL) — borrowed pattern from `yolo-gui`'s `start_colab.py:72-186` |
| `notebooks/_runtime/colab_runner.py` | Ultralytics training subprocess wrapper. Reuses `server/vrl_yolo/engine/train_runner.py` shape — same JSON event protocol so the desktop's existing event handlers work unchanged |

The two notebooks are thin shells — they import from `_runtime/`, mount
Drive, read user config from a known path (`/content/drive/MyDrive/VRL-YOLO-GUI/config.json`),
and call into `colab_server.py`. The user runs all cells, copies the
printed URL.

Important: the runtime files live under `notebooks/_runtime/` in our
repo. When the user runs the notebook, the first cell clones our repo
to `/content/vrl-yolo-gui-colab/` and adds `notebooks/_runtime/` to
`sys.path`. That way fixes ship via `git pull` in the notebook rather
than via notebook edits.

### 2.2 Desktop-side `engine/colab.py`

New backend module — no PyInstaller concerns since this runs only at
runtime, not at build time. Provides:

- `class ColabSession` — tracks state of a connected Colab job:
  tunnel URL, last-seen-event timestamp, current epoch/metrics,
  best.pt URL when ready.
- `connect(tunnel_url) -> ColabSession` — validates URL, opens
  WebSocket to `<url>/events`, returns the live session.
- `fetch_best_pt(session) -> Path` — one-shot download of the
  trained checkpoint through the tunnel, returns the local path it
  landed at.

`JobManager` gains a parallel `start_colab_job(tunnel_url, name, ...)`
that wraps a `ColabSession` in the same `TrainingJob` dataclass shape
as local runs, so `/train/run` doesn't need to know the difference.

### 2.3 Desktop UI changes

- `/train/configure` — accelerator detection already returns `cpu` for
  machines without CUDA/MPS. When `accelerator.kind === "cpu"`, show
  a yellow callout: *"This machine has no GPU. Local training will be
  slow. Train on Google Colab instead?"* with a **Run on Colab** button.
- Clicking Run on Colab opens a new modal: *"Connect to a Colab session"*
  with:
  1. Instructions: "Open the [task]-training notebook in Colab" with a
     button that opens the right notebook URL in the user's browser
     (via `pyloid.open_external_url`).
  2. A text input: *"Paste the tunnel URL from the Colab cell here"*.
  3. **Connect** button → calls `engine/colab.py::connect()`.
- On successful connect, redirect to `/train/run` with the
  `ColabSession`-backed job; the live charts page works unchanged.

### 2.4 Save-to-library flow

When a Colab run completes, the existing **Save to library** button
on `/train/run` triggers `fetch_best_pt(session)` instead of the local
file copy. The downloaded `best.pt` lands in `<storage>/models/<task>/`
exactly as for local runs, so `/models` picks it up without any change.

---

## 3. Sub-phase breakdown

P6 splits into three sub-phases. Each gets its own commit + tag so we
can land + verify each independently — same pattern as P0–P5.

### P6a — Notebook + Colab runtime (estimated 4–5 days)

**Deliverable:** running the detect or classify notebook in Colab
produces a printed tunnel URL; hitting `<url>/status` returns the
training state; `<url>/events` streams epoch events; `<url>/best.pt`
serves the checkpoint when training completes. Verified end-to-end
*without* the desktop side — manual curl from a terminal proves the
notebook runtime is correct.

Files added:
- `notebooks/_runtime/colab_server.py`
- `notebooks/_runtime/colab_tunnel.py`
- `notebooks/_runtime/colab_runner.py`
- `notebooks/01_train_detect_colab.ipynb`
- `notebooks/02_train_classify_colab.ipynb`
- `docs/COLAB-GUIDE.md` — clinician-facing setup steps

Tag: `v0.8.8-p6a-colab-notebook` (using the patch series since this
ships incremental functionality, not yet the full P6 phase boundary).

### P6b — Desktop integration (estimated 4–5 days)

**Deliverable:** "Run on Colab" callout + modal on `/train/configure`,
a working `ColabSession`-backed job that streams events to `/train/run`,
best.pt download on save-to-library.

Files added/changed:
- `server/vrl_yolo/engine/colab.py` (new)
- `server/vrl_yolo/engine/training.py::JobManager.start_colab_job` (new method)
- `server/vrl_yolo/api/routers/training.py` (new route `POST /api/training/colab/connect`)
- `apps/web/app/train/configure/page.tsx` (new callout + Run on Colab modal)
- `apps/web/lib/api.ts` (new `connectColab` helper)

Tag: `v0.8.9-p6b-colab-desktop`.

### P6c — Polish, error states, end-to-end pilot test (estimated 2–3 days)

**Deliverable:** the full P6 phase tag. Handles:
- Tunnel URL invalid / unreachable (clear error in modal, not a
  cryptic WebSocket failure).
- WebSocket disconnect during training (reconnect with exponential
  backoff; if cancellable, allow user to abandon).
- best.pt download mid-failure (resumable? or just retry?).
- Colab session timeout (notebook detects, cleanly shuts down,
  desktop sees disconnect + "Colab session ended" message).

Tag: `v0.9-p6-train-colab` (matches PLAN.md §14's planned tag).

---

## 4. Open decisions (sign-off needed before P6a starts)

### 4.1 Where the user uploads the dataset to Drive

Three viable paths:

**Option A: User uploads manually to `MyDrive/VRL-YOLO-GUI/datasets/<name>/`.**
Notebook expects exactly that path. Simplest possible UX — but the
user has to navigate Drive, drop a folder, wait for sync. Acceptable
for v1 pilot.

**Option B: Desktop generates a `gdown`-friendly shareable link, user
pastes it; notebook downloads from the link directly.**
No Drive mount needed. But requires the user to upload to their Drive
AND make the folder shareable AND paste a link — more steps than A.

**Option C: Desktop pushes dataset through the tunnel after URL is
pasted, before training starts.**
Avoids Drive entirely. But: dataset can be 500 MB+; quick-tunnel
bandwidth + Colab IO is the bottleneck. Acceptable for small datasets
(<100 MB), slow for larger ones.

**Recommended: A.** It matches what clinicians already do (drag folder
into Drive web UI). The notebook reads from a known Drive path; the
desktop just shows the path to expect in its instructions.

### 4.2 What happens if the user pastes a stale / dead tunnel URL?

A previously-printed `trycloudflare.com/abc-...` URL stops working as
soon as the Colab cell stops. If the user pastes a stale URL, the
desktop's `connect()` call needs to fail clearly.

**Recommended:** `connect()` does a `GET /status` first with a 3 s
timeout. If the response isn't a JSON `{status: ready, task: ...}`,
show an error in the modal: *"Couldn't reach that Colab session — is
the cell still running? Re-run the cell and paste the new URL."*

### 4.3 Should the notebook's `_runtime/` live in our repo, or be
        embedded in the .ipynb files?

**Option A: Repo path.** Notebook first cell does `git clone
https://github.com/atultiwari/VRL-YOLO-GUI` and `sys.path.append`.
Fixes ship via `git pull`. Easier to maintain.

**Option B: Embedded.** All Python source is inside the notebook
cells. Self-contained, no clone step. But every fix means re-publishing
the notebook.

**Recommended: A.** The notebook becomes a thin orchestrator + the
runtime ships from the same repo as the desktop, so they stay in sync
by construction. The clone step adds maybe 10 seconds at first run;
acceptable.

### 4.4 What's the canonical Colab URL the desktop links to?

The "Open notebook in Colab" button needs a URL. Two shapes:

**Option A: GitHub-anchored** —
`https://colab.research.google.com/github/atultiwari/VRL-YOLO-GUI/blob/main/notebooks/01_train_detect_colab.ipynb`.
Always points to current main. User can `Open in playground` to save
their own copy.

**Option B: Drive-anchored** — Notebook lives in user's own Drive.
First-time setup involves them copying the notebook. More steps.

**Recommended: A.** Zero-setup. Updates land via `git push`.

### 4.5 What about authenticated Cloudflare tunnels (named tunnels)?

Quick-tunnels (no auth) are simpler but the URL changes every cell
run. A named tunnel with a stable URL (e.g.
`vrl-yolo-gui.example.com`) would let the desktop "remember" the URL
across sessions.

**Recommended: stick with quick-tunnels for v1.** Named tunnels
require a Cloudflare account + DNS setup; bad fit for an unbranded
single-binary clinician tool. Revisit post-pilot.

### 4.6 How does the user authenticate to access the tunnel?

A `trycloudflare.com` URL is **public** the moment it's printed. Anyone
who learns the URL can call the WebSocket + download the trained
model. For a clinical dataset, that's a real concern.

**Options:**
- **A. Token in the URL:** notebook generates a random token, builds
  the WebSocket URL as `<tunnel>?token=<rand>`, prints the composite
  URL. The server-side mini-app rejects any request without a matching
  query/header token. Token is per-session.
- **B. HTTP Basic Auth:** username/password printed by the notebook.
  User pastes both into the desktop.
- **C. No auth.** Security through URL obscurity — the URL is a
  random subdomain, not exposed unless someone knows it.

**Recommended: A.** Token approach gives real protection without
adding two paste fields. Token regenerated each Colab cell run.

---

## 5. Out of scope for P6

To keep P6 focused:

- **Resuming a training run after Colab session timeout.** If the
  Colab notebook dies mid-training, the user has to start over. Adding
  resumption requires checkpoint upload to Drive mid-training — punt
  to a separate carry-forward if pilot users complain.
- **Multiple concurrent Colab jobs.** Desktop assumes one Colab
  session at a time. The data model supports more (each job has a
  separate `ColabSession`), but the UI only shows one connect modal.
- **Colab Pro / Pro+ / TPU support.** Notebook works with free Colab
  out of the box. Pro accelerators (A100 / T4) require no notebook
  changes; tracking which the user has would be a polish item.
- **Sub-second metric streaming.** WebSocket is event-driven (one
  message per epoch end). Per-batch streaming is overkill for the
  pilot use case (epoch durations are 30s–5min depending on dataset
  size).
- **Drive-as-checkpoint-storage.** best.pt comes through the tunnel,
  not Drive. If the tunnel drops between training completion and
  save-to-library, the user re-runs save-to-library when reconnected;
  if the Colab session itself is dead, the checkpoint is lost. Pilot
  acceptable.

---

## 6. Pre-flight before P6a starts

These need to exist or be confirmed before the first commit:

- [ ] All six open decisions (§4) signed off by the user.
- [ ] Confirm the four notebook cells fit on screen (clinician
      shouldn't have to scroll through 30 cells of code).
- [ ] Confirm Cloudflare quick-tunnel still doesn't require account
      sign-up (check `cloudflared tunnel --url ...` docs as of
      2026-05).
- [ ] Confirm `git clone` of a public repo works inside Colab without
      auth (it does; mention here as a sanity check).
- [ ] Decide whether `colab_runner.py` SHARES code with
      `server/vrl_yolo/engine/train_runner.py` or re-implements (per
      the no-premature-abstraction rule: re-implement is fine if it's
      <100 lines; share via a small `engine/_runner_common.py` if it's
      bigger).

---

## 7. Pilot test plan (drives P6c sign-off)

End-to-end test against `lung_partial` on free Colab from a
CPU-only Mac:

1. From `/train/configure` on a CPU machine, click "Run on Colab".
2. Modal opens, click "Open notebook" → Colab opens in browser.
3. In Colab: Runtime → Change runtime type → GPU. Run all cells.
4. Wait for cloudflared URL to print (~30 s).
5. Copy URL, paste into desktop modal, click Connect.
6. Desktop redirects to `/train/run` with the live charts updating.
7. Watch 1 epoch complete, confirm metrics arrive within 2 s of the
   notebook printing them.
8. Click Save to library. Confirm best.pt lands in `<storage>/models/<task>/`.
9. Click Predict, use the new model. Confirm it works.

If all 9 steps work end-to-end, P6 is done.

---

## 8. Notes for future Claude sessions

- The `yolo-gui` reference's topology (Colab IS the app, browser
  connects to tunnel) does **not** fit VRL-YOLO-GUI. We borrow the
  Cloudflare tunnel binary handling + URL parsing + the subprocess
  training pattern, but the integration shape is inverted.
- The token auth (§4.6) is non-negotiable for clinical data. If
  someone proposes "skip auth, the URL is random anyway" — push back.
- Sub-phase tags use the `0.8.x` series (`v0.8.8-p6a-...`,
  `v0.8.9-p6b-...`) and only the phase-completion tag jumps to
  `v0.9-p6-train-colab`, matching the PLAN.md §14 nomenclature.
