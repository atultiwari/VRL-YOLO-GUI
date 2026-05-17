"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Cpu, Microscope, Brain, Star } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { fetchModels, setDefaultModel } from "@/lib/api";
import { cn, formatBytes, formatParams } from "@/lib/utils";
import type { ModelInfo, Task } from "@/lib/types";

const SOURCE_LABEL: Record<ModelInfo["source"], string> = {
  bundled: "Bundled",
  user: "Imported",
  trained: "Trained locally",
};

function ModelCard({
  model,
  isDefault,
  onSetDefault,
  pendingDefault,
}: {
  model: ModelInfo;
  isDefault: boolean;
  onSetDefault: (model: ModelInfo) => void;
  pendingDefault: boolean;
}) {
  const classList = Object.values(model.classes).slice(0, 4).join(", ");
  const more = Math.max(0, model.num_classes - 4);

  return (
    <Card className={cn(isDefault && "border-accent ring-1 ring-accent/30")}>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="truncate">{model.name}</CardTitle>
          {isDefault ? (
            <Badge tone="accent" className="shrink-0">
              <Star className="mr-1 size-3 fill-current" />
              Default
            </Badge>
          ) : null}
        </div>
        <CardDescription className="capitalize">
          {SOURCE_LABEL[model.source]} · {model.task === "detect" ? "Object detection" : "Image classification"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm text-ink-muted">
        <div className="flex justify-between">
          <span>Classes</span>
          <span className="font-medium text-ink">{model.num_classes}</span>
        </div>
        <p className="text-xs text-ink-muted/80">
          {classList}
          {more > 0 ? `, +${more} more` : ""}
        </p>
        <div className="flex justify-between border-t border-surface-muted pt-2">
          <span>Parameters</span>
          <span className="font-medium text-ink">{formatParams(model.params)}</span>
        </div>
        <div className="flex justify-between">
          <span>Size</span>
          <span className="font-medium text-ink">{formatBytes(model.size_mb)}</span>
        </div>
      </CardContent>
      <CardFooter>
        <Button
          variant={isDefault ? "ghost" : "secondary"}
          size="sm"
          disabled={isDefault || pendingDefault}
          onClick={() => onSetDefault(model)}
        >
          {isDefault ? (
            <>
              <Check className="size-4" /> default
            </>
          ) : pendingDefault ? (
            <>
              <Spinner /> setting…
            </>
          ) : (
            "Set as default"
          )}
        </Button>
      </CardFooter>
    </Card>
  );
}

function TaskSection({
  task,
  title,
  icon,
  description,
  models,
  defaultName,
  onSetDefault,
  pendingFor,
}: {
  task: Task;
  title: string;
  icon: React.ReactNode;
  description: string;
  models: ModelInfo[];
  defaultName: string | undefined;
  onSetDefault: (model: ModelInfo) => void;
  pendingFor: string | null;
}) {
  return (
    <section className="flex flex-col gap-4">
      <header className="flex items-start gap-3">
        <div className="flex size-10 items-center justify-center rounded-lg bg-accent-subtle text-accent">
          {icon}
        </div>
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          <p className="text-sm text-ink-muted">{description}</p>
        </div>
      </header>
      {models.length === 0 ? (
        <div className="rounded-xl border border-dashed border-surface-muted bg-surface-subtle p-10 text-center text-sm text-ink-muted">
          {task === "classify"
            ? "Classification weights land in P2 — fetch them via `scripts/fetch-models.py --task classify`."
            : "No detection models yet. Run `scripts/fetch-models.py --task detect`."}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {models.map((m) => (
            <ModelCard
              key={m.name}
              model={m}
              isDefault={defaultName === m.name}
              pendingDefault={pendingFor === m.name}
              onSetDefault={onSetDefault}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export default function ModelsPage() {
  const queryClient = useQueryClient();
  const [pendingFor, setPendingFor] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["models"],
    queryFn: fetchModels,
  });

  const setDefault = useMutation({
    mutationFn: async ({ task, model }: { task: Task; model: ModelInfo }) => {
      setPendingFor(model.name);
      await setDefaultModel(task, model.name);
    },
    onSettled: async () => {
      setPendingFor(null);
      await queryClient.invalidateQueries({ queryKey: ["models"] });
    },
  });

  const detectModels = data?.models.filter((m) => m.task === "detect") ?? [];
  const classifyModels = data?.models.filter((m) => m.task === "classify") ?? [];

  return (
    <section className="flex h-full flex-col gap-10 px-12 py-12">
      <header className="flex items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-ink-muted">
            Models · Library
          </p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight">Model library</h1>
          <p className="mt-3 max-w-2xl text-ink-muted">
            Bundled starter weights plus any model you import or train locally. The
            default per task drives Predict mode — set the one you want as default
            once, then Predict picks it up automatically.
          </p>
        </div>
        <div className="hidden gap-2 md:flex">
          <Badge tone="subtle">
            <Cpu className="mr-1 size-3" />
            {data ? `${data.models.length} model${data.models.length === 1 ? "" : "s"}` : "—"}
          </Badge>
        </div>
      </header>

      {isLoading ? (
        <div className="flex items-center gap-3 text-sm text-ink-muted">
          <Spinner /> Loading model library…
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-800">
          Failed to load model library. Backend at <code>/api/models</code> returned an error.
        </div>
      ) : (
        <>
          <TaskSection
            task="detect"
            title="Detection models"
            description="Per-object localisation. Cell counts, mitosis detection, malaria screen, WBC differential."
            icon={<Microscope className="size-5" />}
            models={detectModels}
            defaultName={data?.defaults.detect}
            pendingFor={pendingFor}
            onSetDefault={(m) => setDefault.mutate({ task: "detect", model: m })}
          />
          <TaskSection
            task="classify"
            title="Classification models"
            description="Per-image label. Tumour subtype, Gleason grade, smear pathology, marrow pattern."
            icon={<Brain className="size-5" />}
            models={classifyModels}
            defaultName={data?.defaults.classify}
            pendingFor={pendingFor}
            onSetDefault={(m) => setDefault.mutate({ task: "classify", model: m })}
          />
        </>
      )}
    </section>
  );
}
