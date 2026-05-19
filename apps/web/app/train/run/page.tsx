"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  CircleStop,
  Cloud,
  ExternalLink,
  Eye,
  LineChart as LineChartIcon,
  Loader2,
  RotateCcw,
  Save,
  Sparkles,
  TerminalSquare,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  cancelTraining,
  getTrainingJob,
  saveTrainingToLibrary,
  setDefaultModel,
  trainingStreamUrl,
} from "@/lib/api";
import { useTrainStore } from "@/lib/train-store";
import type {
  ModelInfo,
  Task,
  TrainingEvent,
  TrainingJobInfo,
  TrainingMetrics,
  TrainingStatus,
} from "@/lib/types";
import { cn } from "@/lib/utils";

const LOG_MAX_LINES = 200;

const STATUS_TONE: Record<
  TrainingStatus,
  { tone: "subtle" | "accent" | "clinical" | "danger"; label: string }
> = {
  queued: { tone: "subtle", label: "queued" },
  running: { tone: "accent", label: "running" },
  completed: { tone: "clinical", label: "completed" },
  failed: { tone: "danger", label: "failed" },
  cancelled: { tone: "subtle", label: "cancelled" },
};

interface ChartRow {
  epoch: number;
  // detect-only
  box_loss: number | null;
  cls_loss: number | null;
  dfl_loss: number | null;
  mAP50: number | null;
  mAP50_95: number | null;
  // classify-only
  loss: number | null;
  top1: number | null;
  top5: number | null;
}

export default function TrainRunPage() {
  const router = useRouter();
  const { activeJobId, dataset, hyperparams, setActiveJob } = useTrainStore();

  // Pull the initial snapshot on mount so a hard refresh redraws the
  // last-known state before the WebSocket replay catches up.
  const initial = useQuery({
    queryKey: ["training", activeJobId],
    queryFn: () => getTrainingJob(activeJobId as string),
    enabled: !!activeJobId,
    retry: 1,
    refetchOnWindowFocus: false,
  });

  const [status, setStatus] = useState<TrainingStatus>("queued");
  const [snapshot, setSnapshot] = useState<TrainingJobInfo | null>(null);
  const [seriesByEpoch, setSeriesByEpoch] = useState<Map<number, ChartRow>>(
    () => new Map(),
  );
  const [log, setLog] = useState<string[]>([]);
  const [terminalError, setTerminalError] = useState<string | null>(null);
  const [bestPt, setBestPt] = useState<string | null>(null);
  const [savedModel, setSavedModel] = useState<ModelInfo | null>(null);
  const [connectionState, setConnectionState] = useState<
    "connecting" | "open" | "closed"
  >("connecting");
  // Colab-only: the desktop-synthesised `connection` events surface
  // reconnect-with-backoff state between the desktop and the tunnel.
  // null when no banner needed.
  const [colabConnection, setColabConnection] = useState<{
    status: "reconnecting" | "reconnected" | "abandoned";
    attempt: number;
    delay_s?: number;
    message: string;
  } | null>(null);

  // Seed from /api/training/{id} so the chart renders before the WS opens.
  useEffect(() => {
    if (!initial.data) return;
    setStatus(initial.data.status);
    setSnapshot(initial.data);
  }, [initial.data]);

  // Bail out if there's no active job — typical when a user navigates
  // here directly without going through configure.
  useEffect(() => {
    if (!activeJobId) {
      router.replace("/train/configure");
    }
  }, [activeJobId, router]);

  const pushLog = useCallback((line: string) => {
    setLog((prev) => {
      const next = prev.length >= LOG_MAX_LINES ? prev.slice(1) : prev;
      return [...next, line];
    });
  }, []);

  const applyEvent = useCallback(
    (event: TrainingEvent) => {
      switch (event.type) {
        case "hello":
          setStatus(event.status);
          break;
        case "start":
          setStatus("running");
          pushLog(
            `start · ${event.model} · ${event.epochs} epochs @ ${event.imgsz}px (batch ${event.batch}, device ${event.device ?? "auto"})`,
          );
          break;
        case "epoch": {
          const row: ChartRow = {
            epoch: event.epoch,
            box_loss: event.metrics.box_loss,
            cls_loss: event.metrics.cls_loss,
            dfl_loss: event.metrics.dfl_loss,
            mAP50: event.metrics.mAP50,
            mAP50_95: event.metrics.mAP50_95,
            loss: event.metrics.loss,
            top1: event.metrics.top1,
            top5: event.metrics.top5,
          };
          setSeriesByEpoch((prev) => {
            const next = new Map(prev);
            next.set(event.epoch, row);
            return next;
          });
          setSnapshot((prev) =>
            prev
              ? {
                  ...prev,
                  epoch_current: event.epoch,
                  metrics: { ...prev.metrics, ...event.metrics },
                }
              : prev,
          );
          pushLog(
            `epoch ${event.epoch}/${event.epoch_total} · ${formatMetrics(event.metrics)}`,
          );
          break;
        }
        case "complete":
          setStatus("completed");
          setBestPt(event.best_pt);
          pushLog(`complete · best ${event.best_pt ?? "(missing)"}`);
          setSnapshot((prev) =>
            prev
              ? {
                  ...prev,
                  status: "completed",
                  metrics: {
                    ...prev.metrics,
                    ...(event.metrics as Partial<TrainingMetrics>),
                  },
                }
              : prev,
          );
          break;
        case "error":
          setStatus("failed");
          setTerminalError(event.message);
          pushLog(`error · ${event.message}`);
          setSnapshot((prev) =>
            prev ? { ...prev, status: "failed" } : prev,
          );
          break;
        case "cancelled":
          setStatus("cancelled");
          pushLog(event.message ?? "cancelled");
          setSnapshot((prev) =>
            prev ? { ...prev, status: "cancelled" } : prev,
          );
          break;
        case "log":
          pushLog(event.line);
          break;
        case "closed":
          setStatus(event.status);
          break;
        case "connection": {
          // Banner clears itself when reconnect succeeds; stays on
          // "abandoned" until the follow-up `error` event flips the
          // job to failed (and the banner becomes redundant beside the
          // terminal-error card).
          if (event.status === "reconnected") {
            setColabConnection(null);
          } else {
            setColabConnection({
              status: event.status,
              attempt: event.attempt,
              delay_s: event.delay_s,
              message: event.message,
            });
          }
          pushLog(`colab · ${event.status} · ${event.message}`);
          break;
        }
      }
    },
    [pushLog],
  );

  // --- WebSocket plumbing ---------------------------------------------
  const wsRef = useRef<WebSocket | null>(null);
  useEffect(() => {
    if (!activeJobId) return;
    let cancelled = false;
    setConnectionState("connecting");
    const ws = new WebSocket(trainingStreamUrl(activeJobId));
    wsRef.current = ws;

    ws.onopen = () => {
      if (cancelled) return;
      setConnectionState("open");
    };
    ws.onmessage = (msg) => {
      if (cancelled) return;
      try {
        const data = JSON.parse(msg.data) as TrainingEvent;
        applyEvent(data);
      } catch {
        // Ignore malformed frames — the backend only sends JSON.
      }
    };
    ws.onerror = () => {
      // No-op: onclose will fire and surface terminal state via the
      // GET-snapshot fallback below.
    };
    ws.onclose = () => {
      if (cancelled) return;
      setConnectionState("closed");
    };
    return () => {
      cancelled = true;
      ws.close();
      wsRef.current = null;
    };
  }, [activeJobId, applyEvent]);

  const series = useMemo(() => {
    const rows = Array.from(seriesByEpoch.values());
    rows.sort((a, b) => a.epoch - b.epoch);
    return rows;
  }, [seriesByEpoch]);

  // --- Actions ---------------------------------------------------------
  const cancel = useMutation({
    mutationFn: async () => {
      if (!activeJobId) throw new Error("no active job");
      return cancelTraining(activeJobId);
    },
    onError: (err) =>
      pushLog(
        `cancel failed · ${err instanceof Error ? err.message : "unknown"}`,
      ),
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!activeJobId) throw new Error("no active job");
      const model = await saveTrainingToLibrary(activeJobId);
      // Make this model the new default for /predict so the trained run
      // is one click away. Use the model's reported task (not the
      // snapshot's) — the server is the source of truth for what the
      // checkpoint actually contains.
      try {
        await setDefaultModel(model.task, model.name);
      } catch {
        // Non-fatal — the model is in the library either way.
      }
      return model;
    },
    onSuccess: (model) => {
      setSavedModel(model);
      pushLog(`saved · ${model.name}`);
    },
    onError: (err) =>
      pushLog(
        `save failed · ${err instanceof Error ? err.message : "unknown"}`,
      ),
  });

  const onTrainAnother = () => {
    setActiveJob(null);
    router.push("/train");
  };

  const onOpenPredict = () => {
    router.push("/predict");
  };

  if (!activeJobId) return null;

  const epochTotal = snapshot?.epochs_total ?? hyperparams.epochs;
  const epochCurrent = snapshot?.epoch_current ?? 0;
  const progressPct =
    epochTotal > 0 ? Math.min(100, (epochCurrent / epochTotal) * 100) : 0;

  const isTerminal =
    status === "completed" || status === "failed" || status === "cancelled";

  // Source of truth for which charts to draw. Falls back to detect for
  // the brief moment between mount and the first `/api/training/{id}`
  // response — by the time the first epoch event arrives `snapshot.task`
  // is set, so the chart re-renders correctly.
  const task: Task = snapshot?.task ?? "detect";

  const statusBadge = STATUS_TONE[status];

  return (
    <section className="flex h-full flex-col gap-8 px-12 py-12">
      <header className="flex items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-ink-muted">
            Train · live run
          </p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight">
            {statusLabel(status)}
          </h1>
          <p className="mt-3 max-w-3xl text-ink-muted">
            {snapshot ? (
              <>
                Job{" "}
                <code className="rounded bg-surface-muted px-1 py-0.5 text-xs">
                  {snapshot.job_id.slice(0, 8)}
                </code>
                {" · "}
                {snapshot.model}
                {" · "}
                {snapshot.accelerator_kind.toUpperCase()}
                {dataset ? ` · ${dataset.classes.length} classes` : ""}
              </>
            ) : (
              "Connecting to training job…"
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={statusBadge.tone}>
            {status === "running" ? (
              <Loader2 className="mr-1 size-3 animate-spin" />
            ) : status === "completed" ? (
              <CheckCircle2 className="mr-1 size-3" />
            ) : status === "failed" ? (
              <AlertTriangle className="mr-1 size-3" />
            ) : status === "cancelled" ? (
              <CircleStop className="mr-1 size-3" />
            ) : (
              <Sparkles className="mr-1 size-3" />
            )}
            {statusBadge.label}
          </Badge>
          <Badge tone="subtle" title={`WebSocket: ${connectionState}`}>
            {connectionState === "open"
              ? "ws · live"
              : connectionState === "connecting"
                ? "ws · …"
                : "ws · idle"}
          </Badge>
        </div>
      </header>

      {colabConnection ? (
        <ColabConnectionBanner state={colabConnection} />
      ) : null}

      <ProgressCard
        status={status}
        epochCurrent={epochCurrent}
        epochTotal={epochTotal}
        progressPct={progressPct}
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {task === "classify" ? (
          <>
            <MetricCard
              title="Loss"
              description="train/loss per epoch — lower is better."
              icon={<LineChartIcon className="size-4 text-accent" />}
            >
              <ClassifyLossChart series={series} />
            </MetricCard>
            <MetricCard
              title="Accuracy"
              description="Validation top-1 + top-5 per epoch — higher is better."
              icon={<LineChartIcon className="size-4 text-accent" />}
            >
              <ClassifyAccuracyChart series={series} />
            </MetricCard>
          </>
        ) : (
          <>
            <MetricCard
              title="Loss"
              description="train/{box,cls,dfl}_loss per epoch — lower is better."
              icon={<LineChartIcon className="size-4 text-accent" />}
            >
              <LossChart series={series} />
            </MetricCard>
            <MetricCard
              title="mAP"
              description="Validation mAP per epoch — higher is better."
              icon={<LineChartIcon className="size-4 text-accent" />}
            >
              <MapChart series={series} />
            </MetricCard>
          </>
        )}
      </div>

      <LogCard log={log} />

      <ActionsBar
        status={status}
        isTerminal={isTerminal}
        canCancel={
          (status === "running" || status === "queued") && !cancel.isPending
        }
        savedModel={savedModel}
        bestPt={bestPt}
        terminalError={terminalError}
        onCancel={() => cancel.mutate()}
        onSave={() => save.mutate()}
        saving={save.isPending}
        canSave={
          status === "completed" && bestPt !== null && savedModel === null
        }
        onTrainAnother={onTrainAnother}
        onOpenPredict={onOpenPredict}
      />
    </section>
  );
}

// --------------------------------------------------------------------------
// Sub-components
// --------------------------------------------------------------------------

function ColabConnectionBanner({
  state,
}: {
  state: {
    status: "reconnecting" | "reconnected" | "abandoned";
    attempt: number;
    delay_s?: number;
    message: string;
  };
}) {
  // Three palettes: reconnecting (amber, retrying), reconnected
  // (clinical green, transient — caller normally clears the banner
  // when this lands), abandoned (red, terminal — also accompanied by
  // a separate `error` event that fails the job).
  const palette = {
    reconnecting: {
      wrap: "border-amber-200 bg-amber-50 text-amber-900",
      icon: "text-amber-700",
      Icon: Loader2,
      spin: true,
    },
    reconnected: {
      wrap: "border-emerald-200 bg-emerald-50 text-emerald-900",
      icon: "text-emerald-700",
      Icon: CheckCircle2,
      spin: false,
    },
    abandoned: {
      wrap: "border-red-200 bg-red-50 text-red-900",
      icon: "text-red-700",
      Icon: AlertTriangle,
      spin: false,
    },
  }[state.status];

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-md border px-4 py-3 text-sm",
        palette.wrap,
      )}
    >
      <Cloud className={cn("mt-0.5 size-4 shrink-0", palette.icon)} />
      <div className="flex-1">
        <p className="flex items-center gap-2 font-medium">
          <palette.Icon
            className={cn(
              "size-3.5",
              palette.icon,
              palette.spin ? "animate-spin" : "",
            )}
          />
          {state.status === "reconnecting"
            ? `Reconnecting to Colab — attempt ${state.attempt}`
            : state.status === "reconnected"
              ? "Reconnected to Colab"
              : "Lost connection to Colab"}
        </p>
        <p className="mt-0.5 text-xs opacity-80">{state.message}</p>
      </div>
    </div>
  );
}

function ProgressCard({
  status,
  epochCurrent,
  epochTotal,
  progressPct,
}: {
  status: TrainingStatus;
  epochCurrent: number;
  epochTotal: number;
  progressPct: number;
}) {
  return (
    <Card>
      <CardContent className="space-y-3 py-5">
        <div className="flex items-center justify-between text-sm">
          <span className="text-ink-muted">
            Epoch{" "}
            <span className="font-medium text-ink tabular-nums">
              {epochCurrent}
            </span>
            {" / "}
            <span className="font-medium text-ink tabular-nums">
              {epochTotal}
            </span>
          </span>
          <span className="text-ink-muted tabular-nums">
            {progressPct.toFixed(1)}%
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-surface-muted">
          <div
            className={cn(
              "h-full rounded-full transition-all duration-500",
              status === "failed"
                ? "bg-red-500"
                : status === "cancelled"
                  ? "bg-amber-400"
                  : status === "completed"
                    ? "bg-clinical"
                    : "bg-accent",
            )}
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function MetricCard({
  title,
  description,
  icon,
  children,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {icon}
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function LossChart({ series }: { series: ChartRow[] }) {
  if (series.length === 0) {
    return <EmptyChart label="Waiting for first epoch…" />;
  }
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer>
        <LineChart
          data={series}
          margin={{ top: 8, right: 8, bottom: 8, left: 8 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--color-surface-muted)"
          />
          <XAxis
            dataKey="epoch"
            tick={{ fontSize: 12 }}
            stroke="var(--color-ink-muted)"
            label={{
              value: "epoch",
              position: "insideBottom",
              offset: -4,
              fontSize: 11,
            }}
          />
          <YAxis
            tick={{ fontSize: 12 }}
            stroke="var(--color-ink-muted)"
            width={48}
          />
          <Tooltip
            formatter={(v: number) => v.toFixed(4)}
            labelFormatter={(l) => `epoch ${l}`}
            contentStyle={{
              backgroundColor: "var(--color-surface)",
              border: "1px solid var(--color-surface-muted)",
              fontSize: 12,
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line
            type="monotone"
            dataKey="box_loss"
            stroke="#ef4444"
            dot={false}
            strokeWidth={2}
            isAnimationActive={false}
            connectNulls
          />
          <Line
            type="monotone"
            dataKey="cls_loss"
            stroke="#f59e0b"
            dot={false}
            strokeWidth={2}
            isAnimationActive={false}
            connectNulls
          />
          <Line
            type="monotone"
            dataKey="dfl_loss"
            stroke="#8b5cf6"
            dot={false}
            strokeWidth={2}
            isAnimationActive={false}
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function MapChart({ series }: { series: ChartRow[] }) {
  if (series.length === 0) {
    return <EmptyChart label="Waiting for first epoch…" />;
  }
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer>
        <LineChart
          data={series}
          margin={{ top: 8, right: 8, bottom: 8, left: 8 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--color-surface-muted)"
          />
          <XAxis
            dataKey="epoch"
            tick={{ fontSize: 12 }}
            stroke="var(--color-ink-muted)"
            label={{
              value: "epoch",
              position: "insideBottom",
              offset: -4,
              fontSize: 11,
            }}
          />
          <YAxis
            domain={[0, 1]}
            tick={{ fontSize: 12 }}
            stroke="var(--color-ink-muted)"
            width={48}
          />
          <Tooltip
            formatter={(v: number) => v.toFixed(4)}
            labelFormatter={(l) => `epoch ${l}`}
            contentStyle={{
              backgroundColor: "var(--color-surface)",
              border: "1px solid var(--color-surface-muted)",
              fontSize: 12,
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line
            type="monotone"
            dataKey="mAP50"
            stroke="#0ea5e9"
            dot={false}
            strokeWidth={2}
            isAnimationActive={false}
            connectNulls
          />
          <Line
            type="monotone"
            dataKey="mAP50_95"
            stroke="#10b981"
            dot={false}
            strokeWidth={2}
            isAnimationActive={false}
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="flex h-72 flex-col items-center justify-center gap-3 rounded-md border border-dashed border-surface-muted text-sm text-ink-muted">
      <Spinner />
      {label}
    </div>
  );
}

function LogCard({ log }: { log: string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    ref.current.scrollTop = ref.current.scrollHeight;
  }, [log]);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <TerminalSquare className="size-4 text-accent" />
          Training log
        </CardTitle>
        <CardDescription>
          Latest {LOG_MAX_LINES} lines. Full log lives at{" "}
          <code className="rounded bg-surface-muted px-1 py-0.5 text-xs">
            &lt;app_data&gt;/training/&lt;job_id&gt;/
          </code>
          .
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div
          ref={ref}
          className="h-48 overflow-y-auto rounded-md border border-surface-muted bg-surface-subtle px-3 py-2 font-mono text-xs leading-relaxed"
        >
          {log.length === 0 ? (
            <span className="text-ink-muted">waiting for output…</span>
          ) : (
            log.map((line, idx) => (
              <div
                key={idx}
                className="whitespace-pre-wrap break-words text-ink"
              >
                {line}
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ActionsBar({
  status,
  isTerminal,
  canCancel,
  canSave,
  saving,
  savedModel,
  bestPt,
  terminalError,
  onCancel,
  onSave,
  onTrainAnother,
  onOpenPredict,
}: {
  status: TrainingStatus;
  isTerminal: boolean;
  canCancel: boolean;
  canSave: boolean;
  saving: boolean;
  savedModel: ModelInfo | null;
  bestPt: string | null;
  terminalError: string | null;
  onCancel: () => void;
  onSave: () => void;
  onTrainAnother: () => void;
  onOpenPredict: () => void;
}) {
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
        <div className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
          {status === "completed" && bestPt ? (
            <span>
              Best checkpoint:{" "}
              <code className="rounded bg-surface-muted px-1 py-0.5 text-xs">
                {bestPt.split("/").slice(-2).join("/")}
              </code>
            </span>
          ) : null}
          {status === "failed" && terminalError ? (
            <span className="text-red-700">{terminalError}</span>
          ) : null}
          {savedModel ? (
            <span className="inline-flex items-center gap-1 text-clinical">
              <Check className="size-4" /> Saved as{" "}
              <code className="rounded bg-clinical-subtle px-1 py-0.5 text-xs">
                {savedModel.name}
              </code>
              .
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!isTerminal ? (
            <Button
              variant="destructive"
              disabled={!canCancel}
              onClick={onCancel}
            >
              <CircleStop className="size-4" /> Cancel run
            </Button>
          ) : null}
          {canSave ? (
            <Button onClick={onSave} disabled={saving}>
              {saving ? (
                <>
                  <Spinner /> Saving…
                </>
              ) : (
                <>
                  <Save className="size-4" /> Save to library
                </>
              )}
            </Button>
          ) : null}
          {savedModel ? (
            <Button onClick={onOpenPredict}>
              <Eye className="size-4" /> Open in Predict
              <ExternalLink className="size-3" />
            </Button>
          ) : null}
          {isTerminal ? (
            <Button variant="ghost" onClick={onTrainAnother}>
              <RotateCcw className="size-4" /> Train another
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function statusLabel(status: TrainingStatus): string {
  switch (status) {
    case "queued":
      return "Queued — waiting for runner to pick up.";
    case "running":
      return "Training in progress…";
    case "completed":
      return "Training complete.";
    case "failed":
      return "Training failed.";
    case "cancelled":
      return "Training cancelled.";
  }
}

function formatMetrics(m: TrainingMetrics): string {
  const parts: string[] = [];
  // Detect keys
  if (m.box_loss !== null) parts.push(`box ${m.box_loss.toFixed(4)}`);
  if (m.cls_loss !== null) parts.push(`cls ${m.cls_loss.toFixed(4)}`);
  if (m.dfl_loss !== null) parts.push(`dfl ${m.dfl_loss.toFixed(4)}`);
  if (m.mAP50 !== null) parts.push(`mAP50 ${m.mAP50.toFixed(4)}`);
  if (m.mAP50_95 !== null) parts.push(`mAP50-95 ${m.mAP50_95.toFixed(4)}`);
  // Classify keys
  if (m.loss !== null) parts.push(`loss ${m.loss.toFixed(4)}`);
  if (m.top1 !== null) parts.push(`top1 ${m.top1.toFixed(4)}`);
  if (m.top5 !== null) parts.push(`top5 ${m.top5.toFixed(4)}`);
  return parts.join(" · ") || "(no metrics)";
}

function ClassifyLossChart({ series }: { series: ChartRow[] }) {
  if (series.length === 0) {
    return <EmptyChart label="Waiting for first epoch…" />;
  }
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer>
        <LineChart
          data={series}
          margin={{ top: 8, right: 8, bottom: 8, left: 8 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--color-surface-muted)"
          />
          <XAxis
            dataKey="epoch"
            tick={{ fontSize: 12 }}
            stroke="var(--color-ink-muted)"
            label={{
              value: "epoch",
              position: "insideBottom",
              offset: -4,
              fontSize: 11,
            }}
          />
          <YAxis
            tick={{ fontSize: 12 }}
            stroke="var(--color-ink-muted)"
            width={48}
          />
          <Tooltip
            formatter={(v: number) => v.toFixed(4)}
            labelFormatter={(l) => `epoch ${l}`}
            contentStyle={{
              backgroundColor: "var(--color-surface)",
              border: "1px solid var(--color-surface-muted)",
              fontSize: 12,
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line
            type="monotone"
            dataKey="loss"
            stroke="#ef4444"
            dot={false}
            strokeWidth={2}
            isAnimationActive={false}
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function ClassifyAccuracyChart({ series }: { series: ChartRow[] }) {
  if (series.length === 0) {
    return <EmptyChart label="Waiting for first epoch…" />;
  }
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer>
        <LineChart
          data={series}
          margin={{ top: 8, right: 8, bottom: 8, left: 8 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--color-surface-muted)"
          />
          <XAxis
            dataKey="epoch"
            tick={{ fontSize: 12 }}
            stroke="var(--color-ink-muted)"
            label={{
              value: "epoch",
              position: "insideBottom",
              offset: -4,
              fontSize: 11,
            }}
          />
          <YAxis
            domain={[0, 1]}
            tick={{ fontSize: 12 }}
            stroke="var(--color-ink-muted)"
            width={48}
          />
          <Tooltip
            formatter={(v: number) => v.toFixed(4)}
            labelFormatter={(l) => `epoch ${l}`}
            contentStyle={{
              backgroundColor: "var(--color-surface)",
              border: "1px solid var(--color-surface-muted)",
              fontSize: 12,
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line
            type="monotone"
            dataKey="top1"
            stroke="#0ea5e9"
            dot={false}
            strokeWidth={2}
            isAnimationActive={false}
            connectNulls
          />
          <Line
            type="monotone"
            dataKey="top5"
            stroke="#10b981"
            dot={false}
            strokeWidth={2}
            isAnimationActive={false}
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
