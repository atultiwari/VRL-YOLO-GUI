# F6b Plan — XAI part 2: Settings + Models "Test explanation"

> Second slice of Future Feature #6. Builds directly on F6a's Eigen-CAM
> engine + `WhyModal` (see [`docs/PLAN-F6a.md`](PLAN-F6a.md)). **Frontend
> only — no backend change** (the `POST /api/inference/explain` endpoint
> from F6a is reused as-is).

---

## 0. Scope decision (made autonomously 2026-06-06)

The original F6b sketch (PLAN-F6a §9) bundled four things: settings,
Models "Test explanation" CTA, **report (PDF/XLSX) overlay embedding**,
and **folder-batch explanations**. The report piece is a PDF two-up
**layout reflow** in `server/vrl_yolo/engine/reports.py` plus generating
CAMs for ≤12 sample images client-side — the one part of F6 that
genuinely benefits from a human eyeballing the rendered PDF. Shipping
that blind, in a build the user will only test as a packaged app, is the
wrong risk.

**So F6b is re-scoped to the two low-risk, high-value pieces that reuse
F6a directly and are fully verifiable by `tsc` + build:**

1. **Settings → Explanations section** — a default heatmap-opacity the
   `WhyModal` reads as its initial value.
2. **Models → "Test explanation"** — pick any image, run it through a
   library model, and see the Eigen-CAM overlay. Lets a clinician
   sanity-check that a freshly-trained model looks at the right features
   *before* trusting it on real cases.

**Deferred to F6c** (needs visual review): report overlay embedding
(PDF side-by-side + XLSX thumbnail column) and folder-batch explanations
(`?explain=true` + the "+~Ns to the batch" estimate). The "include
explanations in reports by default" setting lands with F6c, next to the
feature it controls.

---

## 1. Settings → Explanations

- New `AppSettings` key `explain_default_opacity: number` (default
  `0.55`) in `apps/web/lib/settings.ts`. `mergeWithDefaults` already
  tolerates new numeric keys, so existing users rehydrate cleanly.
- New **Explanations** card in `app/settings/page.tsx` (after Train) with
  a `Slider` (0–100%). Copy notes the method is Eigen-CAM (class-agnostic
  — shows *where* the model looked) and that per-image opacity can still
  be nudged live in the Why? modal.
- `WhyModal` initializes its `opacity` state from
  `settings.explain_default_opacity` (via `useSettings`) instead of the
  hard-coded `0.55`. The in-modal slider still overrides per view.

## 2. Models → "Test explanation"

- New `components/models/test-explanation-modal.tsx`:
  - A `Dropzone` to pick a test image (reuses the predict primitive).
  - On file → `useMutation(inferSingle({ image, model: model.name }))`
    to (a) confirm the model runs and (b) get detection boxes for
    per-box explanation.
  - On success → render F6a's `WhyModal` with `(file, previewUrl,
    result)`. Inference failure shows a clinician-readable error; the
    user can swap the image and retry.
- `app/models/page.tsx`: a **Test** button (`Sparkles` icon) in each
  card's `CardFooter`, opening the modal for that model. Available on
  every card (bundled + trained) — testing is read-only.

## 3. Out of scope / non-goals (F6b)

- No backend changes; no new dependency; no new API.
- No report integration (→ F6c), no batch explanations (→ F6c).
- No new per-class behaviour (Eigen-CAM is class-agnostic — unchanged
  from F6a).

## 4. Tests / verification

Frontend-only, so — like F5 — verification is `tsc --noEmit` clean +
`pnpm build` (static export) green; backend suite unchanged at **130**.
Manual: open `/models`, Test a bundled model on a sample image, confirm
the overlay renders and the opacity default matches Settings. (User will
exercise this in the packaged build.)

## 5. Phase boundary

- Version → `0.16.0`; tag `v0.16-f6b-explain-models`.
- changelog.ts (flip F6a → shipped, add F6b current) + CHANGELOG.md +
  PHASE-STATUS.md + CLAUDE.md status; SHA-backfill follow-up commit.
- P7 Polish tag shifts to `v0.18-p7-polish` (F6a=0.15, F6b=0.16,
  F6c=0.17).
