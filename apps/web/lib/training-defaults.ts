"use client";

/**
 * Client-side mirror of `server/vrl_yolo/engine/training.py::_default_run_name`.
 *
 * Used by `/train/configure` to render the live placeholder for the
 * Name field — so the user sees the *exact* string the server will
 * store if they leave Name blank. UI-driven calls always send a
 * non-empty name (the placeholder text gets promoted to the value
 * on submit), so the server's fallback only fires for direct API
 * callers.
 *
 * Format: `<Task> · <dataset-id-stub> · YYYY-MM-DD HH:MM` in the
 * user's preferred TZ (settings.timezone). When task or dataset
 * change, the placeholder rebuilds — the configure page useMemos
 * on those + a "current minute" ticker.
 */

import type { Task } from "@/lib/types";
import { formatTrainingTimestamp, getPreferredTimezone } from "@/lib/format-date";

export function defaultRunName(
  task: Task,
  datasetId: string,
  when: Date = new Date(),
  opts: { timeZone?: string } = {},
): string {
  const taskLabel = task === "detect" ? "Detect" : "Classify";
  const stub = datasetId.slice(0, 8);
  const tz = opts.timeZone ?? getPreferredTimezone();
  const ts = formatTrainingTimestamp(when, { timeZone: tz });
  return `${taskLabel} · ${stub} · ${ts}`;
}
