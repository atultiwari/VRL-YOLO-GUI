"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  CircleStop,
  History as HistoryIcon,
  LineChart as LineChartIcon,
  Loader2,
  PencilLine,
  RotateCcw,
  Save,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
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
import { Spinner } from "@/components/ui/spinner";
import {
  ApiError,
  deleteTrainingHistoryRow,
  fetchTrainingHistoryEvents,
  getTrainingHistoryRow,
  saveTrainingToLibrary,
  updateTrainingMetadata,
} from "@/lib/api";
import {
  formatDate,
  formatElapsed,
  usePreferredTimezone,
} from "@/lib/format-date";
import { useSettings } from "@/lib/settings";
import type { TrainingEvent, TrainingMetrics, TrainingStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

interface ChartRow {
  epoch: number;
  box_loss: number | null;
  cls_loss: number | null;
  dfl_loss: number | null;
  mAP50: number | null;
  mAP50_95: number | null;
  loss: number | null;
  top1: number | null;
  top5: number | null;
}

const STATUS_TONE: Record<
  TrainingStatus,
  "subtle" | "accent" | "clinical" | "warning" | "danger"
> = {
  queued: "subtle",
  running: "accent",
  completed: "clinical",
  failed: "danger",
  cancelled: "warning",
};

export default function TrainHistoryDetailPage() {
  // useSearchParams requires a Suspense boundary in Next.js static
  // export mode. The wrapper handles that; the real component is
  // _DetailInner below.
  return (
    <Suspense
      fallback={
        <section className="flex h-full items-center justify-center p-12">
          <Spinner /> Loading run…
        </section>
      }
    >
      <_DetailInner />
    </Suspense>
  );
}

function _DetailInner() {
  const searchParams = useSearchParams();
  // Static-export-compatible: id lives in the query string instead of
  // the URL path (Next.js can't pre-render dynamic [id] routes
  // without generateStaticParams, and history rows are runtime data).
  const id = searchParams.get("id") ?? "";
  const router = useRouter();
  const queryClient = useQueryClient();

  if (!id) {
    return (
      <section className="flex h-full flex-col items-center justify-center gap-3 p-12 text-center">
        <AlertTriangle className="size-8 text-red-700" />
        <p className="text-lg font-medium">Missing history id</p>
        <p className="text-sm text-ink-muted">
          This page expects a <code>?id=&lt;job_id&gt;</code> query parameter.
        </p>
        <Link
          href="/train/history"
          className="text-sm font-medium text-accent hover:underline"
        >
          Back to training history
        </Link>
      </section>
    );
  }
  const tz = usePreferredTimezone();

  const detail = useQuery({
    queryKey: ["history-detail", id],
    queryFn: () => getTrainingHistoryRow(id),
    refetchOnWindowFocus: false,
  });

  const events = useQuery({
    queryKey: ["history-events", id],
    queryFn: () => fetchTrainingHistoryEvents(id),
    refetchOnWindowFocus: false,
  });

  const [isEditingName, setIsEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [descPopoverOpen, setDescPopoverOpen] = useState(false);
  const [descDraft, setDescDraft] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const updateMeta = useMutation({
    mutationFn: async (patch: {
      name?: string | null;
      description?: string | null;
    }) => updateTrainingMetadata(id, patch),
    onSuccess: () => {
      setEditError(null);
      queryClient.invalidateQueries({ queryKey: ["history-detail", id] });
      queryClient.invalidateQueries({ queryKey: ["training-history"] });
    },
    onError: (err) => {
      setEditError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Could not update",
      );
    },
  });

  const rerun = useMutation({
    mutationFn: async () => id,
    onSuccess: () => {
      // Configure page fetches the prefill itself from the ?from id.
      router.push(`/train/configure?from=${encodeURIComponent(id)}`);
    },
    onError: (err) => {
      setEditError(
        err instanceof ApiError ? err.message : "Re-run failed",
      );
    },
  });

  const save = useMutation({
    mutationFn: () => saveTrainingToLibrary(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["history-detail", id] });
      queryClient.invalidateQueries({ queryKey: ["models"] });
    },
    onError: (err) => {
      setEditError(
        err instanceof ApiError ? err.message : "Save failed",
      );
    },
  });

  // F5: auto-save when the user opens a completed run that hasn't
  // been saved yet (e.g. they walked away during training, came
  // back later, navigated here from /train/history). One-shot per
  // page mount via useRef so a row refresh doesn't re-fire.
  const { settings } = useSettings();
  const autoSaveFired = useRef(false);
  const [autoSaveToast, setAutoSaveToast] = useState<string | null>(null);
  useEffect(() => {
    if (autoSaveFired.current) return;
    if (!settings.auto_save_trained_models) return;
    if (!detail.data) return;
    const r = detail.data.row;
    if (r.status !== "completed") return;
    if (!r.best_pt_path) return;
    if (r.library_path) return;
    if (save.isPending) return;
    autoSaveFired.current = true;
    save.mutate(undefined, {
      onSuccess: (model) => {
        setAutoSaveToast(
          `Auto-saved as "${model.name}". Open Models to use it for prediction.`,
        );
      },
      onError: () => {
        // Manual Save button stays visible because library_path is
        // still null on the row; user can retry.
        autoSaveFired.current = false;
      },
    });
    // save.mutate is a stable mutation function from React Query.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.data, settings.auto_save_trained_models]);

  const remove = useMutation({
    mutationFn: async (deleteCheckpoint: boolean) =>
      deleteTrainingHistoryRow(id, { deleteCheckpoint }),
    onSuccess: () => {
      router.push("/train/history");
    },
    onError: (err) => {
      setEditError(
        err instanceof ApiError ? err.message : "Delete failed",
      );
    },
  });

  const series = useMemo<ChartRow[]>(() => {
    if (!events.data) return [];
    const rows = new Map<number, ChartRow>();
    for (const ev of events.data) {
      if ((ev as unknown as { type?: string }).type !== "epoch") continue;
      const e = ev as Extract<TrainingEvent, { type: "epoch" }>;
      const m = e.metrics ?? {
        box_loss: null,
        cls_loss: null,
        dfl_loss: null,
        mAP50: null,
        mAP50_95: null,
        loss: null,
        top1: null,
        top5: null,
      };
      rows.set(e.epoch, {
        epoch: e.epoch,
        box_loss: m.box_loss ?? null,
        cls_loss: m.cls_loss ?? null,
        dfl_loss: m.dfl_loss ?? null,
        mAP50: m.mAP50 ?? null,
        mAP50_95: m.mAP50_95 ?? null,
        loss: m.loss ?? null,
        top1: m.top1 ?? null,
        top5: m.top5 ?? null,
      });
    }
    return Array.from(rows.values()).sort((a, b) => a.epoch - b.epoch);
  }, [events.data]);

  if (detail.isLoading) {
    return (
      <section className="flex h-full items-center justify-center p-12">
        <Spinner /> Loading run…
      </section>
    );
  }

  if (detail.error || !detail.data) {
    return (
      <section className="flex h-full flex-col items-center justify-center gap-3 p-12">
        <AlertTriangle className="size-8 text-red-700" />
        <p className="text-lg font-medium">Couldn&apos;t load this run</p>
        <p className="text-sm text-ink-muted">
          {detail.error instanceof Error
            ? detail.error.message
            : "Unknown error"}
        </p>
        <Link
          href="/train/history"
          className="text-sm font-medium text-accent hover:underline"
        >
          Back to training history
        </Link>
      </section>
    );
  }

  const row = detail.data.row;
  const elapsedSeconds =
    row.duration_s ??
    (row.finished_at
      ? Math.max(
          0,
          Math.floor(
            (new Date(row.finished_at).getTime() -
              new Date(row.started_at).getTime()) /
              1000,
          ),
        )
      : 0);

  return (
    <section className="flex h-full flex-col gap-8 px-12 py-12">
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <Link
            href="/train/history"
            className="inline-flex items-center gap-1 text-xs font-medium uppercase tracking-[0.2em] text-ink-muted hover:text-accent"
          >
            <ArrowLeft className="size-3" />
            Training history
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
              <HistoryIcon className="size-6 text-accent" />
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
                title="Rename this run"
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
            <span className="font-medium text-ink">Started</span>{" "}
            {formatDate(row.started_at, { timeZone: tz })}
            {row.finished_at ? (
              <>
                {" · "}
                <span className="font-medium text-ink">Finished</span>{" "}
                {formatDate(row.finished_at, { timeZone: tz })}
                {" · "}
                <span className="font-medium text-ink">Elapsed</span>{" "}
                {formatElapsed(elapsedSeconds)}
              </>
            ) : (
              <>
                {" · "}
                <span className="font-medium text-ink">Elapsed</span>{" "}
                {formatElapsed(elapsedSeconds)}
              </>
            )}
          </p>
          {editError ? (
            <div className="mt-2 flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-800">
              <AlertTriangle className="size-3" />
              {editError}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge tone={STATUS_TONE[row.status]}>
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
            {row.status}
          </Badge>
        </div>
      </header>

      {row.error_message ? (
        <Card>
          <CardContent className="flex items-start gap-2 py-4 text-sm text-red-800">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>{row.error_message}</span>
          </CardContent>
        </Card>
      ) : null}

      {autoSaveToast ? (
        <div className="flex items-center justify-between gap-3 rounded-md border border-clinical/30 bg-clinical/10 px-3 py-2 text-sm text-ink">
          <span>
            <Check className="mr-1 inline size-4 text-clinical" />
            {autoSaveToast}
          </span>
          <button
            type="button"
            onClick={() => setAutoSaveToast(null)}
            className="text-ink-muted hover:text-ink"
            aria-label="Dismiss"
          >
            <X className="size-4" />
          </button>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard title="Task" value={row.task} />
        <SummaryCard
          title="Dataset"
          value={row.dataset_id.slice(0, 12)}
          subtitle={
            row.dataset_missing
              ? "Dataset folder no longer exists"
              : undefined
          }
          dim={row.dataset_missing}
        />
        <SummaryCard title="Model" value={row.base_model} />
        <SummaryCard
          title="Hardware"
          value={row.accelerator_kind.toUpperCase()}
          subtitle={row.device_arg ?? undefined}
        />
        <SummaryCard
          title="Epochs"
          value={`${row.epoch_current} / ${row.epochs_total}`}
        />
        <SummaryCard title="Image size" value={`${row.imgsz}px`} />
        <SummaryCard title="Batch size" value={String(row.batch)} />
        <SummaryCard
          title="In library?"
          value={row.library_path ? "Yes" : "—"}
          subtitle={row.library_path ?? undefined}
        />
      </div>

      <FinalMetricsCard
        task={row.task}
        metrics={row.final_metrics}
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {events.isLoading ? (
          <Card>
            <CardContent className="py-12 text-center text-sm text-ink-muted">
              <Spinner /> Loading events…
            </CardContent>
          </Card>
        ) : series.length === 0 ? (
          <Card className="xl:col-span-2">
            <CardContent className="py-12 text-center text-sm text-ink-muted">
              No epoch events recorded for this run.
            </CardContent>
          </Card>
        ) : row.task === "classify" ? (
          <>
            <ChartCard title="Loss">
              <ClassifyLossChart series={series} />
            </ChartCard>
            <ChartCard title="Accuracy">
              <ClassifyAccuracyChart series={series} />
            </ChartCard>
          </>
        ) : (
          <>
            <ChartCard title="Loss">
              <DetectLossChart series={series} />
            </ChartCard>
            <ChartCard title="mAP">
              <DetectMapChart series={series} />
            </ChartCard>
          </>
        )}
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          disabled={row.dataset_missing || rerun.isPending}
          onClick={() => rerun.mutate()}
          title={
            row.dataset_missing
              ? "Dataset is gone — re-upload before re-running"
              : "Re-run with the same settings"
          }
        >
          {rerun.isPending ? <Spinner /> : <RotateCcw className="size-4" />}
          Re-run
        </Button>
        {row.status === "completed" &&
        row.best_pt_path &&
        !row.library_path ? (
          <Button
            size="sm"
            disabled={save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? <Spinner /> : <Save className="size-4" />}
            Save to library
          </Button>
        ) : null}
        <Button
          size="sm"
          onClick={() => setDeleteOpen(true)}
          className="bg-red-600 text-white hover:bg-red-700"
        >
          <Trash2 className="size-4" /> Delete run
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
                Free-text notes about this run. Empty = clear.
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
          name={row.name}
          libraryPath={row.library_path}
          pending={remove.isPending}
          onCancel={() => setDeleteOpen(false)}
          onConfirm={(deleteCheckpoint) => remove.mutate(deleteCheckpoint)}
        />
      ) : null}
    </section>
  );
}

function SummaryCard({
  title,
  value,
  subtitle,
  dim,
}: {
  title: string;
  value: string;
  subtitle?: string;
  dim?: boolean;
}) {
  return (
    <Card>
      <CardContent className="space-y-1 py-4">
        <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
          {title}
        </p>
        <p
          className={cn(
            "text-lg font-medium",
            dim ? "text-ink-muted/60 line-through" : "text-ink",
          )}
          title={subtitle}
        >
          {value}
        </p>
        {subtitle ? (
          <p
            className="truncate text-xs text-ink-muted"
            title={subtitle}
          >
            {subtitle}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function FinalMetricsCard({
  task,
  metrics,
}: {
  task: "detect" | "classify";
  metrics: TrainingMetrics;
}) {
  const fields =
    task === "classify"
      ? [
          { key: "top1", label: "Top-1 accuracy" },
          { key: "top5", label: "Top-5 accuracy" },
          { key: "loss", label: "Loss" },
        ]
      : [
          { key: "mAP50", label: "mAP@0.5" },
          { key: "mAP50_95", label: "mAP@0.5:0.95" },
          { key: "box_loss", label: "Box loss" },
          { key: "cls_loss", label: "Class loss" },
          { key: "dfl_loss", label: "DFL loss" },
        ];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <LineChartIcon className="size-4 text-accent" />
          Final metrics
        </CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        {fields.map((f) => {
          const v = (metrics as unknown as Record<string, number | null>)[
            f.key
          ];
          return (
            <div key={f.key} className="space-y-1">
              <p className="text-xs uppercase tracking-wide text-ink-muted">
                {f.label}
              </p>
              <p className="text-lg font-medium tabular-nums">
                {v !== null && v !== undefined ? v.toFixed(4) : "—"}
              </p>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function ChartCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <LineChartIcon className="size-4 text-accent" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function DetectLossChart({ series }: { series: ChartRow[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={series}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="epoch" stroke="#64748b" fontSize={11} />
        <YAxis stroke="#64748b" fontSize={11} />
        <Tooltip />
        <Legend />
        <Line type="monotone" dataKey="box_loss" stroke="#0ea5e9" dot={false} />
        <Line type="monotone" dataKey="cls_loss" stroke="#10b981" dot={false} />
        <Line type="monotone" dataKey="dfl_loss" stroke="#f59e0b" dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function DetectMapChart({ series }: { series: ChartRow[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={series}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="epoch" stroke="#64748b" fontSize={11} />
        <YAxis stroke="#64748b" fontSize={11} domain={[0, 1]} />
        <Tooltip />
        <Legend />
        <Line type="monotone" dataKey="mAP50" stroke="#0ea5e9" dot={false} />
        <Line type="monotone" dataKey="mAP50_95" stroke="#10b981" dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function ClassifyLossChart({ series }: { series: ChartRow[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={series}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="epoch" stroke="#64748b" fontSize={11} />
        <YAxis stroke="#64748b" fontSize={11} />
        <Tooltip />
        <Legend />
        <Line type="monotone" dataKey="loss" stroke="#0ea5e9" dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function ClassifyAccuracyChart({ series }: { series: ChartRow[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={series}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="epoch" stroke="#64748b" fontSize={11} />
        <YAxis stroke="#64748b" fontSize={11} domain={[0, 1]} />
        <Tooltip />
        <Legend />
        <Line type="monotone" dataKey="top1" stroke="#0ea5e9" dot={false} />
        <Line type="monotone" dataKey="top5" stroke="#10b981" dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function DeleteModal({
  name,
  libraryPath,
  pending,
  onCancel,
  onConfirm,
}: {
  name: string;
  libraryPath: string | null;
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
          <CardTitle>Delete this training run?</CardTitle>
          <CardDescription>
            The history row for <span className="font-mono">{name}</span> +
            its event log will be removed.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {libraryPath ? (
            <label className="flex cursor-pointer items-start gap-2 rounded-md border border-surface-muted bg-surface px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={alsoDeleteCheckpoint}
                onChange={(e) => setAlsoDeleteCheckpoint(e.target.checked)}
                className="mt-0.5"
              />
              <span className="flex flex-col gap-0.5">
                <span className="font-medium">
                  Also delete the saved checkpoint
                </span>
                <span className="text-xs text-ink-muted">
                  Removes{" "}
                  <span className="font-mono break-all">{libraryPath}</span>{" "}
                  from /models too.
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
