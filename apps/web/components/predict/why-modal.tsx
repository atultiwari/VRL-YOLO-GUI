"use client";

import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Spinner } from "@/components/ui/spinner";
import { ApiError, explainInference } from "@/lib/api";
import { useSettings } from "@/lib/settings";
import type {
  DetectionResponse,
  ExplainMode,
  InferenceResponse,
} from "@/lib/types";
import { cn } from "@/lib/utils";

export interface WhyModalProps {
  file: File;
  previewUrl: string;
  result: InferenceResponse;
  onClose: () => void;
}

/**
 * Eigen-CAM "Why?" overlay (F6a). Shows where the model responded most
 * strongly — class-agnostic, so this is NOT a claim that the class is
 * present in the highlighted region. Strength is a pure client-side
 * opacity slider over an alpha-masked heatmap PNG.
 */
export function WhyModal({ file, previewUrl, result, onClose }: WhyModalProps) {
  const isDetect = result.task === "detect";
  const boxes = isDetect ? (result as DetectionResponse).boxes : [];
  const hasBoxes = boxes.length > 0;

  // Detection defaults to per-box (D2); classify is always image-level.
  const [mode, setMode] = useState<ExplainMode>(
    isDetect && hasBoxes ? "box" : "image",
  );
  const [boxIndex, setBoxIndex] = useState(0);
  const { settings } = useSettings();
  const [opacity, setOpacity] = useState(settings.explain_default_opacity);
  // `useSettings` hydrates from localStorage in an effect, so the first
  // render sees the default. Adopt the saved opacity once it loads —
  // unless the user has already dragged the slider this session.
  const opacityTouched = useRef(false);
  useEffect(() => {
    if (!opacityTouched.current) setOpacity(settings.explain_default_opacity);
  }, [settings.explain_default_opacity]);
  const handleOpacity = (v: number) => {
    opacityTouched.current = true;
    setOpacity(v);
  };

  const effectiveBox = mode === "box" ? boxIndex : undefined;

  const explain = useQuery({
    queryKey: ["explain", file.name, file.size, result.model, mode, effectiveBox],
    queryFn: () =>
      explainInference({
        image: file,
        model: result.model,
        mode,
        boxIndex: effectiveBox,
      }),
    staleTime: Infinity,
    retry: false,
  });

  const stepBox = (delta: number) => {
    if (!hasBoxes) return;
    setBoxIndex((i) => (i + delta + boxes.length) % boxes.length);
  };

  const errorMessage =
    explain.error instanceof ApiError
      ? explain.error.message
      : explain.error instanceof Error
        ? explain.error.message
        : null;

  const data = explain.data;
  const activeBox = isDetect && mode === "box" ? boxes[boxIndex] : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <Card className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden">
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="size-4 text-accent" />
                Why? — model attention
              </CardTitle>
              <CardDescription>
                Eigen-CAM highlights where{" "}
                <span className="font-medium text-ink">{result.model}</span>{" "}
                responded most strongly. It shows <em>where the model looked</em>
                , not a claim that the class is located there.
              </CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
              <X className="size-4" />
            </Button>
          </div>
        </CardHeader>

        <CardContent className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
          {/* Overlay viewport */}
          <div className="relative mx-auto flex max-h-[55vh] items-center justify-center overflow-hidden rounded-lg border border-surface-muted bg-black/3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewUrl}
              alt={file.name}
              className="block max-h-[55vh] max-w-full object-contain"
            />
            {data ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`data:image/png;base64,${data.heatmap_png_b64}`}
                alt="Model attention heatmap"
                aria-hidden
                className="pointer-events-none absolute inset-0 h-full w-full object-contain transition-opacity"
                style={{ opacity }}
              />
            ) : null}
            {explain.isFetching ? (
              <div className="absolute inset-0 flex items-center justify-center bg-surface/60">
                <Spinner />
              </div>
            ) : null}
          </div>

          {errorMessage ? (
            <p className="flex items-center gap-2 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
              <AlertTriangle className="size-4 shrink-0" />
              {errorMessage}
            </p>
          ) : null}

          {data?.degraded ? (
            <p className="flex items-center gap-2 rounded-md bg-warning/10 px-3 py-2 text-xs text-warning-foreground">
              <AlertTriangle className="size-3.5 shrink-0" />
              Explanation layer auto-detected for this checkpoint — interpret
              with extra care.
            </p>
          ) : null}

          {/* Controls */}
          <div className="grid gap-4 sm:grid-cols-2">
            <Slider
              label="Heatmap opacity"
              value={opacity}
              min={0}
              max={1}
              step={0.01}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={handleOpacity}
            />

            {isDetect ? (
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">
                  Scope
                </span>
                <div className="flex items-center gap-1.5">
                  <ModeTab
                    active={mode === "box"}
                    disabled={!hasBoxes}
                    onClick={() => setMode("box")}
                  >
                    Per detection
                  </ModeTab>
                  <ModeTab active={mode === "image"} onClick={() => setMode("image")}>
                    Whole image
                  </ModeTab>
                </div>
              </div>
            ) : null}
          </div>

          {/* Per-box stepper */}
          {isDetect && mode === "box" && hasBoxes ? (
            <div className="flex items-center justify-between gap-3 rounded-md border border-surface-muted px-3 py-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => stepBox(-1)}
                aria-label="Previous detection"
              >
                <ChevronLeft className="size-4" />
              </Button>
              <div className="text-center text-sm">
                <span className="font-medium text-ink">
                  {activeBox?.class_name}
                </span>{" "}
                <span className="text-ink-muted">
                  · box {boxIndex + 1} of {boxes.length}
                  {activeBox ? ` · ${(activeBox.conf * 100).toFixed(1)}%` : ""}
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => stepBox(1)}
                aria-label="Next detection"
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
          ) : null}

          {isDetect && !hasBoxes ? (
            <p className="text-xs text-ink-muted">
              No detections on this image — showing the whole-image attention
              map instead.
            </p>
          ) : null}

          {/* Stats + provenance */}
          {data ? (
            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-t border-surface-muted pt-3 text-xs text-ink-muted">
              <span>
                Peak activation{" "}
                <span className="font-semibold tabular-nums text-ink">
                  {(data.peak * 100).toFixed(0)}%
                </span>{" "}
                · mean{" "}
                <span className="font-semibold tabular-nums text-ink">
                  {(data.mean * 100).toFixed(0)}%
                </span>
                {mode === "box" ? " (relative to image max)" : ""}
              </span>
              <span className="font-mono">
                {data.method} · {data.layer_used}
              </span>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function ModeTab({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
        active
          ? "bg-accent text-accent-foreground"
          : "bg-surface-muted text-ink-muted hover:text-ink",
        disabled && "cursor-not-allowed opacity-40 hover:text-ink-muted",
      )}
    >
      {children}
    </button>
  );
}
