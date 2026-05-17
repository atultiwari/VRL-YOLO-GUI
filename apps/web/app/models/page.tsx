export default function ModelsPage() {
  return (
    <section className="flex h-full flex-col px-12 py-16">
      <p className="text-sm font-medium uppercase tracking-[0.2em] text-ink-muted">
        Models · Phase 1
      </p>
      <h1 className="mt-3 text-4xl font-semibold tracking-tight">
        Model library.
      </h1>
      <p className="mt-4 max-w-2xl text-ink-muted">
        Eight bundled starter weights — YOLO26 detection and classification
        (nano + small) as defaults, plus YOLOv8 fallbacks. Import any
        custom <code className="rounded bg-surface-muted px-1 py-0.5 text-xs">.pt</code>{" "}
        file once P3 lands.
      </p>
      <div className="mt-10 rounded-xl border border-dashed border-surface-muted p-10 text-center text-sm text-ink-muted">
        Coming up: model cards grouped by task, default-per-task toggle, import button.
      </div>
    </section>
  );
}
