"use client";

import { useMutation } from "@tanstack/react-query";
import {
  AlertTriangle,
  Cloud,
  Copy,
  ExternalLink,
  Link2,
  X,
} from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { ApiError, connectColab } from "@/lib/api";

export interface ConnectColabModalProps {
  task: "detect" | "classify";
  onClose: () => void;
  onConnected: (jobId: string) => void;
  /** F2: run metadata to send with the connect call. */
  runName?: string;
  runDescription?: string;
}

// Github-anchored Colab URLs (signed off in docs/PLAN-P6.md §4.4) — they
// always point to current main so any fix lands the next time the
// clinician opens the notebook.
const NOTEBOOK_URLS: Record<"detect" | "classify", string> = {
  detect:
    "https://colab.research.google.com/github/atultiwari/VRL-YOLO-GUI/blob/main/notebooks/01_train_detect_colab.ipynb",
  classify:
    "https://colab.research.google.com/github/atultiwari/VRL-YOLO-GUI/blob/main/notebooks/02_train_classify_colab.ipynb",
};

export function ConnectColabModal({
  task,
  onClose,
  onConnected,
  runName,
  runDescription,
}: ConnectColabModalProps) {
  const [tunnelUrl, setTunnelUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const notebookUrl = NOTEBOOK_URLS[task];

  const connect = useMutation({
    mutationFn: async () =>
      connectColab(tunnelUrl.trim(), {
        name: runName,
        description: runDescription,
      }),
    onSuccess: (res) => onConnected(res.job_id),
  });

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(notebookUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API rejects under some Pyloid permission shapes — fall
      // back silently; the link is still visible and clickable.
    }
  };

  const errorMessage =
    connect.error instanceof ApiError
      ? connect.error.message
      : connect.error instanceof Error
        ? connect.error.message
        : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <Card className="w-full max-w-xl">
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Cloud className="size-4 text-accent" />
                Connect to a Colab session
              </CardTitle>
              <CardDescription>
                Train on a free Google Colab GPU; the desktop streams live
                metrics through a Cloudflare tunnel. Setup takes about a
                minute.
              </CardDescription>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              disabled={connect.isPending}
              aria-label="Close"
            >
              <X className="size-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <section className="space-y-2">
            <p className="text-sm font-medium text-ink">
              1. Open the {task === "detect" ? "detection" : "classification"}{" "}
              training notebook in Colab
            </p>
            <p className="text-xs text-ink-muted">
              Use <span className="font-medium">Runtime → Run all</span> so the
              last cell (
              <code className="rounded bg-surface-muted px-1 py-0.5">
                Run training
              </code>
              ) actually starts — the tunnel URL prints before it. Then copy
              the URL the cell shows (
              <code className="rounded bg-surface-muted px-1 py-0.5">
                https://&hellip;.trycloudflare.com?token=&hellip;
              </code>
              ) and paste it below. If you connect before that cell runs, this
              screen will say “waiting for Colab”.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded-md border border-surface-muted bg-surface-subtle px-2.5 py-1.5 text-xs text-ink">
                {notebookUrl}
              </code>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCopy}
                title="Copy link"
              >
                <Copy className="size-3.5" />
                {copied ? "Copied" : "Copy"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  window.open(notebookUrl, "_blank", "noopener,noreferrer")
                }
              >
                <ExternalLink className="size-3.5" />
                Open
              </Button>
            </div>
          </section>

          <section className="space-y-2">
            <label
              htmlFor="tunnel-url"
              className="text-sm font-medium text-ink"
            >
              2. Paste the tunnel URL the cell printed
            </label>
            <div className="relative">
              <Link2 className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
              <input
                id="tunnel-url"
                type="url"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                placeholder="https://abc-def.trycloudflare.com?token=…"
                value={tunnelUrl}
                onChange={(e) => setTunnelUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    tunnelUrl.trim() &&
                    !connect.isPending
                  ) {
                    connect.mutate();
                  }
                }}
                disabled={connect.isPending}
                className="w-full rounded-md border border-surface-muted bg-surface py-2 pl-8 pr-3 text-sm text-ink placeholder:text-ink-muted focus:border-accent focus:outline-none"
              />
            </div>
            <p className="text-xs text-ink-muted">
              The URL is unique to your Colab cell and stops working when the
              cell stops. The token in the URL keeps the session private — do
              not share it.
            </p>
          </section>

          {errorMessage ? (
            <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          ) : null}

          <div className="flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              onClick={onClose}
              disabled={connect.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={() => connect.mutate()}
              disabled={!tunnelUrl.trim() || connect.isPending}
            >
              {connect.isPending ? (
                <>
                  <Spinner /> Connecting…
                </>
              ) : (
                <>
                  <Cloud className="size-4" /> Connect
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
