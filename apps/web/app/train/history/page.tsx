"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  CircleStop,
  Database,
  Filter,
  History as HistoryIcon,
  Loader2,
  RotateCcw,
  Sparkles,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

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
  deleteTrainingHistoryRow,
  listTrainingHistory,
  purgeTrainingHistory,
} from "@/lib/api";
import { formatDate, formatElapsed, usePreferredTimezone } from "@/lib/format-date";
import { useSettings } from "@/lib/settings";
import { useTrainStore } from "@/lib/train-store";
import type { Task, TrainingHistoryRow, TrainingStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const AUTO_PURGE_DAYS = 30;
const PAGE_SIZE = 50;

type TaskFilter = "all" | Task;
type StatusFilter = "all" | TrainingStatus;
type SortKey = "started_at" | "name" | "duration";

const STATUS_BADGE: Record<
  TrainingStatus,
  { label: string; tone: "subtle" | "accent" | "clinical" | "warning" | "danger" }
> = {
  queued: { label: "queued", tone: "subtle" },
  running: { label: "running", tone: "accent" },
  completed: { label: "completed", tone: "clinical" },
  failed: { label: "failed", tone: "danger" },
  cancelled: { label: "cancelled", tone: "warning" },
};

export default function TrainHistoryPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { settings } = useSettings();
  const tz = usePreferredTimezone();
  const { setActiveJob } = useTrainStore();

  const [taskFilter, setTaskFilter] = useState<TaskFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [datasetFilter, setDatasetFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<SortKey>("started_at");
  const [autoPurgeToast, setAutoPurgeToast] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<
    TrainingHistoryRow | null
  >(null);

  const list = useQuery({
    queryKey: [
      "training-history",
      taskFilter,
      statusFilter,
      datasetFilter,
      sortBy,
    ],
    queryFn: () =>
      listTrainingHistory({
        task: taskFilter === "all" ? undefined : taskFilter,
        status: statusFilter === "all" ? undefined : statusFilter,
        dataset_id: datasetFilter === "all" ? undefined : datasetFilter,
        limit: PAGE_SIZE,
        offset: 0,
        sort_by: sortBy,
        sort_dir: sortBy === "name" ? "asc" : "desc",
      }),
    refetchOnWindowFocus: false,
  });

  // F3 §9: auto-purge on mount if the user opted in. Fires once per
  // page mount (useRef guard) so a re-render doesn't double-call.
  const purgeFired = useRef(false);
  const autoPurge = useMutation({
    mutationFn: () => purgeTrainingHistory(AUTO_PURGE_DAYS),
    onSuccess: (res) => {
      if (res.deleted_count > 0) {
        setAutoPurgeToast(
          `Auto-purged ${res.deleted_count} run${
            res.deleted_count === 1 ? "" : "s"
          } older than ${AUTO_PURGE_DAYS} days.`,
        );
        queryClient.invalidateQueries({ queryKey: ["training-history"] });
      }
    },
    onError: (err) => {
      setAutoPurgeToast(
        `Auto-purge failed: ${
          err instanceof ApiError ? err.message : "unknown error"
        }`,
      );
    },
  });
  useEffect(() => {
    if (purgeFired.current) return;
    if (!settings.auto_purge_old_runs) return;
    purgeFired.current = true;
    autoPurge.mutate();
    // autoPurge is stable across renders; intentionally not in deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.auto_purge_old_runs]);

  // Manual cleanup — same call, different copy + a confirmation.
  const manualPurge = useMutation({
    mutationFn: () => purgeTrainingHistory(AUTO_PURGE_DAYS),
    onSuccess: (res) => {
      setAutoPurgeToast(
        res.deleted_count > 0
          ? `Cleaned up ${res.deleted_count} run${
              res.deleted_count === 1 ? "" : "s"
            }.`
          : `Nothing to clean up — no runs older than ${AUTO_PURGE_DAYS} days.`,
      );
      queryClient.invalidateQueries({ queryKey: ["training-history"] });
    },
    onError: (err) => {
      setAutoPurgeToast(
        err instanceof ApiError ? err.message : "Cleanup failed.",
      );
    },
  });

  const rerun = useMutation({
    mutationFn: async (jobId: string) => jobId,
    onSuccess: (jobId) => {
      // Configure page reads ?from=<history_id> on mount and fetches
      // the prefill payload itself — keeps the prefill state in one
      // place rather than spreading it across the store + navigation.
      router.push(
        `/train/configure?from=${encodeURIComponent(jobId)}`,
      );
    },
    onError: (err) => {
      setRowError(
        err instanceof ApiError ? err.message : "Re-run failed",
      );
    },
  });

  const remove = useMutation({
    mutationFn: async (args: {
      id: string;
      deleteCheckpoint: boolean;
    }) =>
      deleteTrainingHistoryRow(args.id, {
        deleteCheckpoint: args.deleteCheckpoint,
      }),
    onSuccess: () => {
      setDeleteCandidate(null);
      queryClient.invalidateQueries({ queryKey: ["training-history"] });
    },
    onError: (err) => {
      setRowError(
        err instanceof ApiError ? err.message : "Delete failed",
      );
    },
  });

  const datasets = useMemo(() => {
    const seen = new Set<string>();
    for (const row of list.data?.rows ?? []) seen.add(row.dataset_id);
    return Array.from(seen).sort();
  }, [list.data]);

  return (
    <section className="flex h-full flex-col gap-8 px-12 py-12">
      <header className="flex items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-ink-muted">
            Train · history
          </p>
          <h1 className="mt-2 flex items-center gap-3 text-4xl font-semibold tracking-tight">
            <HistoryIcon className="size-7 text-accent" />
            Training history
          </h1>
          <p className="mt-3 max-w-2xl text-ink-muted">
            Every training run lives here — completed, failed, cancelled, and
            still-running. Click a row to replay its charts; edit name and
            description any time; re-run with the same settings.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          disabled={manualPurge.isPending}
          onClick={() => manualPurge.mutate()}
          title={`Delete history rows older than ${AUTO_PURGE_DAYS} days`}
        >
          <Trash2 className="size-4" /> Clean up runs older than{" "}
          {AUTO_PURGE_DAYS} days
        </Button>
      </header>

      {autoPurgeToast ? (
        <div className="rounded-md border border-clinical/30 bg-clinical/10 px-3 py-2 text-sm text-ink">
          {autoPurgeToast}
        </div>
      ) : null}

      <FilterBar
        task={taskFilter}
        onTask={setTaskFilter}
        status={statusFilter}
        onStatus={setStatusFilter}
        dataset={datasetFilter}
        onDataset={setDatasetFilter}
        datasets={datasets}
        sortBy={sortBy}
        onSort={setSortBy}
      />

      {list.isLoading ? (
        <Card>
          <CardContent className="flex items-center gap-3 py-12">
            <Spinner /> Loading training history…
          </CardContent>
        </Card>
      ) : list.error ? (
        <Card>
          <CardContent className="flex items-center gap-2 py-12 text-red-700">
            <AlertTriangle className="size-4" />
            {list.error instanceof Error
              ? list.error.message
              : "Could not load history"}
          </CardContent>
        </Card>
      ) : (list.data?.rows.length ?? 0) === 0 ? (
        <EmptyState />
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="border-b border-surface-muted bg-surface-subtle text-xs uppercase tracking-wide text-ink-muted">
                <tr>
                  <Th>Name</Th>
                  <Th>Task</Th>
                  <Th>Dataset</Th>
                  <Th>Started</Th>
                  <Th>Duration</Th>
                  <Th>Status</Th>
                  <Th>Best</Th>
                  <Th className="text-center">In library?</Th>
                  <Th className="text-right">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {list.data!.rows.map((row) => (
                  <Row
                    key={row.id}
                    row={row}
                    tz={tz}
                    onRerun={() => {
                      setRowError(null);
                      rerun.mutate(row.id);
                    }}
                    onDelete={() => {
                      setRowError(null);
                      setDeleteCandidate(row);
                    }}
                    rerunPending={rerun.isPending && rerun.variables === row.id}
                  />
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {rowError ? (
        <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          <AlertTriangle className="size-4" />
          {rowError}
        </div>
      ) : null}

      {deleteCandidate ? (
        <DeleteHistoryModal
          row={deleteCandidate}
          pending={remove.isPending}
          onCancel={() => setDeleteCandidate(null)}
          onConfirm={(deleteCheckpoint) =>
            remove.mutate({ id: deleteCandidate.id, deleteCheckpoint })
          }
        />
      ) : null}
    </section>
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

function FilterBar({
  task,
  onTask,
  status,
  onStatus,
  dataset,
  onDataset,
  datasets,
  sortBy,
  onSort,
}: {
  task: TaskFilter;
  onTask: (v: TaskFilter) => void;
  status: StatusFilter;
  onStatus: (v: StatusFilter) => void;
  dataset: string;
  onDataset: (v: string) => void;
  datasets: string[];
  sortBy: SortKey;
  onSort: (v: SortKey) => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-4 rounded-lg border border-surface-muted bg-surface-subtle px-4 py-3 text-sm">
      <Filter className="size-4 text-ink-muted" />
      <Field label="Task">
        <Select value={task} onChange={(v) => onTask(v as TaskFilter)}>
          <option value="all">All</option>
          <option value="detect">Detect</option>
          <option value="classify">Classify</option>
        </Select>
      </Field>
      <Field label="Status">
        <Select value={status} onChange={(v) => onStatus(v as StatusFilter)}>
          <option value="all">All</option>
          <option value="running">Running</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
          <option value="cancelled">Cancelled</option>
        </Select>
      </Field>
      <Field label="Dataset">
        <Select value={dataset} onChange={onDataset}>
          <option value="all">All</option>
          {datasets.map((d) => (
            <option key={d} value={d}>
              {d.slice(0, 12)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Sort by">
        <Select value={sortBy} onChange={(v) => onSort(v as SortKey)}>
          <option value="started_at">Most recent</option>
          <option value="name">Name (A→Z)</option>
          <option value="duration">Duration</option>
        </Select>
      </Field>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-ink-muted">
      {label}
      {children}
    </label>
  );
}

function Select({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 rounded-md border border-surface-muted bg-surface px-2 text-sm normal-case tracking-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
    >
      {children}
    </select>
  );
}

function Row({
  row,
  tz,
  onRerun,
  onDelete,
  rerunPending,
}: {
  row: TrainingHistoryRow;
  tz: string;
  onRerun: () => void;
  onDelete: () => void;
  rerunPending: boolean;
}) {
  const badge = STATUS_BADGE[row.status];
  const bestMetric =
    row.task === "classify"
      ? row.final_metrics.top1
      : row.final_metrics.mAP50;
  const bestLabel =
    bestMetric !== null && bestMetric !== undefined
      ? bestMetric.toFixed(3)
      : "—";
  return (
    <tr className="border-b border-surface-muted last:border-0 hover:bg-surface-subtle">
      <td className="max-w-[260px] truncate px-3 py-2">
        <Link
          href={`/train/history/view?id=${encodeURIComponent(row.id)}`}
          className="font-medium text-ink hover:text-accent"
          title={row.name}
        >
          {row.name}
        </Link>
        {row.description ? (
          <p
            className="truncate text-xs text-ink-muted"
            title={row.description}
          >
            {row.description}
          </p>
        ) : null}
      </td>
      <td className="px-3 py-2 capitalize">{row.task}</td>
      <td
        className={cn(
          "px-3 py-2 font-mono text-xs",
          row.dataset_missing && "text-ink-muted/60 line-through",
        )}
        title={row.dataset_missing ? "Dataset folder no longer exists" : undefined}
      >
        {row.dataset_id.slice(0, 12)}
      </td>
      <td className="px-3 py-2 whitespace-nowrap">
        {formatDate(row.started_at, { timeZone: tz })}
      </td>
      <td className="px-3 py-2 whitespace-nowrap">
        {row.duration_s !== null ? formatElapsed(row.duration_s) : "—"}
      </td>
      <td className="px-3 py-2">
        <Badge tone={badge.tone}>
          {row.status === "running" ? (
            <Loader2 className="mr-1 size-3 animate-spin" />
          ) : row.status === "completed" ? (
            <CheckCircle2 className="mr-1 size-3" />
          ) : row.status === "failed" ? (
            <AlertTriangle className="mr-1 size-3" />
          ) : row.status === "cancelled" ? (
            <CircleStop className="mr-1 size-3" />
          ) : (
            <Sparkles className="mr-1 size-3" />
          )}
          {badge.label}
        </Badge>
      </td>
      <td className="px-3 py-2 tabular-nums">{bestLabel}</td>
      <td className="px-3 py-2 text-center">
        {row.library_path ? (
          <Check className="mx-auto size-4 text-clinical" />
        ) : (
          <span className="text-ink-muted">—</span>
        )}
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center justify-end gap-1">
          <Button
            variant="ghost"
            size="sm"
            disabled={row.dataset_missing || rerunPending}
            onClick={onRerun}
            title={
              row.dataset_missing
                ? "Dataset is gone — re-upload before re-running"
                : "Re-run with the same settings"
            }
          >
            {rerunPending ? <Spinner /> : <RotateCcw className="size-4" />}
            Re-run
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onDelete}
            className="text-red-700 hover:bg-red-50"
            title="Delete this history row"
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </td>
    </tr>
  );
}

function EmptyState() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
        <Database className="size-10 text-ink-muted" />
        <div>
          <p className="font-medium">No training runs yet</p>
          <p className="text-sm text-ink-muted">
            Start one from /train — it&apos;ll show up here when it begins.
          </p>
        </div>
        <Link
          href="/train"
          className="text-sm font-medium text-accent hover:underline"
        >
          Start a training run →
        </Link>
      </CardContent>
    </Card>
  );
}

function DeleteHistoryModal({
  row,
  pending,
  onCancel,
  onConfirm,
}: {
  row: TrainingHistoryRow;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (deleteCheckpoint: boolean) => void;
}) {
  const [alsoDeleteCheckpoint, setAlsoDeleteCheckpoint] = useState(false);
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
              <CardTitle>Delete this training run?</CardTitle>
              <CardDescription>
                The history row for <span className="font-mono">{row.name}</span>{" "}
                will be removed along with its event log. Other runs from the
                same dataset stay.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {row.library_path ? (
            <label className="flex cursor-pointer items-start gap-2 rounded-md border border-surface-muted bg-surface px-3 py-2">
              <input
                type="checkbox"
                checked={alsoDeleteCheckpoint}
                onChange={(e) => setAlsoDeleteCheckpoint(e.target.checked)}
                className="mt-0.5"
              />
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">
                  Also delete the saved checkpoint
                </span>
                <span className="text-xs text-ink-muted">
                  Removes{" "}
                  <span className="font-mono break-all">{row.library_path}</span>{" "}
                  from /models too. Default off — the checkpoint is a separate
                  artifact.
                </span>
              </span>
            </label>
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
            onClick={() => onConfirm(alsoDeleteCheckpoint)}
            className="bg-red-600 text-white hover:bg-red-700"
          >
            {pending ? (
              <>
                <Spinner /> Deleting…
              </>
            ) : (
              <>
                <Trash2 className="size-4" /> Delete
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
