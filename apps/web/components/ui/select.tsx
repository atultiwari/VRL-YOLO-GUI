"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  description?: string;
}

export interface SelectProps<T extends string = string> {
  label: string;
  value: T | undefined;
  options: SelectOption<T>[];
  onChange: (next: T) => void;
  placeholder?: string;
  className?: string;
  emptyText?: string;
  disabled?: boolean;
}

export function Select<T extends string = string>({
  label,
  value,
  options,
  onChange,
  placeholder = "Select…",
  className,
  emptyText = "No options",
  disabled,
}: SelectProps<T>) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label className="text-xs font-medium uppercase tracking-wide text-ink-muted">
        {label}
      </label>
      <select
        value={value ?? ""}
        disabled={disabled || options.length === 0}
        onChange={(e) => onChange(e.target.value as T)}
        className={cn(
          "h-10 w-full rounded-md border border-surface-muted bg-surface px-3 text-sm text-ink",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
          "disabled:cursor-not-allowed disabled:opacity-60",
        )}
      >
        {options.length === 0 ? (
          <option value="">{emptyText}</option>
        ) : (
          <>
            {value === undefined ? <option value="">{placeholder}</option> : null}
            {options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </>
        )}
      </select>
    </div>
  );
}
