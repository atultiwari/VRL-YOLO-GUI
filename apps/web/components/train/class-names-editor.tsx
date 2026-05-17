"use client";

import { useMutation } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  PencilLine,
  RotateCcw,
  Tag,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

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
import { ApiError, renameDatasetClasses } from "@/lib/api";
import type { DatasetInfo } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * `class_<N>` is the placeholder name `engine/dataset.py` emits for
 * plain YOLO datasets that have no `data.yaml`. The editor highlights
 * these so the user knows they need real names before training.
 */
const PLACEHOLDER_PATTERN = /^class_\d+$/;

export interface ClassNamesEditorProps {
  dataset: DatasetInfo;
  onDatasetChanged: (next: DatasetInfo) => void;
}

export function ClassNamesEditor({
  dataset,
  onDatasetChanged,
}: ClassNamesEditorProps) {
  // Local working copy so a user can edit + revert without round-tripping
  // through the backend on every keystroke.
  const [draft, setDraft] = useState<string[]>(dataset.classes);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    setDraft(dataset.classes);
    setError(null);
  }, [dataset.classes]);

  const hasPlaceholders = useMemo(
    () => dataset.classes.some((n) => PLACEHOLDER_PATTERN.test(n)),
    [dataset.classes],
  );
  const dirty = useMemo(
    () =>
      draft.length !== dataset.classes.length ||
      draft.some((v, i) => v.trim() !== dataset.classes[i]),
    [draft, dataset.classes],
  );

  // Local-only validation. The backend rejects the same cases (with
  // friendlier 400 messages) but pre-flighting here means the user
  // sees the problem before the round-trip.
  const localValidation = useMemo(() => {
    const trimmed = draft.map((v) => v.trim());
    for (let i = 0; i < trimmed.length; i++) {
      if (trimmed[i] === "") return `Class ${i} has an empty name.`;
    }
    const seen = new Set<string>();
    for (const name of trimmed) {
      if (seen.has(name)) return `Duplicate name: "${name}".`;
      seen.add(name);
    }
    return null;
  }, [draft]);

  const save = useMutation({
    mutationFn: async () => {
      const trimmed = draft.map((v) => v.trim());
      return renameDatasetClasses(dataset.id, trimmed);
    },
    onSuccess: (next) => {
      onDatasetChanged(next);
      setError(null);
      setSavedAt(Date.now());
    },
    onError: (err) => {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
          ? err.message
          : "Save failed",
      );
      setSavedAt(null);
    },
  });

  const onChange = (idx: number, value: string) => {
    setDraft((prev) => {
      const next = [...prev];
      next[idx] = value;
      return next;
    });
    setSavedAt(null);
  };

  const onRevert = () => {
    setDraft(dataset.classes);
    setError(null);
    setSavedAt(null);
  };

  if (dataset.classes.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Tag className="size-4 text-accent" />
              Class names
            </CardTitle>
            <CardDescription>
              Names are written into <code className="rounded bg-surface-muted px-1 py-0.5 text-xs">data.yaml</code>;
              the trained checkpoint embeds them so /predict can show them
              without you doing anything. Inputs map to class IDs in the
              same order they appear in your labels.
            </CardDescription>
          </div>
          {hasPlaceholders ? (
            <Badge tone="warning">placeholders</Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {hasPlaceholders ? (
          <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <PencilLine className="mt-0.5 size-4 shrink-0" />
            <span>
              Your dataset shipped without a data.yaml, so we filled in{" "}
              <code className="rounded bg-amber-100 px-1">class_0</code>…
              <code className="rounded bg-amber-100 px-1">class_N</code>{" "}
              placeholders. Rename them before training so the model
              outputs sensible labels.
            </span>
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {draft.map((name, idx) => {
            const isPlaceholder = PLACEHOLDER_PATTERN.test(
              dataset.classes[idx] ?? "",
            );
            return (
              <label
                key={idx}
                className="flex items-center gap-3 rounded-md border border-surface-muted bg-surface px-3 py-2"
              >
                <span className="w-8 shrink-0 text-xs font-mono tabular-nums text-ink-muted">
                  {idx}
                </span>
                <input
                  value={name}
                  onChange={(e) => onChange(idx, e.target.value)}
                  disabled={save.isPending}
                  className={cn(
                    "h-8 flex-1 rounded-md border bg-surface px-2 text-sm",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
                    isPlaceholder
                      ? "border-amber-300 bg-amber-50"
                      : "border-surface-muted",
                  )}
                  placeholder={`class ${idx}`}
                />
              </label>
            );
          })}
        </div>

        {error ? (
          <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            <AlertTriangle className="size-4" />
            {error}
          </div>
        ) : null}
        {!error && localValidation ? (
          <p className="text-xs text-amber-700">{localValidation}</p>
        ) : null}

        <div className="flex items-center gap-2 pt-1">
          <Button
            disabled={!dirty || save.isPending || localValidation !== null}
            onClick={() => save.mutate()}
          >
            {save.isPending ? (
              <>
                <Spinner /> Saving…
              </>
            ) : (
              <>
                <Check className="size-4" /> Apply changes
              </>
            )}
          </Button>
          <Button
            variant="ghost"
            disabled={!dirty || save.isPending}
            onClick={onRevert}
          >
            <RotateCcw className="size-4" /> Revert
          </Button>
          {savedAt !== null && !dirty ? (
            <span className="text-xs text-clinical">Saved.</span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
