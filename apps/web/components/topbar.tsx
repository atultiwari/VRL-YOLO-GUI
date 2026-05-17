export function Topbar() {
  return (
    <div className="flex h-full items-center justify-between px-6">
      <div className="flex items-center gap-3">
        <div className="size-7 rounded-md bg-accent" aria-hidden="true" />
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-semibold tracking-tight">VRL YOLO GUI</span>
          <span className="text-xs text-ink-muted">
            Histopathology · Hematology
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2 text-xs text-ink-muted">
        <span className="rounded-full bg-clinical-subtle px-2.5 py-1 font-medium text-clinical">
          v0.1.0 · scaffolding
        </span>
      </div>
    </div>
  );
}
