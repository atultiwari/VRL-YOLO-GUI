import * as React from "react";
import { cn } from "@/lib/utils";

type Tone =
  | "neutral"
  | "accent"
  | "clinical"
  | "warning"
  | "danger"
  | "subtle";

const TONE: Record<Tone, string> = {
  neutral: "bg-surface-subtle text-ink-muted",
  accent: "bg-accent-subtle text-accent",
  clinical: "bg-clinical-subtle text-clinical",
  warning: "bg-amber-100 text-amber-900",
  danger: "bg-red-100 text-red-700",
  subtle: "bg-surface-muted text-ink",
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
}

export function Badge({ className, tone = "neutral", ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium",
        TONE[tone],
        className,
      )}
      {...rest}
    />
  );
}
