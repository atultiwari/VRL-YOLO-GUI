"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
  onChange: (next: number) => void;
  className?: string;
  hint?: string;
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 0.01,
  format,
  onChange,
  className,
  hint,
}: SliderProps) {
  const display = format ? format(value) : value.toFixed(2);

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-baseline justify-between">
        <label className="text-xs font-medium uppercase tracking-wide text-ink-muted">
          {label}
        </label>
        <span className="text-sm font-semibold tabular-nums text-ink">{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={cn(
          "h-1.5 w-full cursor-pointer appearance-none rounded-full bg-surface-muted",
          "accent-accent",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
        )}
      />
      {hint ? <span className="text-xs text-ink-muted">{hint}</span> : null}
    </div>
  );
}
