"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * User-facing settings persisted to localStorage on the device the
 * binary is running on. Lightweight on purpose — anything that needs to
 * sync between devices or survive a reinstall (saved trained models,
 * named report templates) belongs in the backend's storage_root, not
 * here.
 *
 * Growing this shape over time:
 *   1. Add the new key + default below.
 *   2. Append a row to `apps/web/app/settings/page.tsx`.
 *   3. Bump nothing — localStorage rehydration tolerates new keys via
 *      `mergeWithDefaults` so existing users keep their old settings.
 */
export interface AppSettings {
  /**
   * Clinical workflow presets in /predict.
   *
   * Hidden by default through P3b because the bundled COCO/ImageNet
   * weights don't have clinical class names — picking a preset like
   * "Mitosis detection" prefills sensible knobs but the actual
   * detections are still COCO classes, which is misleading for
   * doctors. Revisit once we ship fine-tuned demo checkpoints (tracked
   * in memory: project_presets_revisit, deferred to P10).
   */
  show_presets: boolean;

  /**
   * Preferred timezone for every UI timestamp render (F2 §9).
   *
   * Special value `"system"` (default) means use whatever
   * `Intl.DateTimeFormat().resolvedOptions().timeZone` reports —
   * usually the OS-level zone. Any other value should be a valid
   * IANA zone name (e.g. `"Asia/Kolkata"`, `"UTC"`,
   * `"America/New_York"`) — the same set `Intl.supportedValuesOf
   * ("timeZone")` returns.
   *
   * Every formatDate/formatRelative call in apps/web/lib/format-date.ts
   * reads this setting; the run-name placeholder on /train/configure
   * also reads it so the default name reflects the user's wall clock.
   */
  timezone: string;
}

const DEFAULTS: AppSettings = {
  show_presets: false,
  timezone: "system",
};

const STORAGE_KEY = "vrl-yolo-gui.settings.v1";

function mergeWithDefaults(raw: unknown): AppSettings {
  if (!raw || typeof raw !== "object") return { ...DEFAULTS };
  const obj = raw as Record<string, unknown>;
  const out: AppSettings = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS) as (keyof AppSettings)[]) {
    if (key in obj && typeof obj[key] === typeof DEFAULTS[key]) {
      // @ts-expect-error — narrowed to matching primitive types above
      out[key] = obj[key];
    }
  }
  return out;
}

function readFromStorage(): AppSettings {
  if (typeof window === "undefined") return { ...DEFAULTS };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    return mergeWithDefaults(JSON.parse(raw));
  } catch {
    return { ...DEFAULTS };
  }
}

function writeToStorage(next: AppSettings): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* quota / privacy mode — defaults will resurface on next read */
  }
}

const STORAGE_EVENT = "vrl-yolo-gui.settings.changed";

export function useSettings(): {
  settings: AppSettings;
  setSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  reset: () => void;
} {
  // SSR-safe: server render starts with defaults, then we hydrate from
  // localStorage in a useEffect to keep the initial paint stable.
  const [settings, setSettingsState] = useState<AppSettings>(DEFAULTS);

  useEffect(() => {
    setSettingsState(readFromStorage());
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<AppSettings>).detail;
      if (detail) setSettingsState(detail);
    };
    window.addEventListener(STORAGE_EVENT, onChange);
    // Also pick up writes from another tab — relevant in web mode, not
    // really in the Pyloid window since it's single-process.
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setSettingsState(readFromStorage());
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(STORAGE_EVENT, onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const setSetting = useCallback(
    <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
      setSettingsState((prev) => {
        const next: AppSettings = { ...prev, [key]: value };
        writeToStorage(next);
        // Fan-out to other instances of the hook in this same window
        // (e.g. sidebar + page) so they update without waiting for a
        // re-render cycle.
        window.dispatchEvent(new CustomEvent(STORAGE_EVENT, { detail: next }));
        return next;
      });
    },
    [],
  );

  const reset = useCallback(() => {
    writeToStorage(DEFAULTS);
    window.dispatchEvent(new CustomEvent(STORAGE_EVENT, { detail: { ...DEFAULTS } }));
    setSettingsState({ ...DEFAULTS });
  }, []);

  return { settings, setSetting, reset };
}

export const SETTINGS_DEFAULTS = DEFAULTS;
