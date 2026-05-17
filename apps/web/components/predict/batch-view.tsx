"use client";

import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { BatchAggregate, BatchResultItem } from "@/lib/batch";
import { colourFor } from "@/lib/predict-palette";
import { cn } from "@/lib/utils";

export interface BatchTableProps {
  items: BatchResultItem[];
  reviewThreshold: number;
  selectedIndex: number | null;
  onSelect: (index: number) => void;
  /** Slot rendered in the card header, typically export buttons. */
  toolbar?: ReactNode;
}

export function BatchTable({
  items,
  reviewThreshold,
  selectedIndex,
  onSelect,
  toolbar,
}: BatchTableProps) {
  if (!items.length) return null;
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Per-image results</CardTitle>
            <CardDescription>
              {items.length} image{items.length === 1 ? "" : "s"} processed. Click a row
              to preview its predictions above.
            </CardDescription>
          </div>
          {toolbar}
        </div>
      </CardHeader>
      <CardContent>
        <div className="max-h-[420px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface">
              <tr className="text-left text-xs font-medium uppercase tracking-wide text-ink-muted">
                <th className="pb-2">File</th>
                <th className="pb-2">Top result</th>
                <th className="pb-2 text-right">Conf / count</th>
                <th className="pb-2 text-right">ms</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const isSelected = item.index === selectedIndex;
                const baseRowClass = cn(
                  "cursor-pointer border-t border-surface-muted text-ink transition-colors",
                  isSelected
                    ? "bg-accent-subtle/70 hover:bg-accent-subtle"
                    : "hover:bg-surface-subtle",
                );
                if (!item.result) {
                  return (
                    <tr
                      key={item.index}
                      onClick={() => onSelect(item.index)}
                      className={baseRowClass}
                    >
                      <td className="py-2 pr-3 font-mono text-xs">{item.filename}</td>
                      <td className="py-2 text-red-700" colSpan={3}>
                        {item.error ?? "failed"}
                      </td>
                    </tr>
                  );
                }
                const r = item.result;
                if (r.task === "detect") {
                  const total = r.boxes.length;
                  const top = Object.entries(r.counts_per_class).sort(
                    (a, b) => b[1] - a[1],
                  )[0];
                  return (
                    <tr
                      key={item.index}
                      onClick={() => onSelect(item.index)}
                      className={baseRowClass}
                    >
                      <td className="py-2 pr-3 font-mono text-xs">{item.filename}</td>
                      <td className="py-2">
                        {total === 0 ? (
                          <span className="text-ink-muted">no detections</span>
                        ) : (
                          <span className="flex items-center gap-2">
                            <span
                              className="size-2 rounded-full"
                              style={{
                                background: colourFor(
                                  r.boxes.find((b) => b.class_name === top![0])?.class_id ??
                                    0,
                                ),
                              }}
                            />
                            {top![0]}
                          </span>
                        )}
                      </td>
                      <td className="py-2 text-right tabular-nums">{total} boxes</td>
                      <td className="py-2 text-right tabular-nums text-ink-muted">
                        {r.inference_ms.toFixed(0)}
                      </td>
                    </tr>
                  );
                }
                // classify
                const needsReview = r.top1.conf < reviewThreshold;
                return (
                  <tr
                    key={item.index}
                    onClick={() => onSelect(item.index)}
                    className={cn(
                      baseRowClass,
                      needsReview && !isSelected && "bg-amber-50/40",
                    )}
                  >
                    <td className="py-2 pr-3 font-mono text-xs">{item.filename}</td>
                    <td className="py-2">
                      <span className="flex items-center gap-2">
                        <span
                          className="size-2 rounded-full"
                          style={{ background: colourFor(r.top1.class_id) }}
                        />
                        {r.top1.class_name}
                        {needsReview ? (
                          <Badge tone="warning" className="ml-1">
                            review
                          </Badge>
                        ) : null}
                      </span>
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {(r.top1.conf * 100).toFixed(1)}%
                    </td>
                    <td className="py-2 text-right tabular-nums text-ink-muted">
                      {r.inference_ms.toFixed(0)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

export function BatchAggregatePanel({ agg }: { agg: BatchAggregate }) {
  if (agg.task === "detect") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Detection aggregate</CardTitle>
          <CardDescription>
            {agg.totalBoxes} object{agg.totalBoxes === 1 ? "" : "s"} across{" "}
            {agg.totalImages} image{agg.totalImages === 1 ? "" : "s"}.
            {agg.failed ? ` ${agg.failed} failed.` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-medium uppercase tracking-wide text-ink-muted">
                <th className="pb-2">Class</th>
                <th className="pb-2 text-right">Total</th>
                <th className="pb-2 text-right">Max conf</th>
              </tr>
            </thead>
            <tbody>
              {agg.perClass.map((row) => (
                <tr key={row.class_name} className="border-t border-surface-muted text-ink">
                  <td className="py-2.5">{row.class_name}</td>
                  <td className="py-2.5 text-right font-medium tabular-nums">
                    {row.count}
                  </td>
                  <td className="py-2.5 text-right tabular-nums text-ink-muted">
                    {(row.maxConf * 100).toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Classification aggregate</CardTitle>
        <CardDescription>
          {agg.totalImages} image{agg.totalImages === 1 ? "" : "s"} across{" "}
          {agg.perClass.length} class{agg.perClass.length === 1 ? "" : "es"}.
          {agg.flaggedCount
            ? ` ${agg.flaggedCount} flagged for review.`
            : " None below review threshold."}
          {agg.failed ? ` ${agg.failed} failed.` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs font-medium uppercase tracking-wide text-ink-muted">
              <th className="pb-2">Class (top-1)</th>
              <th className="pb-2 text-right">Images</th>
              <th className="pb-2 text-right">Mean conf</th>
            </tr>
          </thead>
          <tbody>
            {agg.perClass.map((row) => (
              <tr key={row.class_name} className="border-t border-surface-muted text-ink">
                <td className="py-2.5">{row.class_name}</td>
                <td className="py-2.5 text-right font-medium tabular-nums">
                  {row.count}
                </td>
                <td className="py-2.5 text-right tabular-nums text-ink-muted">
                  {(row.meanConf * 100).toFixed(1)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
