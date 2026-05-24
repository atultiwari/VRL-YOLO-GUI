# Partial Pilot Proposal — Predict-only

> Proposal drafted 2026-05-24 in response to the question "what should we
> implement next, post-F-chain?" Captured here so the decision + reasoning
> survives the session.
>
> **Status:** Proposal — not yet approved. Awaiting user sign-off on
> Phase 3 logistics decisions before any docs (PILOT-PARTIAL-PREDICT.md,
> PILOT-DEBRIEF-TEMPLATE.md) are written.
>
> **Author:** Claude session, 2026-05-24.

---

## Why this proposal exists

After v0.14.1 / F4.fix-1, the F-chain is complete and the project sits at
the P7 (Polish) phase boundary per `PLAN.md §14`. P7 is the planned next
phase. The pilot test (`docs/PILOT-TEST.md`, carry-forward #9) is the
v1.0 gate and the only HIGH-severity open item on the board.

The natural question is: ship P7 first (planned order) or jump to a
partial pilot now (Option C from carry-forward #9) and let pilot
feedback define P7's actual scope?

This doc proposes the **partial pilot path** and lays out exactly what
would happen if approved.

## Decision matrix that led here

| # | Option | Complexity | Severity addressed | Unlocks |
|---|---|---|---|---|
| A | **P7 Polish (planned)** | ~1 week | Medium — UX consistency, error states, in-app help, docs site, Roboflow walkthroughs | Pilot (P10) |
| B | **Partial pilot now, Predict-only** | 0 eng time + ~5 h docs | HIGH — closes v1.0 information gap on the most mature half of the app | Concrete P7 scope grounded in real feedback |
| C | F6 — Explainable AI | 1–2 weeks | Clinician trust, but flagged post-pilot in `docs/FUTURE-FEATURES.md` | Adoption story, not v1.0 |
| D | F7 — MCP integration | 3–5 days | Power-user reach, but post-pilot per same doc + needs security review | Cross-tool workflows |
| E | Pick off small carry-forwards (#4, #6, #8) | ~2–3 d each | Low–Medium individually | Marginal — premature without pilot data |

Recommendation: **Option B**. Reasoning:

1. **#9 is the only HIGH item.** Everything else is Medium or Low.
   Engineering more polish before validating the existing surface is
   risk-on without reason — 116 tests of code that no real clinician
   has touched.
2. **P7's scope is undefined.** `PLAN.md §14` explicitly says "scope
   TBD at the phase boundary." The honest definition of Polish requires
   knowing what hurts. Carry-forwards #5 (bulk ops), #6 (auto-save
   reach), and #8 (search) are all tagged "defer until pilot users name
   it" — building any of them blind risks shipping the wrong polish.
3. **Predict is the maturest half** (P1–P3b + F1 shipped; less F-chain
   churn). The 9-step `PILOT-TEST.md` can be cleanly bisected: steps 1,
   7, 8 (install → Predict → reports) form a 1–2 hour standalone run.
4. **Options C/D are user-deferred items.** Both notes in
   `docs/FUTURE-FEATURES.md` explicitly say "not the core 'drop a
   folder, get an answer' loop that v1 has to nail first." Re-opening
   that decision needs new evidence, not new code.

**Fallback if no clinician is bookable in ~2 weeks:** Option A (P7) with a
deliberately narrow scope — clinician-readable error states, the two
Roboflow walkthroughs, and the sidebar "unsaved runs" badge (CF #6
Option C). Not bulk ops, not global search, not XAI/MCP.

---

## What Option B looks like in execution

### Phase 0 — Pre-flight (1–2 h, agent time)

Before handing anything to a clinician, verify the v0.14.1 surface still
works from a cold start. The last full manual run of the Predict path
was during F4 dev.

- Download the latest `.dmg` from the public Releases page (do **not**
  use a local dev build — pilot must mirror clinician experience).
- Wipe `~/Library/Application Support/VRL-YOLO-GUI/` to simulate a fresh
  install.
- Walk steps 1, 7, 8 of `docs/PILOT-TEST.md` manually (install via
  `install.command` → predict on a sample folder → export PDF/XLSX/CSV).
- File anything that breaks as a P7-blocker carry-forward.

**Deliverable:** a one-paragraph "pre-flight passed" / "blockers found"
note posted back to the user. If anything is broken on the happy path,
the pilot does **not** go out — we fix first.

### Phase 1 — Pilot script (~2 h, agent time)

Write `docs/PILOT-PARTIAL-PREDICT.md` — a new doc, **not** a fork of
`PILOT-TEST.md` (keeps the v1.0 9-step checklist untouched for the
eventual full pilot).

**Target session length:** 60–90 minutes for the clinician.

**Scope (in order):**

1. Install from `.dmg` (time it; observe Gatekeeper friction).
2. Single-image detection on a bundled-model run.
3. Single-image classification on a bundled-model run.
4. Folder-batch on ~20 images, both tasks.
5. Export PDF + XLSX + CSV; open each in the native app.
6. Import a custom `.pt` (auto-detect task verification).
7. Browse `/models`, `/settings`, `/changelog`.

**Excluded deliberately:** Training, Colab, dataset library, training
history. That's the second half of v1.0 and gets its own pilot once
Predict feedback lands. Justification: F-chain shipped Train surfaces
are <5 days old in some places; let them settle while we get Predict
data.

**Per step the script captures:**

- Completed unaided? (Y/N)
- Time taken (stopwatch)
- Where they paused or asked a question
- Verbatim quotes (think-aloud protocol)

Plus a 5-minute open-ended question block at the end:

- What felt slow?
- What surprised you?
- Would you use this on a real case — if not, what's missing?

### Phase 2 — Debrief framework (~1 h, agent time)

Write `docs/PILOT-DEBRIEF-TEMPLATE.md`. Two sections:

- **Quantitative grid:** per-step completion + time, error counts, click
  counts where they matter.
- **Qualitative rank:** each pain point tagged with `(frequency ×
  clinical-impact)`. Anything ≥ Medium × Medium becomes mandatory P7
  scope; everything else gets logged to `docs/CARRY-FORWARDS.md`.

This is the part that converts vibes into a P7 plan with evidence. The
template exists so debrief day doesn't get improvised.

### Phase 3 — Logistics decisions (user)

Required before Phase 1 can start:

1. **Clinician.** Recruit from user's clinical network, or use someone
   already in hand?
2. **Dataset.** Clinician brings their own slide patches (most
   realistic, but PHI handling needed), OR we provide a public
   substitute (BCCD blood smear for detection, the existing
   `lung_colon_image_set/lung_partial` for classification).
   **Recommended: public substitute first** — eliminates a privacy
   conversation that could spook a first-time pilot user.
3. **Remote vs in-person.** In-person is better for think-aloud but
   harder to schedule. Zoom screen-share is a fine fallback.
4. **Recording.** Screen recording with consent — invaluable for
   catching the 30-second pause we wouldn't notice live.

### Phase 4 — Post-pilot synthesis (~1 h, agent time)

Write `docs/PLAN-P7.md` with scope justified by debrief evidence (not
agent guesses). User sign-off, then code. This is the part where Option
B pays back vs Option A: P7's scope is currently undefined, and pilot
data is the cheapest way to define it correctly.

---

## What the proposal explicitly will NOT do

- **No app instrumentation for the pilot.** Telemetry is off-by-default
  per `PLAN.md §15` for a reason — clinical data sensitivity. We watch
  in person.
- **No code changes to v0.14.1** unless Phase 0 finds a blocker.
- **No clinician timeline commitments from the agent side.** User owns
  the clinician schedule.
- **No mid-flight scope extension to Training**, even if Predict
  feedback is glowing. Keep the data clean; book a second pilot.

## Time budget

| Side | Time |
|---|---|
| Agent (Phases 0, 1, 2, 4) | ~5 hours over 2–3 days |
| User (review + booking) | ~2 hours |
| Clinician (session + debrief) | 60–90 min + ~30 min |

**Lead time** depends entirely on the clinician booking:

- Clinician already in hand → could run within a week.
- Need to recruit → 2–3 weeks.

## Open questions for the user

Answer these before Phase 0 starts:

1. Approve Option B over Option A?
2. Clinician in hand, or recruit?
3. Public substitute dataset for the session, or clinician's own data?
4. Remote (Zoom) or in-person?
5. Screen recording with consent: yes / no?

If the answer to (2) is "recruit" and the lead time looks >2 weeks, this
proposal flips to Option A (narrow P7) by default — getting the agent
unblocked is worth more than waiting on the perfect pilot slot.

---

## Cross-references

- `docs/PILOT-TEST.md` — the full 9-step v1.0 pilot. This proposal is a
  Predict-only subset (steps 1, 7, 8), not a replacement.
- `docs/CARRY-FORWARDS.md` §9 — the v1.0 pilot gate carry-forward. This
  proposal is "Option C" from §9's options list, executed.
- `docs/FUTURE-FEATURES.md` — XAI (#6) and MCP (#7) deferral rationale
  this proposal relies on.
- `PLAN.md` §14 — phase ordering this proposal deliberately reorders.
