"use client";

import { Spinner } from "@/components/ui/spinner";
import { useLiveVersion } from "@/lib/hooks";

export function Topbar() {
  const { version, release, isLoading, isError } = useLiveVersion();

  // Topbar pill shows the live binary version + the matching phase title
  // from the changelog. Hardcoding the version (which we did through P2)
  // bites the moment we ship a new release — the source of truth has to
  // be `/api/health`.
  const phaseLabel = release?.title?.toLowerCase();
  const pillContent = isLoading
    ? (
        <span className="inline-flex items-center gap-1.5">
          <Spinner className="size-3" /> connecting…
        </span>
      )
    : isError || !version
    ? "backend offline"
    : phaseLabel
    ? `v${version} · ${phaseLabel}`
    : `v${version}`;

  const offline = isError || (!isLoading && !version);

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
        <span
          className={
            offline
              ? "rounded-full bg-red-100 px-2.5 py-1 font-medium text-red-700"
              : "rounded-full bg-clinical-subtle px-2.5 py-1 font-medium text-clinical"
          }
        >
          {pillContent}
        </span>
      </div>
    </div>
  );
}
