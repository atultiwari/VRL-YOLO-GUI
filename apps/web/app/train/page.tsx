export default function TrainPage() {
  return (
    <section className="flex h-full flex-col px-12 py-16">
      <p className="text-sm font-medium uppercase tracking-[0.2em] text-ink-muted">
        Train · Phase 4–6
      </p>
      <h1 className="mt-3 text-4xl font-semibold tracking-tight">
        Fine-tune YOLO on your dataset.
      </h1>
      <p className="mt-4 max-w-2xl text-ink-muted">
        Detection wizard lands in P4, classification in P5, Colab in P6. The
        dataset wizard will auto-detect Roboflow YOLO (detection) and folder-
        structure (classification) exports.
      </p>
      <div className="mt-10 rounded-xl border border-dashed border-surface-muted p-10 text-center text-sm text-ink-muted">
        Coming up: task picker, dataset drop, configure page, live training curves.
      </div>
    </section>
  );
}
