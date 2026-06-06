"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Brain,
  Check,
  Cpu,
  Download,
  FolderOpen,
  Microscope,
  PencilLine,
  Sparkles,
  Star,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useRef, useState } from "react";

import { TestExplanationModal } from "@/components/models/test-explanation-modal";
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
import {
  ApiError,
  deleteModel,
  fetchModels,
  importModel,
  modelDownloadUrl,
  renameModel,
  revealModel,
  setDefaultModel,
} from "@/lib/api";
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
  const queryClient = useQueryClient();
  const classList = Object.values(model.classes).slice(0, 4).join(", ");
  const more = Math.max(0, model.num_classes - 4);
  const isBundled = model.source === "bundled";
  const canRename = !isBundled;
  const canDelete = !isBundled;

  const [isRenaming, setIsRenaming] = useState(false);
  const [draft, setDraft] = useState(model.name);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [revealError, setRevealError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [testOpen, setTestOpen] = useState(false);

  const rename = useMutation({
    mutationFn: async () => {
      let next = draft.trim();
      if (!next) throw new Error("name can't be empty");
      if (!next.toLowerCase().endsWith(".pt")) next = `${next}.pt`;
      return renameModel(model.name, next);
    },
    onSuccess: async () => {
      setIsRenaming(false);
      setRenameError(null);
      await queryClient.invalidateQueries({ queryKey: ["models"] });
    },
    onError: (err) => {
      setRenameError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
          ? err.message
          : "Rename failed",
      );
    },
  });

  const reveal = useMutation({
    mutationFn: async () => revealModel(model.name),
    onSuccess: () => setRevealError(null),
    onError: (err) => {
      setRevealError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
          ? err.message
          : "Could not open file manager",
      );
    },
  });

  const startRename = () => {
    setDraft(model.name);
    setRenameError(null);
    setIsRenaming(true);
  };

  const cancelRename = () => {
    setIsRenaming(false);
    setRenameError(null);
  };

  const onDownload = () => {
    // Use a real anchor click so QtWebEngine's downloadRequested handler
    // (src-pyloid/main.py) picks it up and lands the file in ~/Downloads/.
    const a = document.createElement("a");
    a.href = modelDownloadUrl(model.name);
    a.download = model.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <Card className={cn(isDefault && "border-accent ring-1 ring-accent/30")}>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          {isRenaming ? (
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={rename.isPending}
              onKeyDown={(e) => {
                if (e.key === "Enter") rename.mutate();
                if (e.key === "Escape") cancelRename();
              }}
              className="h-8 flex-1 min-w-0 rounded-md border border-surface-muted bg-surface px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            />
          ) : (
            <CardTitle className="truncate" title={model.name}>
              {model.name}
            </CardTitle>
          )}
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
        <div className="border-t border-surface-muted pt-2">
          <span className="block text-xs uppercase tracking-wide text-ink-muted/70">
            On disk
          </span>
          <code
            className="mt-1 block truncate font-mono text-xs text-ink-muted"
            title={model.path}
          >
            {model.path}
          </code>
        </div>
        {renameError ? (
          <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-800">
            <AlertTriangle className="mt-0.5 size-3 shrink-0" />
            <span>{renameError}</span>
          </div>
        ) : null}
        {revealError ? (
          <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-800">
            <AlertTriangle className="mt-0.5 size-3 shrink-0" />
            <span>{revealError}</span>
          </div>
        ) : null}
      </CardContent>
      <CardFooter className="flex flex-wrap items-center gap-2">
        {isRenaming ? (
          <>
            <Button
              size="sm"
              disabled={
                rename.isPending ||
                draft.trim() === "" ||
                draft.trim() === model.name
              }
              onClick={() => rename.mutate()}
            >
              {rename.isPending ? (
                <>
                  <Spinner /> Saving…
                </>
              ) : (
                <>
                  <Check className="size-4" /> Save
                </>
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={rename.isPending}
              onClick={cancelRename}
            >
              <X className="size-4" /> Cancel
            </Button>
          </>
        ) : (
          <>
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
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setTestOpen(true)}
              title={`Test what ${model.name} looks at on a sample image`}
            >
              <Sparkles className="size-4" /> Test
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onDownload}
              title={`Download ${model.name}`}
            >
              <Download className="size-4" /> Download
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => reveal.mutate()}
              disabled={reveal.isPending}
              title={`Reveal ${model.name} in your file manager`}
            >
              <FolderOpen className="size-4" /> Reveal
            </Button>
            {canRename ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={startRename}
                title="Rename this checkpoint"
              >
                <PencilLine className="size-4" /> Rename
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDeleteOpen(true)}
              disabled={!canDelete}
              title={
                canDelete
                  ? `Delete ${model.name}`
                  : "Bundled models are read-only"
              }
              className={canDelete ? "text-red-700 hover:bg-red-50" : undefined}
            >
              <Trash2 className="size-4" /> Delete
            </Button>
          </>
        )}
      </CardFooter>
      {deleteOpen ? (
        <DeleteModelModal
          model={model}
          onClose={() => setDeleteOpen(false)}
          onDeleted={async () => {
            setDeleteOpen(false);
            await queryClient.invalidateQueries({ queryKey: ["models"] });
          }}
        />
      ) : null}
      {testOpen ? (
        <TestExplanationModal model={model} onClose={() => setTestOpen(false)} />
      ) : null}
    </Card>
  );
}

function DeleteModelModal({
  model,
  onClose,
  onDeleted,
}: {
  model: ModelInfo;
  onClose: () => void;
  onDeleted: () => void | Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);

  const remove = useMutation({
    mutationFn: async () => deleteModel(model.name),
    onSuccess: async () => {
      setError(null);
      await onDeleted();
    },
    onError: (err) => {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
          ? err.message
          : "Delete failed",
      );
    },
  });

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-model-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !remove.isPending) onClose();
      }}
    >
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="flex items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-red-100 text-red-700">
              <Trash2 className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <CardTitle id="delete-model-title">Delete this model?</CardTitle>
              <CardDescription>
                <span className="font-mono text-ink">{model.name}</span> will be
                permanently removed from disk. This can&apos;t be undone.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="rounded-md border border-surface-muted bg-surface-subtle px-3 py-2">
            <span className="block text-xs uppercase tracking-wide text-ink-muted/70">
              On disk
            </span>
            <code className="mt-1 block break-all font-mono text-xs text-ink-muted">
              {model.path}
            </code>
          </div>
          {error ? (
            <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-800">
              <AlertTriangle className="mt-0.5 size-3 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}
        </CardContent>
        <CardFooter className="flex justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={remove.isPending}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={remove.isPending}
            onClick={() => remove.mutate()}
            className="bg-red-600 text-white hover:bg-red-700"
          >
            {remove.isPending ? (
              <>
                <Spinner /> Deleting…
              </>
            ) : (
              <>
                <Trash2 className="size-4" /> Delete
              </>
            )}
          </Button>
        </CardFooter>
      </Card>
    </div>
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
            ? "No classification models yet. Fetch them via `scripts/fetch-models.py --task classify`, or import your own .pt above."
            : "No detection models yet. Fetch them via `scripts/fetch-models.py --task detect`, or import your own .pt above."}
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

function ImportButton() {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastImported, setLastImported] = useState<string | null>(null);

  const importMutation = useMutation({
    mutationFn: importModel,
    onSuccess: async (data) => {
      setLastImported(data.name);
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ["models"] });
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Import failed");
      setLastImported(null);
    },
  });

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset the input so re-selecting the same file fires onChange again.
    e.target.value = "";
    if (!file) return;
    setError(null);
    importMutation.mutate(file);
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        disabled={importMutation.isPending}
        onClick={() => inputRef.current?.click()}
      >
        {importMutation.isPending ? (
          <>
            <Spinner /> Importing…
          </>
        ) : (
          <>
            <Upload className="size-4" /> Import .pt
          </>
        )}
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept=".pt,application/octet-stream"
        className="hidden"
        onChange={onChange}
      />
      {lastImported ? (
        <p className="text-xs text-clinical">Imported {lastImported}</p>
      ) : null}
      {error ? (
        <p className="max-w-[320px] text-right text-xs text-red-700">{error}</p>
      ) : null}
    </div>
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
        <div className="flex flex-col items-end gap-3">
          <Badge tone="subtle">
            <Cpu className="mr-1 size-3" />
            {data ? `${data.models.length} model${data.models.length === 1 ? "" : "s"}` : "—"}
          </Badge>
          <ImportButton />
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
