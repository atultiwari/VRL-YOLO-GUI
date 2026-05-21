"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  Brain,
  Check,
  Database,
  ExternalLink,
  PencilLine,
  Play,
  Scissors,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

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
  listTrainingHistory,
  updateDatasetMetadata,
} from "@/lib/api";
import { formatDate, formatRelative, usePreferredTimezone } from "@/lib/format-date";
import type { DatasetListRow } from "@/lib/types";

export default function DatasetDetailPage() {
  return (
    <Suspense
      fallback={
        <section className="flex h-full items-center justify-center p-12">
          <Spinner /> Loading dataset…
        </section>
      }
    >
      <_DetailInner />
    </Suspense>
  );
}

function _DetailInner() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const id = searchParams.get("id") ?? "";
  const tz = usePreferredTimezone();

  const list = useQuery({
    queryKey: ["datasets-list"],
    queryFn: listDatasets,
    refetchOnWindowFocus: false,
  });
  const row: DatasetListRow | undefined = list.data?.rows.find(
    (r) => r.id === id,
  );

  // Recent runs for this dataset (top 10). Lives on /train/history's
  // backend so the same data shape works without duplicating fetchers.
  const recentRuns = useQuery({
    queryKey: ["history-by-dataset", id],
    queryFn: () =>
      listTrainingHistory({ dataset_id: id, limit: 10 }),
    enabled: !!id,
    refetchOnWindowFocus: false,
  });

  const [isEditingName, setIsEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [descPopoverOpen, setDescPopoverOpen] = useState(false);
  const [descDraft, setDescDraft] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  // Sync drafts when the row data loads.
  useEffect(() => {
    if (row) setNameDraft(row.name);
  }, [row]);

  const updateMeta = useMutation({
    mutationFn: async (patch: {
      name?: string | null;
      description?: string | null;
    }) => updateDatasetMetadata(id, patch),
    onSuccess: () => {
      setEditError(null);
      queryClient.invalidateQueries({ queryKey: ["datasets-list"] });
    },
    onError: (err) => {
      setEditError(
        err instanceof ApiError ? err.message : "Could not update",
      );
    },
  });

  const remove = useMutation({
    mutationFn: () => deleteDataset(id),
    onSuccess: () => {
      router.push("/datasets");
    },
    onError: (err) => {
      setEditError(
        err instanceof ApiError ? err.message : "Delete failed",
      );
    },
  });

  if (!id) {
    return (
      <section className="flex h-full flex-col items-center justify-center gap-3 p-12 text-center">
        <AlertTriangle className="size-8 text-red-700" />
        <p className="text-lg font-medium">Missing dataset id</p>
        <p className="text-sm text-ink-muted">
          This page expects a <code>?id=&lt;dataset_id&gt;</code> query parameter.
        </p>
        <Link
          href="/datasets"
          className="text-sm font-medium text-accent hover:underline"
        >
          Back to dataset library
        </Link>
      </section>
    );
  }

  if (list.isLoading) {
    return (
      <section className="flex h-full items-center justify-center p-12">
        <Spinner /> Loading dataset…
      </section>
    );
  }

  if (!row) {
    return (
      <section className="flex h-full flex-col items-center justify-center gap-3 p-12 text-center">
        <AlertTriangle className="size-8 text-red-700" />
        <p className="text-lg font-medium">Dataset not found</p>
        <p className="text-sm text-ink-muted">
          <code className="font-mono">{id.slice(0, 12)}</code> isn&apos;t
          in your library. It may have been deleted.
        </p>
        <Link
          href="/datasets"
          className="text-sm font-medium text-accent hover:underline"
        >
          Back to dataset library
        </Link>
      </section>
    );
  }

  const totalImages = row.splits.reduce((sum, s) => sum + s.image_count, 0);

  return (
    <section className="flex h-full flex-col gap-8 px-12 py-12">
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <Link
            href="/datasets"
            className="inline-flex items-center gap-1 text-xs font-medium uppercase tracking-[0.2em] text-ink-muted hover:text-accent"
          >
            <ArrowLeft className="size-3" />
            Dataset library
          </Link>
          {isEditingName ? (
            <div className="mt-2 flex items-center gap-2">
              <input
                autoFocus
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                maxLength={200}
                disabled={updateMeta.isPending}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    updateMeta.mutate({ name: nameDraft.trim() });
                    setIsEditingName(false);
                  }
                  if (e.key === "Escape") setIsEditingName(false);
                }}
                className="flex-1 rounded-md border border-surface-muted bg-surface px-3 py-2 text-2xl font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              />
              <Button
                size="sm"
                disabled={updateMeta.isPending}
                onClick={() => {
                  updateMeta.mutate({ name: nameDraft.trim() });
                  setIsEditingName(false);
                }}
              >
                <Check className="size-4" /> Save
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={updateMeta.isPending}
                onClick={() => setIsEditingName(false)}
              >
                <X className="size-4" />
              </Button>
            </div>
          ) : (
            <h1 className="mt-2 flex items-center gap-2 text-2xl font-semibold tracking-tight">
              <Database className="size-6 text-accent" />
              <span className="truncate" title={row.name}>
                {row.name}
              </span>
              <button
                type="button"
                onClick={() => {
                  setNameDraft(row.name);
                  setIsEditingName(true);
                  setEditError(null);
                }}
                title="Rename this dataset"
                className="rounded-md p-1 text-ink-muted hover:bg-surface-muted hover:text-ink"
              >
                <PencilLine className="size-4" />
              </button>
            </h1>
          )}
          <div className="mt-1 flex items-center gap-2">
            <p
              className="max-w-3xl text-sm italic text-ink-muted"
              title={row.description || undefined}
            >
              {row.description || (
                <span className="not-italic opacity-60">No description.</span>
              )}
            </p>
            <button
              type="button"
              onClick={() => {
                setDescDraft(row.description);
                setDescPopoverOpen(true);
                setEditError(null);
              }}
              title="Edit description"
              className="rounded-md p-1 text-ink-muted hover:bg-surface-muted hover:text-ink"
            >
              <PencilLine className="size-3.5" />
            </button>
          </div>
          <p className="mt-3 max-w-3xl text-sm text-ink-muted">
            <span className="font-mono text-xs">{row.id}</span>
            {" · "}
            <span className="font-medium text-ink">Uploaded</span>{" "}
            {formatDate(row.created_at, { timeZone: tz })}
            {row.last_used_at ? (
              <>
                {" · "}
                <span className="font-medium text-ink">Last used</span>{" "}
                {formatRelative(row.last_used_at)}
              </>
            ) : null}
            {" · "}
            <span className="font-medium text-ink">{row.run_count}</span> run
            {row.run_count === 1 ? "" : "s"}
          </p>
          {editError ? (
            <div className="mt-2 flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-800">
              <AlertTriangle className="size-3" />
              {editError}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge tone="subtle">{row.task}</Badge>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard title="Task" value={row.task} />
        <SummaryCard title="Format" value={row.format.toUpperCase()} />
        <SummaryCard
          title="Images"
          value={totalImages.toLocaleString()}
          subtitle={`${row.classes.length} class${
            row.classes.length === 1 ? "" : "es"
          }`}
        />
        <SummaryCard
          title="Splits"
          value={`${row.splits.length}`}
          subtitle={row.splits.map((s) => s.name).join(" · ") || "—"}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Splits</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-surface-muted bg-surface-subtle text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Split</th>
                <th className="px-3 py-2 text-right font-medium">Images</th>
                <th className="px-3 py-2 text-right font-medium">Labels</th>
              </tr>
            </thead>
            <tbody>
              {row.splits.map((s) => (
                <tr
                  key={s.name}
                  className="border-b border-surface-muted last:border-0"
                >
                  <td className="px-3 py-2 capitalize">{s.name}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {s.image_count.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {s.label_count.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {row.classes.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Classes</CardTitle>
            <CardDescription>
              {row.classes.length} class
              {row.classes.length === 1 ? "" : "es"} detected
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {row.classes.map((c) => (
                <span
                  key={c}
                  className="rounded-md bg-surface-muted px-2 py-1 text-xs"
                >
                  {c}
                  {row.class_counts[c] !== undefined ? (
                    <span className="ml-1 text-ink-muted">
                      · {row.class_counts[c].toLocaleString()}
                    </span>
                  ) : null}
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent training runs</CardTitle>
          <CardDescription>
            Showing up to 10 most recent. View all at{" "}
            <Link
              href={`/train/history?dataset=${encodeURIComponent(row.id)}`}
              className="text-accent hover:underline"
            >
              Training history
            </Link>
            .
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {recentRuns.isLoading ? (
            <div className="flex items-center gap-2 px-4 py-6 text-sm text-ink-muted">
              <Spinner /> Loading runs…
            </div>
          ) : (recentRuns.data?.rows.length ?? 0) === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-ink-muted">
              No training runs on this dataset yet.{" "}
              <Link
                href="/train"
                className="text-accent hover:underline"
              >
                Start one →
              </Link>
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-surface-muted bg-surface-subtle text-xs uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Run name</th>
                  <th className="px-3 py-2 text-left font-medium">Started</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {recentRuns.data!.rows.map((r) => (
                  <tr
                    key={r.id}
                    className="border-b border-surface-muted last:border-0 hover:bg-surface-subtle"
                  >
                    <td className="px-3 py-2">
                      <Link
                        href={`/train/history/view?id=${encodeURIComponent(r.id)}`}
                        className="text-accent hover:underline"
                      >
                        {r.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {formatDate(r.started_at, { timeZone: tz })}
                    </td>
                    <td className="px-3 py-2 capitalize">{r.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap justify-end gap-2">
        <Link href="/train/dataset">
          <Button variant="ghost" size="sm">
            <Scissors className="size-4" /> Re-split via wizard
          </Button>
        </Link>
        <Link href="/train">
          <Button variant="ghost" size="sm">
            <Play className="size-4" /> Use for new training
          </Button>
        </Link>
        <Button
          size="sm"
          onClick={() => setDeleteOpen(true)}
          className="bg-red-600 text-white hover:bg-red-700"
        >
          <Trash2 className="size-4" /> Delete dataset
        </Button>
      </div>

      {descPopoverOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget && !updateMeta.isPending)
              setDescPopoverOpen(false);
          }}
        >
          <Card className="w-full max-w-lg">
            <CardHeader>
              <CardTitle>Edit description</CardTitle>
              <CardDescription>
                Free-text notes about this dataset. Empty = clear.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <textarea
                autoFocus
                value={descDraft}
                onChange={(e) => setDescDraft(e.target.value)}
                maxLength={2000}
                rows={6}
                className="w-full resize-y rounded-md border border-surface-muted bg-surface px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              />
              <div className="flex justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={updateMeta.isPending}
                  onClick={() => setDescPopoverOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  disabled={updateMeta.isPending}
                  onClick={() => {
                    updateMeta.mutate({ description: descDraft });
                    setDescPopoverOpen(false);
                  }}
                >
                  <Check className="size-4" /> Save
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {deleteOpen ? (
        <DeleteModal
          row={row}
          pending={remove.isPending}
          onCancel={() => setDeleteOpen(false)}
          onConfirm={() => remove.mutate()}
        />
      ) : null}
    </section>
  );
}

function SummaryCard({
  title,
  value,
  subtitle,
}: {
  title: string;
  value: string;
  subtitle?: string;
}) {
  return (
    <Card>
      <CardContent className="space-y-1 py-4">
        <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
          {title}
        </p>
        <p className="text-lg font-medium capitalize text-ink">{value}</p>
        {subtitle ? (
          <p className="truncate text-xs text-ink-muted" title={subtitle}>
            {subtitle}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function DeleteModal({
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
          <CardTitle>Delete this dataset?</CardTitle>
          <CardDescription>
            <span className="font-medium text-ink">{row.name}</span>{" "}
            (<span className="font-mono text-xs">{row.id.slice(0, 12)}</span>)
            and its folder will be removed.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {row.run_count > 0 ? (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <AlertTriangle className="mt-0.5 size-3 shrink-0" />
              <span>
                <strong>{row.run_count}</strong> training run
                {row.run_count === 1 ? "" : "s"} reference this dataset.
                History records stay; the saved checkpoints stay in /models.
                Delete those separately from there if needed.
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
