"use client";

import { AlertTriangle, Cpu, Sparkles, Timer } from "lucide-react";
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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PALETTE, colourFor } from "@/lib/predict-palette";
import type {
  ClassificationResponse,
  DetectionBox,
  DetectionResponse,
  InferenceResponse,
} from "@/lib/types";

export function BoxOverlay({
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

export function ResultBadges({ result }: { result: InferenceResponse }) {
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

export function SingleDetectionPanel({ result }: { result: DetectionResponse }) {
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

export function SingleClassificationPanel({
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
