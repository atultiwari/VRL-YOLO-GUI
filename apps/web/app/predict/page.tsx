export default function PredictPage() {
  return (
    <section className="flex h-full flex-col px-12 py-16">
      <p className="text-sm font-medium uppercase tracking-[0.2em] text-ink-muted">
        Predict · Phase 1
      </p>
      <h1 className="mt-3 text-4xl font-semibold tracking-tight">
        Run a model on slide patches.
      </h1>
      <p className="mt-4 max-w-2xl text-ink-muted">
        Detection lands in P1 (single image), classification in P2, and folder
        batch + clinical reports in P3. The view here will switch automatically
        based on the selected model&apos;s task.
      </p>
      <div className="mt-10 rounded-xl border border-dashed border-surface-muted p-10 text-center text-sm text-ink-muted">
        Coming up: drop zone, model picker, confidence sliders, results canvas.
      </div>
    </section>
  );
}
