"use client";

import { useMemo } from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { PresetInfo } from "@/lib/types";
import { cn } from "@/lib/utils";

export function PresetPicker({
  presets,
  selected,
  onSelect,
}: {
  presets: PresetInfo[];
  selected: string | undefined;
  onSelect: (preset: PresetInfo | null) => void;
}) {
  // Group by domain for the rendered sections — kept inside useMemo so the
  // grouping work doesn't redo itself on every slider/select change.
  const grouped = useMemo(() => {
    const map = new Map<string, PresetInfo[]>();
    for (const p of presets) {
      const k = p.domain;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(p);
    }
    return map;
  }, [presets]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Workflow preset</CardTitle>
        <CardDescription>
          Optional. Picks a sensible default model + threshold for a clinical task.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {[...grouped.entries()].map(([domain, items]) => (
          <div key={domain}>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">
              {domain}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {items.map((p) => {
                const isActive = selected === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => onSelect(isActive ? null : p)}
                    title={p.description}
                    className={cn(
                      "rounded-md border px-2.5 py-1 text-xs transition",
                      isActive
                        ? "border-accent bg-accent-subtle text-accent"
                        : "border-surface-muted bg-surface text-ink hover:border-accent",
                    )}
                  >
                    {p.label}
                    <span className="ml-1 text-ink-muted">·</span>
                    <span className="ml-1 capitalize text-ink-muted">{p.task}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
