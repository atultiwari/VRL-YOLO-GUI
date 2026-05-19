# P6 Pilot Test — End-to-End Train on Colab

> The 9-step verification plan from `docs/PLAN-P6.md` §7, expanded into
> an executable checklist with expected outputs at each step. Run this
> once against a real Colab session before declaring P6 done.
>
> **Prerequisite:** v0.8.9-p6b-colab-desktop or later installed as a
> .app / .exe, and a clinical dataset on disk (e.g. `lung_partial`
> from the user's Datasets folder).
>
> Estimated wall-clock time: **45–75 minutes** on free Colab T4 with a
> small dataset.

---

## Test environment

- **Hardware:** a CPU-only Mac or Windows machine (no CUDA / MPS).
  This ensures the *Run on Colab* callout actually shows up on
  `/train/configure`.
- **Colab account:** any Google account with free Colab access.
- **Dataset:** a small detect or classify dataset (~50–500 images).
  Suggested: `lung_partial` (classify, 4 classes, ~200 images) — it's
  already been verified end-to-end for local training in v0.8.3.

---

## The 9 steps

### Step 1 — Open `/train/configure` and observe the callout

**Action:** Launch the .app. Go to **Train** → drop a dataset → on the
configure page, wait for the hardware probe to complete.

**Expected:**

- Hardware card shows **CPU** with a yellow tone.
- A yellow callout sits between the hyperparameter card and the *Start
  training* button:
  > ☁ This machine has no GPU — local training will be slow.
  > *Train on a free Google Colab GPU instead.*
  > [Run on Colab]

✅ Pass criterion: callout visible. ❌ Fail: not visible on CPU-only
machine → check `useQuery(["hardware", …])` is returning `kind: "cpu"`
and `RunOnColabCallout` is rendered.

### Step 2 — Open the Connect modal + the Colab notebook

**Action:** Click **Run on Colab**.

**Expected:** A modal opens with:

- Title *Connect to a Colab session*.
- A code-block showing the GitHub-anchored notebook URL for the
  current task (detect → `01_train_detect_colab.ipynb`; classify →
  `02_train_classify_colab.ipynb`).
- **Copy** and **Open** buttons next to the URL.
- A URL text input with the placeholder
  `https://abc-def.trycloudflare.com?token=…`.

Click **Open** — the system browser opens Colab on the right notebook.
Leave the modal open in the desktop.

✅ Pass criterion: task-correct notebook opens in browser. ❌ Fail:
wrong notebook → check the `NOTEBOOK_URLS` constant in
`apps/web/components/train/connect-colab-modal.tsx`.

### Step 3 — Configure Colab and run the notebook

**Action in browser:**

1. `Runtime → Change runtime type → GPU` (T4 is fine).
2. Mount Drive when prompted (cell 1).
3. Wait for repo clone + pip install (~30 s, cell 2).
4. In cell 3, edit `CONFIG['dataset_name']` to match the folder you
   uploaded under `MyDrive/VRL-YOLO-GUI/datasets/`. Other values
   default.
5. `Runtime → Run all`.

**Expected:** After ~30–60 s, cell 4 prints:

```
========================================================================
Copy this URL into the desktop app's "Connect to Colab" modal:

    https://<random>.trycloudflare.com?token=<random>

Keep this notebook running. The URL stops working when the cell stops.
========================================================================
```

Cell 5 immediately starts training and prints Ultralytics' epoch
progress.

✅ Pass criterion: tunnel URL visible + Ultralytics logs scrolling.
❌ Fail: `cloudflared` missing → check the Linux/x86_64 detection in
`notebooks/_runtime/colab_tunnel.py`. ❌ Fail: dataset not found →
verify the folder name matches.

### Step 4 — Paste the URL into the desktop, click Connect

**Action:** Copy the URL Colab printed; paste it into the desktop's
*Tunnel URL* input; click **Connect**.

**Expected:**

- Modal Connect button shows a spinner for <1 s.
- Modal closes.
- Desktop redirects to `/train/run`.
- Run page header shows `Job <8-char>` and `COLAB` in the
  accelerator badge.
- Progress card shows `Epoch 0 / N` (or whatever epoch the runner has
  already reached if there was a delay).
- WS badge shows `ws · live`.

✅ Pass criterion: clean redirect, no error. ❌ Fail: *Couldn't reach
that Colab session* → likely you copied the URL before the cell
printed it; re-run cell 4 and re-paste. ❌ Fail: *invalid or missing
token* → URL was truncated; copy the full line.

### Step 5 — Verify live epoch events stream

**Action:** Watch `/train/run` for ~2 minutes (enough for at least one
epoch to complete on a small dataset).

**Expected:**

- Each Colab cell-output line that says `Epoch <n>/<N>` …
- … is matched on the desktop within **≤ 2 seconds** by:
  - The progress bar advancing.
  - A new point appearing in the loss / mAP (or top-1/top-5) chart.
  - A new line in the *Log* card.

✅ Pass criterion: ≤ 2 s metric latency. ❌ Fail: long lag → check
that the Colab cell is still running (free Colab can throttle); check
the desktop log for `connection` events suggesting a reconnect.

### Step 6 — Verify the reconnect banner (deliberate disconnect)

**Action:** In Colab, click the **Stop** button on cell 5 (the
training cell). The cell halts.

**Expected:**

- Within ~5 s, a yellow banner appears at the top of `/train/run`:
  > ☁ Reconnecting to Colab — attempt 1
  > Reconnecting to Colab (attempt 1, backing off 2s)…
- The banner cycles through attempts as backoff doubles (2s → 4s →
  8s …).
- The job stays in *running* status during reconnect attempts.

Now click **Restart** then **Run all** in Colab. Wait for cell 5 to
re-start.

**Expected:**

- The first thing to know: the new run has a NEW token, so the
  desktop reconnect will eventually FAIL with an auth error (see Step
  6b for the "token changed" path).
- After ~10–30 s, banner flips to red:
  > ☁ Lost connection to Colab
  > Colab session no longer accepts the token — the notebook cell
  > was restarted and a new token is live. Re-paste the new URL from
  > the cell.

✅ Pass criterion: banner cycles through attempts, then surfaces
the token-changed message clearly. ❌ Fail: banner says
"Reconnecting" indefinitely → reader thread isn't detecting auth
failures via pre-flight; check `_preflight` in
`server/vrl_yolo/engine/colab_reader.py`.

### Step 6b — Recover via re-paste

**Action:** Cell 5 printed a new URL. Copy it. The desktop run page
doesn't have a *Reconnect* button (P6c scope), so:

1. Click **Cancel** to end the current job cleanly.
2. Go back to `/train/configure`.
3. Click **Run on Colab** again.
4. Paste the new URL, click **Connect**.

**Expected:** Fresh job, fresh chart, live metrics resume from
wherever the new training run is at.

✅ Pass criterion: a clean second job with no lingering state from
the first. ❌ Fail: chart still shows old data → check
`useTrainStore().setActiveJob(newId)` is being called.

### Step 7 — Wait for training to complete

**Action:** Wait. Drink coffee. Let the run finish naturally.

**Expected:**

- Cell 5 prints `Training finished — exit code 0` (in Colab).
- Desktop status badge flips from *running* to *completed* within
  ~2 s.
- *Save to library* button activates.

✅ Pass criterion: clean completion. ❌ Fail: status stays *running*
forever → `complete` event isn't reaching the desktop; check
WS handshake and `colab_runner.py`'s `complete` emission.

### Step 8 — Save the trained model

**Action:** Click **Save to library**.

**Expected:**

- Button shows a spinner for ~5–15 s (best.pt download through tunnel).
- On success: a green confirmation, and a *Use in Predict* button
  appears.

**Verify on disk:**

```
$ ls "~/Library/Application Support/VRL-YOLO-GUI/models/<task>/"
trained-<8char>.pt
```

✅ Pass criterion: file exists, size > 1 MB. ❌ Fail: 409 error in
modal → the runner didn't emit `complete` properly. ❌ Fail: 401 →
token changed mid-save; re-connect.

### Step 9 — Use the trained model in Predict

**Action:** Click **Use in Predict**. On `/predict`, drop a single
image from your dataset.

**Expected:**

- Model dropdown defaults to the new `trained-<8char>.pt`.
- Inference runs successfully.
- For detect: bounding boxes overlay the image with reasonable
  confidence (≥ 0.3 for an in-distribution sample).
- For classify: top-1/top-5 prediction table shows the right class.

✅ Pass criterion: predictions look reasonable. ❌ Fail: model
loads but predictions are random → likely the training run was too
short; not a P6 bug.

---

## Pass criteria summary

| Step | What we're verifying |
|---|---|
| 1 | CPU callout shows |
| 2 | Connect modal + task-correct Colab URL |
| 3 | Notebook prints tunnel URL |
| 4 | Desktop accepts the URL → /train/run |
| 5 | Live metric streaming (≤2 s latency) |
| 6 | Reconnect-with-backoff banner |
| 6b | Token-changed recovery path |
| 7 | Clean *complete* terminal state |
| 8 | best.pt download + save-to-library |
| 9 | Trained model usable in Predict |

If steps 1–9 all pass, P6 is functionally done.

---

## Known not-tested-in-this-pilot

- **Network packet loss / latency variance.** A real clinic may have
  worse network than the developer's home wifi. If pilot users
  report frequent reconnects, raise `_BACKOFF_MAX_ATTEMPTS` in
  `colab_reader.py` (currently 20 ≈ 18 min) or extend the cap.
- **Long training runs (> 12 hours).** Free Colab kills sessions at
  12 hours. Long runs need a Pro subscription — out of scope for
  pilot.
- **Multiple concurrent Colab jobs.** The data model supports them;
  the UI only shows one. Out of scope (PLAN-P6.md §5).

---

## Troubleshooting recipe

| Symptom | First thing to check |
|---|---|
| Modal: *Tunnel URL is missing the ?token=…* | URL got truncated when copying; recopy the full line. |
| Modal: *Couldn't reach that Colab session* | Cell 4 hasn't finished yet OR the cell stopped. |
| Modal: *Tunnel rejected the token* | Cell was restarted; copy the new URL it printed. |
| Modal: *Tunnel responded but the payload didn't look like* | Wrong cloud service answered the URL — unlikely with `trycloudflare.com` but possible if a typo redirected to a different host. |
| Run page: indefinite reconnect banner | Network truly partitioned; check `ping trycloudflare.com`. |
| Run page: status frozen at *running* with no events | WS handshake failed silently; restart the desktop app. |
| Save to library: 409 | Training isn't complete (cell 5 still printing epochs). Wait. |
| Save to library: 401 | Cell was restarted between *complete* and *save*. Reconnect and try again. |
| best.pt downloads but model can't load in Predict | Probably a bug in the .pt itself, not in P6. Check Ultralytics version compatibility. |
