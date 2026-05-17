"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Brain, Cpu, Gauge, Microscope, Play, Sparkles, Timer, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Dropzone } from "@/components/ui/dropzone";
import { Select } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Spinner } from "@/components/ui/spinner";
import { fetchModels, inferSingle } from "@/lib/api";
import { cn, formatBytes } from "@/lib/utils";
import type {
  ClassificationResponse,
  DetectionBox,
  DetectionResponse,
  InferenceResponse,
  Task,
} from "@/lib/types";

// Stable palette per class index — keeps colour consistent across runs
// and across confidence-slider re-renders, which matters when a doctor is
// eyeballing whether the same nucleus moved between two thresholds.
const PALETTE = [
  "#3b82f6", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899",
  "#14b8a6", "#f97316", "#0ea5e9", "#84cc16", "#f43f5e", "#a855f7",
  "#6366f1", "#22c55e", "#eab308", "#06b6d4", "#d946ef", "#84cc16",
];

function colourFor(classId: number): string {
  return PALETTE[classId % PALETTE.length];
}

function BoxOverlay({
  boxes,
  imageW,
  imageH,
}: {
  boxes: DetectionBox[];
  imageW: number;
  imageH: number;
}) {
  if (!boxes.length) return null;
  return (
    <svg
      viewBox={`0 0 ${imageW} ${imageH}`}
      preserveAspectRatio="xMidYMid meet"
      className="pointer-events-none absolute inset-0 size-full"
      aria-hidden="true"
    >
      {boxes.map((b, i) => {
        const [x1, y1, x2, y2] = b.xyxy;
        const stroke = colourFor(b.class_id);
        const w = x2 - x1;
        const h = y2 - y1;
        return (
          <g key={i}>
            <rect
              x={x1}
              y={y1}
              width={w}
              height={h}
              fill={stroke}
              fillOpacity={0.06}
              stroke={stroke}
              strokeWidth={Math.max(2, imageW * 0.0025)}
            />
            <rect
              x={x1}
              y={Math.max(0, y1 - imageH * 0.035)}
              width={Math.min(w, imageW * 0.4)}
              height={imageH * 0.035}
              fill={stroke}
              fillOpacity={0.95}
            />
            <text
              x={x1 + 8}
              y={Math.max(imageH * 0.026, y1 - 6)}
              fill="white"
              fontSize={imageH * 0.022}
              fontWeight={600}
              fontFamily="ui-sans-serif, system-ui, sans-serif"
            >
              {b.class_name} {(b.conf * 100).toFixed(0)}%
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function ResultBadges({ result }: { result: InferenceResponse }) {
  return (
    <div className="flex flex-col items-end gap-1">
      <Badge tone="clinical">
        <Cpu className="mr-1 size-3" />
        {result.accelerator.kind.toUpperCase()}
      </Badge>
      <Badge tone="subtle">
        <Timer className="mr-1 size-3" />
        {result.inference_ms.toFixed(0)} ms
      </Badge>
    </div>
  );
}

function DetectionPanel({ result }: { result: DetectionResponse }) {
  const counts = Object.entries(result.counts_per_class).sort((a, b) => b[1] - a[1]);
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="size-4 text-accent" />
              Detection results
            </CardTitle>
            <CardDescription>
              {result.boxes.length === 0
                ? "No objects above the current confidence threshold."
                : `${result.boxes.length} detection${result.boxes.length === 1 ? "" : "s"} across ${counts.length} class${counts.length === 1 ? "" : "es"}.`}
            </CardDescription>
          </div>
          <ResultBadges result={result} />
        </div>
      </CardHeader>
      <CardContent>
        {counts.length === 0 ? null : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-medium uppercase tracking-wide text-ink-muted">
                <th className="pb-2">Class</th>
                <th className="pb-2 text-right">Count</th>
                <th className="pb-2 text-right">Max conf</th>
              </tr>
            </thead>
            <tbody>
              {counts.map(([className, count]) => {
                const maxConf = Math.max(
                  ...result.boxes
                    .filter((b) => b.class_name === className)
                    .map((b) => b.conf),
                );
                const colour =
                  PALETTE[
                    (result.boxes.find((b) => b.class_name === className)?.class_id ?? 0) %
                      PALETTE.length
                  ];
                return (
                  <tr key={className} className="border-t border-surface-muted text-ink">
                    <td className="py-2.5">
                      <span className="flex items-center gap-2">
                        <span
                          className="size-2.5 rounded-full"
                          style={{ background: colour }}
                          aria-hidden="true"
                        />
                        {className}
                      </span>
                    </td>
                    <td className="py-2.5 text-right font-medium tabular-nums">{count}</td>
                    <td className="py-2.5 text-right tabular-nums text-ink-muted">
                      {(maxConf * 100).toFixed(1)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

function ClassificationPanel({
  result,
  reviewThreshold,
}: {
  result: ClassificationResponse;
  reviewThreshold: number;
}) {
  const needsReview = result.top1.conf < reviewThreshold;
  const chartData = result.top5.map((p) => ({
    name: p.class_name,
    value: p.conf,
    fill: colourFor(p.class_id),
  }));

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="size-4 text-accent" />
                Classification result
              </CardTitle>
              <CardDescription>
                Top-1 prediction over the model&apos;s {result.top5.length}-class output.
              </CardDescription>
            </div>
            <ResultBadges result={result} />
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-baseline gap-3">
            <span
              className="size-4 rounded-full"
              style={{ background: colourFor(result.top1.class_id) }}
              aria-hidden="true"
            />
            <h3 className="text-3xl font-semibold tracking-tight">
              {result.top1.class_name}
            </h3>
            <span className="text-2xl font-medium tabular-nums text-ink-muted">
              {(result.top1.conf * 100).toFixed(1)}%
            </span>
          </div>
          {needsReview ? (
            <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <AlertTriangle className="size-4" />
              Top-1 confidence is below the review threshold
              ({(reviewThreshold * 100).toFixed(0)}%) — flag for manual review.
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Top-5 alternatives</CardTitle>
          <CardDescription>
            Class probabilities from the softmax head. Sorted high → low.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[260px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chartData}
                layout="vertical"
                margin={{ top: 8, right: 32, left: 0, bottom: 8 }}
              >
                <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="oklch(92% 0 0)" />
                <XAxis
                  type="number"
                  domain={[0, 1]}
                  tickFormatter={(v) => `${Math.round(v * 100)}%`}
                  tick={{ fontSize: 12, fill: "oklch(48% 0 0)" }}
                  stroke="oklch(92% 0 0)"
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={140}
                  tick={{ fontSize: 12, fill: "oklch(18% 0 0)" }}
                  stroke="oklch(92% 0 0)"
                />
                <Tooltip
                  cursor={{ fill: "oklch(94% 0.04 250 / 0.5)" }}
                  formatter={(v: number) => `${(v * 100).toFixed(2)}%`}
                  labelFormatter={(name: string) => name}
                />
                <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                  {chartData.map((d, i) => (
                    <Cell key={i} fill={d.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function PredictPage() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<string | undefined>(undefined);
  const [conf, setConf] = useState(0.25);
  const [iou, setIou] = useState(0.45);
  const [result, setResult] = useState<InferenceResponse | null>(null);

  const { data, isLoading: modelsLoading } = useQuery({
    queryKey: ["models"],
    queryFn: fetchModels,
  });

  const allModels = data?.models ?? [];

  // Derive task from the currently selected model so the UI can switch
  // between detection-shaped and classification-shaped views.
  const selectedTask: Task | undefined = useMemo(
    () => allModels.find((m) => m.name === selectedModel)?.task,
    [allModels, selectedModel],
  );

  // Default-model selection: prefer the user's saved detect default; fall
  // back to the first model in the registry (either task).
  useEffect(() => {
    if (selectedModel || allModels.length === 0) return;
    const def = data?.defaults.detect ?? data?.defaults.classify;
    setSelectedModel(def ?? allModels[0]?.name);
  }, [data, allModels, selectedModel]);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const run = useMutation({
    mutationFn: async () => {
      if (!file || !selectedModel) throw new Error("file and model required");
      return inferSingle({ image: file, model: selectedModel, conf, iou });
    },
    onSuccess: (data) => setResult(data),
    onError: () => setResult(null),
  });

  const onDrop = (next: File) => {
    setFile(next);
    setResult(null);
  };

  const onClear = () => {
    setFile(null);
    setResult(null);
    run.reset();
  };

  const modelOptions = allModels.map((m) => {
    const taskTag = m.task === "detect" ? "detect" : "classify";
    return {
      value: m.name,
      label: `${m.name}  ·  ${taskTag}  ·  ${m.num_classes} cls  ·  ${formatBytes(m.size_mb)}`,
    };
  });

  const canRun = !!file && !!selectedModel && !run.isPending;
  const isClassify = selectedTask === "classify";

  // Result-derived metadata. For classify the SVG overlay is skipped
  // entirely; the image renders as-is and the panel shows top-1 / top-5.
  const resultImageSize = result?.image_size;
  const showOverlay = result?.task === "detect";

  return (
    <section className="flex h-full flex-col gap-8 px-12 py-12">
      <header>
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-ink-muted">
          Predict · Detection &amp; Classification
        </p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight">
          Run a model on a slide patch.
        </h1>
        <p className="mt-3 max-w-2xl text-ink-muted">
          Drop a single image, pick a YOLO model. The view auto-switches between
          object detection (boxes + counts) and image classification (top-1 +
          top-5). Folder batch and clinical reports arrive with P3.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[360px_1fr]">
        <aside className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {isClassify ? (
                  <Brain className="size-4 text-accent" />
                ) : (
                  <Microscope className="size-4 text-accent" />
                )}
                Model
              </CardTitle>
              <CardDescription>
                {isClassify
                  ? "Classification — full top-5 returned. Slider sets the review threshold."
                  : selectedTask === "detect"
                  ? "Detection — boxes filtered by confidence; IoU drives NMS."
                  : "Pick a detection or classification model to begin."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Select
                label="Model"
                value={selectedModel}
                options={modelOptions}
                onChange={setSelectedModel}
                placeholder={modelsLoading ? "Loading…" : "Pick a model"}
                emptyText="No models — run scripts/fetch-models.py"
              />
              <Slider
                label={isClassify ? "Review threshold" : "Confidence"}
                value={conf}
                min={0.05}
                max={0.95}
                step={0.01}
                onChange={setConf}
                hint={
                  isClassify
                    ? "Top-1 predictions below this score are flagged for manual review."
                    : "Boxes below this score are hidden from results."
                }
              />
              {isClassify ? null : (
                <Slider
                  label="IoU"
                  value={iou}
                  min={0.1}
                  max={0.95}
                  step={0.01}
                  onChange={setIou}
                  hint="Non-maximum-suppression threshold for overlapping boxes."
                />
              )}
              <div className="flex gap-2 pt-2">
                <Button className="flex-1" disabled={!canRun} onClick={() => run.mutate()}>
                  {run.isPending ? (
                    <>
                      <Spinner /> Running…
                    </>
                  ) : (
                    <>
                      <Play className="size-4" /> Run inference
                    </>
                  )}
                </Button>
                <Button variant="ghost" disabled={!file} onClick={onClear}>
                  <X className="size-4" />
                </Button>
              </div>
              {run.isError ? (
                <p className="text-xs text-red-700">
                  {run.error instanceof Error
                    ? run.error.message
                    : "Inference failed. Check the backend log."}
                </p>
              ) : null}
              <div className="flex items-center gap-2 border-t border-surface-muted pt-3 text-xs text-ink-muted">
                <Gauge className="size-3.5" />
                Sliders re-run on next click — live update lands in P3.
              </div>
            </CardContent>
          </Card>
        </aside>

        <div className="flex flex-col gap-4">
          {!previewUrl ? (
            <Dropzone onFile={onDrop} />
          ) : (
            <Card>
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle className="truncate">{file?.name}</CardTitle>
                    <CardDescription>
                      {result
                        ? `${result.image_size[0]} × ${result.image_size[1]} px · model ${result.model}`
                        : "Click ‘Run inference’ when ready."}
                    </CardDescription>
                  </div>
                  <Button variant="ghost" size="sm" onClick={onClear}>
                    <X className="size-4" /> Replace
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="relative inline-block max-h-[70vh] max-w-full overflow-hidden rounded-lg border border-surface-muted bg-black/3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={previewUrl}
                    alt={file?.name ?? "Selected patch"}
                    className="block max-h-[70vh] max-w-full object-contain"
                  />
                  {showOverlay && result && resultImageSize ? (
                    <BoxOverlay
                      boxes={(result as DetectionResponse).boxes}
                      imageW={resultImageSize[0]}
                      imageH={resultImageSize[1]}
                    />
                  ) : null}
                </div>
              </CardContent>
            </Card>
          )}

          {result?.task === "detect" ? <DetectionPanel result={result} /> : null}
          {result?.task === "classify" ? (
            <ClassificationPanel result={result} reviewThreshold={conf} />
          ) : null}
          {!result && previewUrl ? (
            <Card>
              <CardContent className={cn("py-10 text-center text-sm text-ink-muted")}>
                Ready when you are — click{" "}
                <span className="font-medium text-ink">Run inference</span> to send the image
                to{" "}
                <code className="rounded bg-surface-muted px-1.5 py-0.5 text-xs">
                  /api/inference/single
                </code>
                .
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </section>
  );
}
