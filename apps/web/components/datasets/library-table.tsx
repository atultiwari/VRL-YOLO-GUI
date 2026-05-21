"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  Database,
  ExternalLink,
  PencilLine,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import {
  ApiError,
  deleteDataset,
  listDatasets,
  updateDatasetMetadata,
} from "@/lib/api";
import { formatRelative, usePreferredTimezone } from "@/lib/format-date";
import type { DatasetListRow, DatasetPartial } from "@/lib/types";
import { cn } from "@/lib/utils";

export type LibraryTableMode = "picker" | "browse";

type SortKey = "last_used" | "most_runs" | "newest";

export interface LibraryTableProps {
  /**
   * picker = called from the /train/dataset tab. Shows "Use this"
   * CTA, hides Open link.
   * browse = called from the standalone /datasets page. Shows
   * Open link, hides Use this.
   */
  mode: LibraryTableMode;
  /** Called when the user clicks "Use this" on a row (picker mode). */
  onPick?: (row: DatasetListRow) => void;
}

export function LibraryTable({ mode, onPick }: LibraryTableProps) {
  const queryClient = useQueryClient();
  const tz = usePreferredTimezone();
  const [sortBy, setSortBy] = useState<SortKey>("last_used");
  const [deleteTarget, setDeleteTarget] = useState<DatasetListRow | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ["datasets-list"],
    queryFn: listDatasets,
    refetchOnWindowFocus: false,
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteDataset(id),
    onSuccess: () => {
      setDeleteTarget(null);
      setRowError(null);
      queryClient.invalidateQueries({ queryKey: ["datasets-list"] });
    },
    onError: (err) => {
      setRowError(
        err instanceof ApiError ? err.message : "Delete failed",
      );
    },
  });

  const sorted = useMemo(() => {
    const rows = [...(list.data?.rows ?? [])];
    rows.sort((a, b) => {
      if (sortBy === "newest") {
        return -compareIso(a.created_at, b.created_at);
      }
      if (sortBy === "most_runs") {
        if (b.run_count !== a.run_count) return b.run_count - a.run_count;
        // Tie-breaker: most recently used.
        return -compareIso(a.last_used_at, b.last_used_at);
      }
      // last_used default — null sorts last.
      const aNull = a.last_used_at === null;
      const bNull = b.last_used_at === null;
      if (aNull !== bNull) return aNull ? 1 : -1;
      return -compareIso(a.last_used_at, b.last_used_at);
    });
    return rows;
  }, [list.data, sortBy]);

  if (list.isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 py-12">
          <Spinner /> Loading dataset library…
        </CardContent>
      </Card>
    );
  }

  if (list.error) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-12 text-red-700">
          <AlertTriangle className="size-4" />
          {list.error instanceof Error
            ? list.error.message
            : "Could not load datasets"}
        </CardContent>
      </Card>
    );
  }

  const rows = list.data!.rows;
  const partial = list.data!.partial;

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div className="text-xs text-ink-muted">
          {rows.length === 0
            ? "No datasets yet"
            : `${rows.length} dataset${rows.length === 1 ? "" : "s"}`}
          {partial.length > 0
            ? ` · ${partial.length} unreadable`
            : ""}
        </div>
        <label className="flex items-center gap-2 text-xs uppercase tracking-wide text-ink-muted">
          Sort
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortKey)}
            className="h-8 rounded-md border border-surface-muted bg-surface px-2 text-sm normal-case tracking-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <option value="last_used">Most recently used</option>
            <option value="most_runs">Most runs</option>
            <option value="newest">Newest first</option>
          </select>
        </label>
      </div>

      {rows.length === 0 ? (
        <EmptyState />
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="border-b border-surface-muted bg-surface-subtle text-xs uppercase tracking-wide text-ink-muted">
                <tr>
                  <Th>Name</Th>
                  <Th>Task</Th>
                  <Th>Format</Th>
                  <Th className="text-right">Images</Th>
                  <Th>Splits</Th>
                  <Th>Last used</Th>
                  <Th className="text-right">Runs</Th>
                  <Th className="text-right">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((row) => (
                  <Row
                    key={row.id}
                    row={row}
                    mode={mode}
                    onPick={onPick}
                    onDelete={() => {
                      setRowError(null);
                      setDeleteTarget(row);
                    }}
                  />
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {partial.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="size-4 text-amber-600" />
              Couldn&apos;t read
            </CardTitle>
            <CardDescription>
              These dataset folders exist under storage but didn&apos;t pass
              inspection. Delete to reclaim disk space, or investigate the
              folder manually.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {partial.map((p) => (
              <PartialRow
                key={p.id}
                partial={p}
                onDelete={() => {
                  setRowError(null);
                  setDeleteTarget({
                    // Synthesise a minimal row so the delete modal renders.
                    id: p.id,
                    format: "yolo",
                    task: "detect",
                    root_path: "",
                    splits: [],
                    classes: [],
                    class_counts: {},
                    warnings: [],
                    unassigned_image_count: 0,
                    name: p.id,
                    description: p.error,
                    created_at: new Date().toISOString(),
                    last_used_at: null,
                    run_count: 0,
                  });
                }}
              />
            ))}
          </CardContent>
        </Card>
      ) : null}

      {rowError ? (
        <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          <AlertTriangle className="size-4" />
          {rowError}
        </div>
      ) : null}

      {deleteTarget ? (
        <DeleteDatasetModal
          row={deleteTarget}
          pending={remove.isPending}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => remove.mutate(deleteTarget.id)}
        />
      ) : null}
    </div>
  );
}

function Th({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th className={cn("px-3 py-2 text-left font-medium", className)}>
      {children}
    </th>
  );
}

function Row({
  row,
  mode,
  onPick,
  onDelete,
}: {
  row: DatasetListRow;
  mode: LibraryTableMode;
  onPick?: (row: DatasetListRow) => void;
  onDelete: () => void;
}) {
  const queryClient = useQueryClient();
  const totalImages = row.splits.reduce((sum, s) => sum + s.image_count, 0);
  const splitsLabel =
    row.splits.length > 0
      ? row.splits
          .map((s) => `${s.name} ${s.image_count.toLocaleString()}`)
          .join(" · ")
      : "—";

  // Inline rename — same pencil pattern as F2's run name on /train/run
  // and F3's history detail. Most-requested affordance after F4 shipped:
  // 45 backfilled "Dataset <stub>" rows take 45 detail-page round-trips
  // to rename without this. Per-row state (not lifted) so editing one
  // row doesn't re-render the whole table.
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(row.name);
  const [renameError, setRenameError] = useState<string | null>(null);

  const rename = useMutation({
    mutationFn: async () => {
      const next = nameDraft.trim();
      return updateDatasetMetadata(row.id, { name: next });
    },
    onSuccess: () => {
      setIsEditingName(false);
      setRenameError(null);
      queryClient.invalidateQueries({ queryKey: ["datasets-list"] });
    },
    onError: (err) => {
      setRenameError(
        err instanceof ApiError ? err.message : "Rename failed",
      );
    },
  });

  return (
    <tr className="border-b border-surface-muted last:border-0 hover:bg-surface-subtle">
      <td className="max-w-[300px] px-3 py-2">
        {isEditingName ? (
          <div className="space-y-1">
            <div className="flex items-center gap-1">
              <input
                autoFocus
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                maxLength={200}
                disabled={rename.isPending}
                onKeyDown={(e) => {
                  if (e.key === "Enter") rename.mutate();
                  if (e.key === "Escape") {
                    setIsEditingName(false);
                    setNameDraft(row.name);
                    setRenameError(null);
                  }
                }}
                className="h-7 flex-1 rounded-md border border-surface-muted bg-surface px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              />
              <button
                type="button"
                onClick={() => rename.mutate()}
                disabled={rename.isPending}
                title="Save"
                className="rounded-md p-1 text-accent hover:bg-accent-subtle disabled:opacity-50"
              >
                <Check className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsEditingName(false);
                  setNameDraft(row.name);
                  setRenameError(null);
                }}
                disabled={rename.isPending}
                title="Cancel"
                className="rounded-md p-1 text-ink-muted hover:bg-surface-muted hover:text-ink disabled:opacity-50"
              >
                <X className="size-3.5" />
              </button>
            </div>
            {renameError ? (
              <p className="text-xs text-red-700">{renameError}</p>
            ) : null}
            <p className="font-mono text-[11px] text-ink-muted/70">
              {row.id.slice(0, 12)}
            </p>
          </div>
        ) : (
          <div className="group/name">
            <div className="flex items-center gap-1">
              <span
                className="truncate font-medium text-ink"
                title={row.name}
              >
                {row.name}
              </span>
              <button
                type="button"
                onClick={() => {
                  setNameDraft(row.name);
                  setIsEditingName(true);
                  setRenameError(null);
                }}
                title="Rename"
                className="rounded-md p-1 text-ink-muted opacity-0 transition hover:bg-surface-muted hover:text-ink group-hover/name:opacity-100"
              >
                <PencilLine className="size-3.5" />
              </button>
            </div>
            <div
              className="font-mono text-xs text-ink-muted/70 truncate"
              title={row.id}
            >
              {row.id.slice(0, 12)}
            </div>
          </div>
        )}
      </td>
      <td className="px-3 py-2 capitalize">
        <Badge tone="subtle">{row.task}</Badge>
      </td>
      <td className="px-3 py-2 uppercase text-xs">{row.format}</td>
      <td className="px-3 py-2 text-right tabular-nums">
        {totalImages.toLocaleString()}
      </td>
      <td
        className="max-w-[200px] truncate px-3 py-2 text-xs text-ink-muted"
        title={splitsLabel}
      >
        {splitsLabel}
      </td>
      <td className="px-3 py-2 whitespace-nowrap text-xs text-ink-muted">
        {row.last_used_at ? formatRelative(row.last_used_at) : "—"}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        {row.run_count > 0 ? (
          <Link
            href={`/train/history?dataset=${encodeURIComponent(row.id)}`}
            className="text-accent hover:underline"
            title="View training runs that used this dataset"
          >
            {row.run_count}
          </Link>
        ) : (
          <span className="text-ink-muted">0</span>
        )}
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center justify-end gap-1">
          {mode === "picker" ? (
            <Button
              size="sm"
              onClick={() => onPick?.(row)}
              title="Use this dataset for a new training run"
            >
              <Check className="size-4" /> Use this
            </Button>
          ) : (
            <Link
              href={`/datasets/view?id=${encodeURIComponent(row.id)}`}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-accent hover:bg-accent-subtle"
              title="Open dataset detail page"
            >
              <ExternalLink className="size-3.5" /> Open
            </Link>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={onDelete}
            className="text-red-700 hover:bg-red-50"
            title="Delete this dataset"
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </td>
    </tr>
  );
}

function PartialRow({
  partial,
  onDelete,
}: {
  partial: DatasetPartial;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border border-surface-muted bg-surface-subtle px-3 py-2">
      <div className="min-w-0 flex-1">
        <code
          className="font-mono text-xs text-ink-muted"
          title={partial.id}
        >
          {partial.id.slice(0, 12)}
        </code>
        <p className="mt-0.5 text-xs italic text-ink-muted">
          {partial.error}
        </p>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={onDelete}
        className="text-red-700 hover:bg-red-50"
        title="Delete this dataset folder"
      >
        <Trash2 className="size-4" />
      </Button>
    </div>
  );
}

function EmptyState() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
        <Database className="size-10 text-ink-muted" />
        <div>
          <p className="font-medium">No datasets yet</p>
          <p className="text-sm text-ink-muted">
            Drop a folder to upload your first.
          </p>
        </div>
        <Link
          href="/train/dataset"
          className="text-sm font-medium text-accent hover:underline"
        >
          Go to upload →
        </Link>
      </CardContent>
    </Card>
  );
}

function DeleteDatasetModal({
  row,
  pending,
  onCancel,
  onConfirm,
}: {
  row: DatasetListRow;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const totalImages = row.splits.reduce((sum, s) => sum + s.image_count, 0);
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !pending) onCancel();
      }}
    >
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="flex items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-red-100 text-red-700">
              <Trash2 className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <CardTitle>Delete this dataset?</CardTitle>
              <CardDescription>
                <span className="font-medium text-ink">{row.name}</span>
                {totalImages > 0 ? (
                  <>
                    <br />
                    <span className="font-mono text-xs">
                      {row.id.slice(0, 12)}
                    </span>
                    {" · "}
                    {totalImages.toLocaleString()} images
                  </>
                ) : null}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {row.run_count > 0 ? (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <AlertTriangle className="mt-0.5 size-3 shrink-0" />
              <span>
                <strong>{row.run_count}</strong> training run
                {row.run_count === 1 ? "" : "s"} reference this dataset. Their
                history records stay in place — they show up as
                &quot;dataset deleted&quot; in /train/history. The saved
                checkpoints stay in /models. Delete them separately from
                there if needed.
              </span>
            </div>
          ) : null}
        </CardContent>
        <CardContent className="flex justify-end gap-2 pt-0">
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={pending}
            onClick={onConfirm}
            className="bg-red-600 text-white hover:bg-red-700"
          >
            {pending ? (
              <>
                <Spinner /> Deleting…
              </>
            ) : (
              <>
                <Trash2 className="size-4" /> Delete dataset
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function compareIso(a: string | null, b: string | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}
