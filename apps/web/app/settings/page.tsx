"use client";

import { Brain, Clock, RotateCcw, SlidersHorizontal } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatDate, resolveTimezone } from "@/lib/format-date";
import { useSettings } from "@/lib/settings";
import { cn } from "@/lib/utils";

function detectSystemTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function listIanaTimezones(): string[] {
  try {
    // Available in modern Chromium/QtWebEngine — returns ~420 zones.
    type IntlWithSupported = typeof Intl & {
      supportedValuesOf?: (key: string) => string[];
    };
    const fn = (Intl as IntlWithSupported).supportedValuesOf;
    if (fn) return fn("timeZone");
  } catch {
    /* fall through to the curated fallback */
  }
  // Conservative fallback if the environment is too old.
  return [
    "UTC",
    "Asia/Kolkata",
    "Asia/Tokyo",
    "Asia/Singapore",
    "Asia/Dubai",
    "Europe/London",
    "Europe/Berlin",
    "America/New_York",
    "America/Chicago",
    "America/Los_Angeles",
    "Australia/Sydney",
  ];
}

function TimezoneSection({
  timezone,
  onChange,
}: {
  timezone: string;
  onChange: (next: string) => void;
}) {
  const systemTz = useMemo(detectSystemTimezone, []);
  const zones = useMemo(listIanaTimezones, []);
  const usingSystem = timezone === "system";
  const [filter, setFilter] = useState("");

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return zones;
    return zones.filter((z) => z.toLowerCase().includes(q));
  }, [filter, zones]);

  const preview = formatDate(new Date(), {
    timeZone: resolveTimezone(timezone),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="size-4 text-accent" />
          Timezone
        </CardTitle>
        <CardDescription>
          Every date and time the app shows — training-run timestamps,
          changelog dates, the auto-generated run-name template — uses
          this zone. The current time in your selected zone is{" "}
          <span className="font-mono text-ink">{preview}</span>.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-surface-muted bg-surface p-3 transition hover:border-accent">
          <input
            type="radio"
            checked={usingSystem}
            onChange={() => onChange("system")}
            className="mt-1 size-4 accent-accent"
          />
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium text-ink">
              Use system timezone
            </span>
            <span className="text-xs text-ink-muted">
              Detected: <span className="font-mono">{systemTz}</span>
            </span>
          </div>
        </label>

        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-surface-muted bg-surface p-3 transition hover:border-accent">
          <input
            type="radio"
            checked={!usingSystem}
            onChange={() => onChange(timezone === "system" ? systemTz : timezone)}
            className="mt-1 size-4 accent-accent"
          />
          <div className="flex flex-1 flex-col gap-2">
            <span className="text-sm font-medium text-ink">
              Use a different timezone
            </span>
            <input
              type="text"
              placeholder="Filter zones (e.g. kolkata, london)"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              disabled={usingSystem}
              className="h-8 rounded-md border border-surface-muted bg-surface px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50"
            />
            <select
              value={usingSystem ? systemTz : timezone}
              onChange={(e) => onChange(e.target.value)}
              disabled={usingSystem}
              size={6}
              className="h-40 w-full rounded-md border border-surface-muted bg-surface font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50"
            >
              {filtered.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
          </div>
        </label>
      </CardContent>
    </Card>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 rounded-lg border border-surface-muted bg-surface p-4 transition hover:border-accent">
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium text-ink">{label}</span>
        <span className="text-xs text-ink-muted">{description}</span>
      </div>
      <span
        className={cn(
          "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition",
          checked ? "bg-accent" : "bg-surface-muted",
        )}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="sr-only"
        />
        <span
          className={cn(
            "inline-block size-5 transform rounded-full bg-surface shadow-sm transition",
            checked ? "translate-x-5" : "translate-x-0.5",
          )}
          aria-hidden="true"
        />
      </span>
    </label>
  );
}

export default function SettingsPage() {
  const { settings, setSetting, reset } = useSettings();

  return (
    <section className="flex h-full flex-col gap-8 px-12 py-12">
      <header>
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-ink-muted">
          Settings · preferences for this device
        </p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight">
          Tune the app to your workflow.
        </h1>
        <p className="mt-3 max-w-2xl text-ink-muted">
          These choices live in this device&apos;s local storage. Settings
          that need to follow a model or a report between machines (saved
          trained models, named report templates) live in the backend
          storage root, not here.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-6 max-w-3xl">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <SlidersHorizontal className="size-4 text-accent" />
              Predict
            </CardTitle>
            <CardDescription>
              Behaviour for the inference workspace.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <ToggleRow
              label="Show clinical workflow presets"
              description={
                "Adds the histopathology / hematology preset chips to /predict (mitosis, WBC differential, …). Hidden by default — the bundled COCO/ImageNet weights don't have clinical classes yet, so the presets prefill thresholds but the actual detections are still generic. Re-enable once you've imported a fine-tuned clinical checkpoint."
              }
              checked={settings.show_presets}
              onChange={(v) => setSetting("show_presets", v)}
            />
          </CardContent>
        </Card>

        <TimezoneSection
          timezone={settings.timezone}
          onChange={(v) => setSetting("timezone", v)}
        />

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Brain className="size-4 text-accent" />
              Train
            </CardTitle>
            <CardDescription>
              Defaults for the training workspace.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <ToggleRow
              label="Auto-save trained models to the library"
              description={
                "When a training run finishes, automatically copy best.pt into Models (with the run's name as the filename). Turn off if you'd rather review each run and save only the keepers — the Save to library button stays available on /train/run and the history detail page either way."
              }
              checked={settings.auto_save_trained_models}
              onChange={(v) => setSetting("auto_save_trained_models", v)}
            />
            <ToggleRow
              label="Auto-purge training runs older than 30 days"
              description={
                "When you open Training History, automatically delete rows whose Started date is more than 30 days ago. Library checkpoints stay in /models — only the history record and replay events are removed."
              }
              checked={settings.auto_purge_old_runs}
              onChange={(v) => setSetting("auto_purge_old_runs", v)}
            />
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button variant="secondary" size="sm" onClick={reset}>
            <RotateCcw className="size-4" />
            Reset to defaults
          </Button>
        </div>
      </div>
    </section>
  );
}
