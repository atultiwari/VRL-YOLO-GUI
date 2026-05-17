"use client";

import { AlertTriangle, Cpu, ImageOff, Sparkles, Timer } from "lucide-react";
import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
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
import { BoxOverlay } from "@/components/predict/single-view";
import type { BatchResultItem } from "@/lib/batch";
import { colourFor } from "@/lib/predict-palette";
import type { ClassificationResponse, DetectionResponse } from "@/lib/types";

export interface BatchPreviewProps {
  file: File | undefined;
  item: BatchResultItem | undefined;
  reviewThreshold: number;
}

/**
 * Preview pane for the folder-batch table. Renders the image at the
 * currently-selected row plus a task-aware result summary:
 *
 * - Detection → image + SVG box overlay + counts table.
 * - Classification → image as-is + top-1 banner + top-5 mini bar chart.
 *
 * Lifecycle: a fresh object URL is minted from the File and revoked on
 * unmount / re-selection, so we don't leak blobs as the user clicks
 * through dozens of rows in a row.
 */
export function BatchPreview({ file, item, reviewThreshold }: BatchPreviewProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  if (!item || !file) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center gap-2 py-10 text-center text-sm text-ink-muted">
          <ImageOff className="size-6" />
          Click any row in the table below to preview its predictions.
        </CardContent>
      </Card>
    );
  }

  if (!item.result) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="size-4 text-red-700" />
            {item.filename}
          </CardTitle>
          <CardDescription>Inference failed for this file.</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-red-700">{item.error}</CardContent>
      </Card>
    );
  }

  const r = item.result;
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 truncate">
              <Sparkles className="size-4 text-accent" />
              <span className="truncate font-mono text-sm">{item.filename}</span>
            </CardTitle>
            <CardDescription>
              {r.image_size[0]} × {r.image_size[1]} px · model {r.model}
            </CardDescription>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Badge tone="clinical">
              <Cpu className="mr-1 size-3" />
              {r.accelerator.kind.toUpperCase()}
            </Badge>
            <Badge tone="subtle">
              <Timer className="mr-1 size-3" />
              {r.inference_ms.toFixed(0)} ms
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="relative inline-block max-h-[50vh] max-w-full overflow-hidden rounded-lg border border-surface-muted bg-black/3">
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewUrl}
              alt={item.filename}
              className="block max-h-[50vh] max-w-full object-contain"
            />
          ) : null}
          {r.task === "detect" ? (
            <BoxOverlay
              boxes={(r as DetectionResponse).boxes}
              imageW={r.image_size[0]}
              imageH={r.image_size[1]}
            />
          ) : null}
        </div>

        {r.task === "detect" ? (
          <DetectMini result={r} />
        ) : (
          <ClassifyMini result={r} reviewThreshold={reviewThreshold} />
        )}
      </CardContent>
    </Card>
  );
}

function DetectMini({ result }: { result: DetectionResponse }) {
  const counts = Object.entries(result.counts_per_class).sort((a, b) => b[1] - a[1]);
  if (counts.length === 0) {
    return (
      <p className="text-sm text-ink-muted">
        No objects above the confidence threshold.
      </p>
    );
  }
  return (
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
            ...result.boxes.filter((b) => b.class_name === className).map((b) => b.conf),
          );
          const colour = colourFor(
            result.boxes.find((b) => b.class_name === className)?.class_id ?? 0,
          );
          return (
            <tr key={className} className="border-t border-surface-muted text-ink">
              <td className="py-2">
                <span className="flex items-center gap-2">
                  <span
                    className="size-2 rounded-full"
                    style={{ background: colour }}
                    aria-hidden="true"
                  />
                  {className}
                </span>
              </td>
              <td className="py-2 text-right font-medium tabular-nums">{count}</td>
              <td className="py-2 text-right tabular-nums text-ink-muted">
                {(maxConf * 100).toFixed(1)}%
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function ClassifyMini({
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
    <div className="space-y-3">
      <div className="flex items-baseline gap-3">
        <span
          className="size-3 rounded-full"
          style={{ background: colourFor(result.top1.class_id) }}
          aria-hidden="true"
        />
        <h3 className="text-xl font-semibold tracking-tight">{result.top1.class_name}</h3>
        <span className="text-lg font-medium tabular-nums text-ink-muted">
          {(result.top1.conf * 100).toFixed(1)}%
        </span>
        {needsReview ? (
          <Badge tone="warning">below review threshold</Badge>
        ) : null}
      </div>
      <div className="h-[140px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ top: 4, right: 24, left: 0, bottom: 0 }}
          >
            <XAxis
              type="number"
              domain={[0, 1]}
              tickFormatter={(v) => `${Math.round(v * 100)}%`}
              tick={{ fontSize: 10, fill: "oklch(48% 0 0)" }}
              stroke="oklch(92% 0 0)"
            />
            <YAxis
              type="category"
              dataKey="name"
              width={120}
              tick={{ fontSize: 11, fill: "oklch(18% 0 0)" }}
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
    </div>
  );
}
