"use client";

import { RotateCcw, SlidersHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useSettings } from "@/lib/settings";
import { cn } from "@/lib/utils";

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
