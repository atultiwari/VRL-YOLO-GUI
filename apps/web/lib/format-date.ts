"use client";

/**
 * Centralised date / time formatting (F2 §9).
 *
 * The user's preferred timezone lives in `useSettings().timezone`
 * (defaults to `"system"` — use the OS-level zone the browser
 * reports). All UI timestamp renders route through these helpers so
 * a setting change repaints everything at once.
 *
 * Server timestamps remain UTC on the wire (ISO 8601 with `Z` or
 * `+00:00`). These helpers convert at display time only.
 */

import { useSettings } from "@/lib/settings";

const SYSTEM = "system" as const;

/** Resolve the effective IANA zone for a given setting value. */
export function resolveTimezone(setting: string | undefined): string {
  if (!setting || setting === SYSTEM) {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
      return "UTC";
    }
  }
  return setting;
}

/**
 * Get the user's currently-preferred zone. Plain function so callers
 * outside React (e.g. the `defaultRunName` helper) can use it without
 * a hook. Components that need to re-render on TZ change should use
 * the `usePreferredTimezone` hook instead.
 */
export function getPreferredTimezone(): string {
  if (typeof window === "undefined") return resolveTimezone(SYSTEM);
  try {
    const raw = window.localStorage.getItem("vrl-yolo-gui.settings.v1");
    if (!raw) return resolveTimezone(SYSTEM);
    const parsed = JSON.parse(raw) as { timezone?: string };
    return resolveTimezone(parsed.timezone);
  } catch {
    return resolveTimezone(SYSTEM);
  }
}

/**
 * React hook: returns the resolved IANA zone, re-rendering when the
 * user changes the setting. Components that show timestamps should
 * call this once to subscribe to TZ changes.
 */
export function usePreferredTimezone(): string {
  const { settings } = useSettings();
  return resolveTimezone(settings.timezone);
}

export interface FormatDateOptions {
  dateStyle?: Intl.DateTimeFormatOptions["dateStyle"];
  timeStyle?: Intl.DateTimeFormatOptions["timeStyle"];
  /** One-off timezone override, bypassing the user setting. */
  timeZone?: string;
}

function _toDate(
  value: string | Date | number | null | undefined,
): Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Format an ISO 8601 / Date / epoch-ms value in the user's preferred
 * timezone. Returns "—" for null / undefined / unparseable input so
 * render sites can use this directly without null guards.
 *
 * Default style is `{dateStyle: 'medium', timeStyle: 'short'}` —
 * e.g. "May 21, 2026, 8:30 PM" in en-US, "21 May 2026, 20:30" in
 * en-GB. Use `formatTrainingTimestamp` for the F2-default
 * "YYYY-MM-DD HH:MM" shape used in the run-name template.
 */
export function formatDate(
  value: string | Date | number | null | undefined,
  opts: FormatDateOptions = {},
): string {
  const d = _toDate(value);
  if (!d) return "—";
  const tz = opts.timeZone ?? getPreferredTimezone();
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: opts.dateStyle ?? "medium",
      timeStyle: opts.timeStyle ?? "short",
      timeZone: tz,
    }).format(d);
  } catch {
    return d.toISOString();
  }
}

/**
 * Format `YYYY-MM-DD HH:MM` in the chosen timezone — the shape the
 * run-name template uses. Locale-independent (so the user's run
 * name doesn't change shape across en-US / en-GB / en-IN).
 */
export function formatTrainingTimestamp(
  value: string | Date | number,
  opts: { timeZone?: string } = {},
): string {
  const d = _toDate(value);
  if (!d) return "";
  const tz = opts.timeZone ?? getPreferredTimezone();
  // Use sv-SE locale: it's the ISO 8601-friendly locale that
  // produces "2026-05-21 20:30" natively. The TZ parameter handles
  // the zone conversion; locale only picks the textual layout.
  try {
    const parts = new Intl.DateTimeFormat("sv-SE", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: tz,
    }).formatToParts(d);
    const get = (t: string): string =>
      parts.find((p) => p.type === t)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
  } catch {
    return d.toISOString();
  }
}

/**
 * Compact relative formatter ("just now", "3 min ago", "2h ago",
 * "yesterday", "May 19"). Timezone-agnostic — the difference is the
 * same regardless of zone — but exposed here so callers have a
 * one-stop date-format import.
 */
export function formatRelative(
  value: string | Date | number | null | undefined,
  now: Date = new Date(),
): string {
  const d = _toDate(value);
  if (!d) return "—";
  const deltaMs = now.getTime() - d.getTime();
  const deltaS = Math.round(deltaMs / 1000);
  if (deltaS < 0) return "in the future";
  if (deltaS < 5) return "just now";
  if (deltaS < 60) return `${deltaS}s ago`;
  const deltaMin = Math.floor(deltaS / 60);
  if (deltaMin < 60) return `${deltaMin} min ago`;
  const deltaH = Math.floor(deltaMin / 60);
  if (deltaH < 24) return `${deltaH}h ago`;
  const deltaD = Math.floor(deltaH / 24);
  if (deltaD === 1) return "yesterday";
  if (deltaD < 7) return `${deltaD}d ago`;
  // For older dates, fall through to a compact absolute format in
  // the user's preferred TZ.
  return formatDate(d, { dateStyle: "medium" });
}

/**
 * Format a duration in seconds as "Xm Ys" / "Xh Ym Zs" — used for
 * the "Elapsed" label on /train/run. Locale-/TZ-agnostic.
 */
export function formatElapsed(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}
