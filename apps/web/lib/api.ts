import type {
  DatasetInfo,
  DatasetsListResponse,
  ExplainMode,
  ExplainResponse,
  HardwareInfo,
  HealthResponse,
  InferenceResponse,
  ModelInfo,
  ModelsListResponse,
  PresetsListResponse,
  PurgeHistoryResponse,
  ReportRequestBody,
  RerunHistoryResponse,
  StartTrainingBody,
  Task,
  TrainingEvent,
  TrainingHistoryDetailResponse,
  TrainingHistoryListResponse,
  TrainingJobInfo,
  TrainingStatus,
} from "./types";

const API_BASE =
  typeof window !== "undefined" && window.location.origin
    ? `${window.location.origin}/api`
    : "/api";

async function fetchJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  if (!response.ok) {
    let detail = "";
    try {
      const body = await response.json();
      detail = body?.detail ?? body?.message ?? "";
    } catch {
      detail = await response.text().catch(() => "");
    }
    throw new ApiError(response.status, detail || response.statusText);
  }
  if (response.status === 204) return undefined as unknown as T;
  return (await response.json()) as T;
}

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

export async function fetchHealth(): Promise<HealthResponse> {
  return fetchJson(`${API_BASE}/health`);
}

export async function fetchModels(): Promise<ModelsListResponse> {
  return fetchJson(`${API_BASE}/models`);
}

export async function fetchModel(name: string): Promise<ModelInfo> {
  return fetchJson(`${API_BASE}/models/${encodeURIComponent(name)}`);
}

export async function setDefaultModel(task: Task, name: string): Promise<void> {
  await fetchJson(`${API_BASE}/models/default`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ task, name }),
  });
}

export async function fetchPresets(): Promise<PresetsListResponse> {
  return fetchJson(`${API_BASE}/presets`);
}

export interface InferSingleArgs {
  image: File;
  model: string;
  conf: number;
  iou: number;
}

export async function inferSingle({
  image,
  model,
  conf,
  iou,
}: InferSingleArgs): Promise<InferenceResponse> {
  const form = new FormData();
  form.append("image", image);
  form.append("model", model);
  form.append("conf", String(conf));
  form.append("iou", String(iou));
  return fetchJson(`${API_BASE}/inference/single`, {
    method: "POST",
    body: form,
  });
}

// --- Explainability (F6a) ----------------------------------------------

export interface ExplainArgs {
  image: File;
  model: string;
  /** "image" = whole-image heatmap; "box" = detection-only, needs boxIndex. */
  mode: ExplainMode;
  boxIndex?: number;
  conf?: number;
  iou?: number;
}

/**
 * Request an Eigen-CAM heatmap for one image. Stateless — re-uploads the
 * image (matches `inferSingle`). Opacity is a pure client concern (the
 * returned PNG is alpha-masked; the modal scales it with CSS), so it is
 * not sent here.
 */
export async function explainInference({
  image,
  model,
  mode,
  boxIndex,
  conf = 0.25,
  iou = 0.45,
}: ExplainArgs): Promise<ExplainResponse> {
  const form = new FormData();
  form.append("image", image);
  form.append("model", model);
  form.append("mode", mode);
  if (boxIndex !== undefined) form.append("box_index", String(boxIndex));
  form.append("conf", String(conf));
  form.append("iou", String(iou));
  return fetchJson(`${API_BASE}/inference/explain`, {
    method: "POST",
    body: form,
  });
}

// --- Reports -----------------------------------------------------------

export type ReportFormat = "csv" | "xlsx" | "pdf";

/**
 * Fetch a report blob and trigger a browser download. Returns the
 * suggested filename so the caller can display a toast / success
 * message. Throws ApiError if the backend rejects the request (empty
 * items, malformed payload, etc.).
 */
export async function downloadReport(
  format: ReportFormat,
  body: ReportRequestBody,
): Promise<string> {
  const response = await fetch(`${API_BASE}/reports/${format}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    let detail = "";
    try {
      const failure = await response.json();
      detail = failure?.detail ?? response.statusText;
    } catch {
      detail = response.statusText;
    }
    throw new ApiError(response.status, detail);
  }

  const disposition = response.headers.get("Content-Disposition") ?? "";
  const match = disposition.match(/filename="?([^"]+)"?/i);
  const filename = match?.[1] ?? `report.${format}`;

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on next tick so Safari has time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return filename;
}

// --- Model import ------------------------------------------------------

export interface ImportedModelResponse {
  name: string;
  task: Task;
  source: "user";
  num_classes: number;
}

/**
 * Upload a .pt checkpoint. Backend reads its task + class names via
 * Ultralytics, places it under `<storage_root>/models/<task>/`, and
 * refreshes the registry so the new card shows up in /models on next
 * fetchModels().
 */
export async function importModel(file: File): Promise<ImportedModelResponse> {
  const form = new FormData();
  form.append("file", file);
  return fetchJson(`${API_BASE}/models/import`, {
    method: "POST",
    body: form,
  });
}

/**
 * Rename a user-imported or trained checkpoint in place. Bundled
 * weights are rejected on the backend.
 */
export async function renameModel(
  name: string,
  newName: string,
): Promise<ModelInfo> {
  return fetchJson(`${API_BASE}/models/${encodeURIComponent(name)}/rename`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ new_name: newName }),
  });
}

/**
 * Build the URL the browser hits to download a model's `.pt` file.
 * Returned as a string so the caller can stuff it into an `<a download>`
 * — QtWebEngine's downloadRequested handler (P3b.fix-1) auto-accepts it
 * into `~/Downloads/`.
 */
export function modelDownloadUrl(name: string): string {
  return `${API_BASE}/models/${encodeURIComponent(name)}/download`;
}

/**
 * Hard-delete a user-imported or trained checkpoint. Bundled weights
 * are rejected by the backend with 403.
 */
export async function deleteModel(name: string): Promise<void> {
  await fetchJson(`${API_BASE}/models/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
}

/**
 * Open the OS file manager scoped to this model's `.pt`. Lives on the
 * backend because the QtWebEngine renderer is sandboxed — it can't
 * spawn `open` / `explorer` / `xdg-open` directly.
 */
export async function revealModel(name: string): Promise<void> {
  await fetchJson(`${API_BASE}/models/${encodeURIComponent(name)}/reveal`, {
    method: "POST",
  });
}

// --- Train wizard ------------------------------------------------------

export async function fetchHardware(
  args: { task?: Task; imgsz?: number } = {},
): Promise<HardwareInfo> {
  const params = new URLSearchParams();
  if (args.task) params.set("task", args.task);
  if (args.imgsz) params.set("imgsz", String(args.imgsz));
  const qs = params.toString();
  return fetchJson(`${API_BASE}/hardware${qs ? `?${qs}` : ""}`);
}

export async function fetchDataset(datasetId: string): Promise<DatasetInfo> {
  return fetchJson(`${API_BASE}/datasets/${encodeURIComponent(datasetId)}`);
}

export interface SplitDatasetArgs {
  trainRatio: number;
  validRatio: number;
  testRatio: number;
  seed: number;
  /**
   * When true, images that already live in a `train/`, `val|valid|
   * validation/`, or `test/` subtree stay in that split — ratios only
   * redistribute the flat / unassigned pool. Default false (reshuffle
   * everything).
   */
  preserveExisting?: boolean;
}

/**
 * Reorganise an uploaded dataset into clean train/valid/test splits.
 *
 * The backend handles three input shapes identically (plain YOLO at
 * root, Roboflow with only `train/`, Roboflow with all splits) — it
 * flattens to image+label pairs, shuffles by `seed`, partitions, then
 * writes a Roboflow-shaped layout with an updated data.yaml.
 *
 * Destructive within the dataset's own directory but the UUID stays
 * the same so the Train wizard store doesn't lose track.
 */
export async function splitDataset(
  datasetId: string,
  args: SplitDatasetArgs,
): Promise<DatasetInfo> {
  return fetchJson(`${API_BASE}/datasets/${encodeURIComponent(datasetId)}/split`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      train_ratio: args.trainRatio,
      valid_ratio: args.validRatio,
      test_ratio: args.testRatio,
      seed: args.seed,
      preserve_existing: args.preserveExisting ?? false,
    }),
  });
}

export interface DatasetUploadProgress {
  loaded: number;
  total: number;
  pct: number;
}

/**
 * Upload a folder of files to /api/datasets/inspect with progress
 * callbacks. Uses XMLHttpRequest (not fetch) because the Fetch API still
 * doesn't expose upload-progress events — and a doctor dropping a 500-MB
 * dataset deserves a real percent bar.
 */
export interface UploadDatasetOptions {
  /** F4: optional name + description carried into the meta row. */
  name?: string;
  description?: string;
}

export function uploadDataset(
  files: File[],
  onProgress?: (p: DatasetUploadProgress) => void,
  signal?: AbortSignal,
  options?: UploadDatasetOptions,
): Promise<DatasetInfo> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    for (const f of files) {
      // webkitRelativePath like "my-dataset/train/images/img.jpg" — pass as
      // the filename so the backend can reconstruct the directory tree.
      const path =
        (f as File & { webkitRelativePath?: string }).webkitRelativePath ||
        f.name;
      form.append("files", f, path);
    }

    // F4: name/description ride on the query string (FormData carries the
    // files; query params don't conflict with the multipart body).
    const params = new URLSearchParams();
    if (options?.name) params.set("name", options.name);
    if (options?.description) params.set("description", options.description);
    const qs = params.toString();

    const xhr = new XMLHttpRequest();
    xhr.open(
      "POST",
      `${API_BASE}/datasets/inspect${qs ? `?${qs}` : ""}`,
    );
    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          onProgress({
            loaded: e.loaded,
            total: e.total,
            pct: (e.loaded / e.total) * 100,
          });
        }
      };
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch (err) {
          reject(new ApiError(xhr.status, `bad JSON: ${err}`));
        }
      } else {
        let detail = xhr.statusText;
        try {
          detail = JSON.parse(xhr.responseText).detail ?? detail;
        } catch {
          /* keep statusText */
        }
        reject(new ApiError(xhr.status, detail));
      }
    };
    xhr.onerror = () => reject(new ApiError(0, "network error"));
    xhr.onabort = () => reject(new ApiError(0, "upload cancelled"));
    if (signal) {
      signal.addEventListener("abort", () => xhr.abort());
    }
    xhr.send(form);
  });
}

/**
 * Rename the dataset's class list. Order must match the original — the
 * backend only rewrites the `names:` field in data.yaml; on-disk label
 * files (which reference class indices, not names) stay untouched.
 *
 * Validation lives on both sides: the backend rejects empty / non-unique /
 * length-mismatched payloads with 400.
 */
export async function renameDatasetClasses(
  datasetId: string,
  names: string[],
): Promise<DatasetInfo> {
  return fetchJson(
    `${API_BASE}/datasets/${encodeURIComponent(datasetId)}/classes`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ names }),
    },
  );
}

// --- Training (P4b) ----------------------------------------------------

export interface StartTrainingResponse {
  job_id: string;
}

export async function startTraining(
  body: StartTrainingBody,
): Promise<StartTrainingResponse> {
  return fetchJson(`${API_BASE}/training/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function getTrainingJob(jobId: string): Promise<TrainingJobInfo> {
  return fetchJson(`${API_BASE}/training/${encodeURIComponent(jobId)}`);
}

export async function cancelTraining(jobId: string): Promise<void> {
  await fetchJson(
    `${API_BASE}/training/${encodeURIComponent(jobId)}/cancel`,
    { method: "POST" },
  );
}

/**
 * Copy the run's best.pt into `<storage_root>/models/detect/` and return
 * the freshly-registered ModelInfo. Caller can navigate straight to
 * /predict with the trained model preselected.
 */
export async function saveTrainingToLibrary(
  jobId: string,
): Promise<ModelInfo> {
  return fetchJson(
    `${API_BASE}/training/${encodeURIComponent(jobId)}/save-to-library`,
    { method: "POST" },
  );
}

// --- Train on Colab (P6b) ----------------------------------------------

/**
 * Validate a Colab tunnel URL with the backend (which does a 3 s
 * pre-flight GET /status against the tunnel) and register a
 * Colab-backed TrainingJob. On success the desktop streams the remote
 * runner's events through the same /api/training/{id}/stream
 * WebSocket a local run uses, so /train/run works unchanged.
 *
 * Throws ApiError with clinician-readable detail on every pre-flight
 * failure (stale URL, wrong token, unreachable host, payload shape
 * mismatch). The backend's error text already reads as plain English —
 * surface it as-is.
 */
export async function connectColab(
  tunnelUrl: string,
  opts: { name?: string; description?: string } = {},
): Promise<StartTrainingResponse> {
  return fetchJson(`${API_BASE}/training/colab/connect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tunnel_url: tunnelUrl,
      name: opts.name ?? "",
      description: opts.description ?? "",
    }),
  });
}

/**
 * Edit a queued / running run's name + description. Backend rejects
 * with 409 on completed/failed/cancelled runs (history edits land
 * in F3). Pass `null` for a field to leave it as-is; pass empty
 * string for `name` to reset to the auto-default; pass empty string
 * for `description` to clear it.
 */
export async function updateTrainingMetadata(
  jobId: string,
  patch: { name?: string | null; description?: string | null },
): Promise<TrainingJobInfo> {
  return fetchJson(
    `${API_BASE}/training/${encodeURIComponent(jobId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    },
  );
}

/**
 * Build the WebSocket URL for a job's event stream. The handler replays
 * every event so far, then streams new ones until the job hits a terminal
 * state (completed / failed / cancelled), so a refresh always lands the
 * client on a coherent snapshot.
 */
export function trainingStreamUrl(jobId: string): string {
  const origin =
    typeof window !== "undefined" && window.location.origin
      ? window.location.origin
      : "";
  const wsBase = origin.replace(/^http/, "ws");
  return `${wsBase}/api/training/${encodeURIComponent(jobId)}/stream`;
}

// --- F3: training history ---------------------------------------------------

export interface ListHistoryArgs {
  task?: Task;
  status?: TrainingStatus;
  dataset_id?: string;
  limit?: number;
  offset?: number;
  sort_by?: "started_at" | "name" | "duration";
  sort_dir?: "asc" | "desc";
}

export async function listTrainingHistory(
  args: ListHistoryArgs = {},
): Promise<TrainingHistoryListResponse> {
  const params = new URLSearchParams();
  if (args.task) params.set("task", args.task);
  if (args.status) params.set("status", args.status);
  if (args.dataset_id) params.set("dataset_id", args.dataset_id);
  if (args.limit !== undefined) params.set("limit", String(args.limit));
  if (args.offset !== undefined) params.set("offset", String(args.offset));
  if (args.sort_by) params.set("sort_by", args.sort_by);
  if (args.sort_dir) params.set("sort_dir", args.sort_dir);
  const qs = params.toString();
  return fetchJson(
    `${API_BASE}/training/history${qs ? `?${qs}` : ""}`,
  );
}

export async function getTrainingHistoryRow(
  jobId: string,
): Promise<TrainingHistoryDetailResponse> {
  return fetchJson(
    `${API_BASE}/training/history/${encodeURIComponent(jobId)}`,
  );
}

/**
 * Stream the run's NDJSON event log into an array. The endpoint is
 * `application/x-ndjson`; we parse line-by-line so a partial response
 * still yields the events that arrived.
 */
export async function fetchTrainingHistoryEvents(
  jobId: string,
): Promise<TrainingEvent[]> {
  const resp = await fetch(
    `${API_BASE}/training/history/${encodeURIComponent(jobId)}/events`,
  );
  if (!resp.ok) {
    throw new ApiError(resp.status, await resp.text());
  }
  const text = await resp.text();
  const events: TrainingEvent[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed) as TrainingEvent);
    } catch {
      // Skip malformed lines — keeps the chart render best-effort.
    }
  }
  return events;
}

export async function deleteTrainingHistoryRow(
  jobId: string,
  opts: { deleteCheckpoint?: boolean } = {},
): Promise<void> {
  const params = new URLSearchParams();
  if (opts.deleteCheckpoint) params.set("delete_checkpoint", "true");
  const qs = params.toString();
  await fetchJson(
    `${API_BASE}/training/history/${encodeURIComponent(jobId)}${qs ? `?${qs}` : ""}`,
    { method: "DELETE" },
  );
}

export async function rerunTrainingHistoryRow(
  jobId: string,
): Promise<RerunHistoryResponse> {
  return fetchJson(
    `${API_BASE}/training/history/${encodeURIComponent(jobId)}/rerun`,
    { method: "POST" },
  );
}

export async function purgeTrainingHistory(
  olderThanDays: number,
): Promise<PurgeHistoryResponse> {
  return fetchJson(
    `${API_BASE}/training/history/purge?older_than_days=${olderThanDays}`,
    { method: "POST" },
  );
}

// --- F4: dataset library + naming -------------------------------------------

export async function listDatasets(): Promise<DatasetsListResponse> {
  return fetchJson(`${API_BASE}/datasets`);
}

/**
 * Delete a dataset folder. 409 if any queued/running training job
 * has the dataset open — backend includes the run name(s) in the
 * detail string.
 */
export async function deleteDataset(datasetId: string): Promise<void> {
  await fetchJson(`${API_BASE}/datasets/${encodeURIComponent(datasetId)}`, {
    method: "DELETE",
  });
}

/**
 * Edit a dataset's display name + description. F4 parallel to F2's
 * training-run PATCH. Pass `null` for a field to leave it as-is;
 * empty string for `name` resets to `"Dataset <id[:8]>"`; empty
 * string for `description` clears it.
 */
export async function updateDatasetMetadata(
  datasetId: string,
  patch: { name?: string | null; description?: string | null },
): Promise<void> {
  await fetchJson(`${API_BASE}/datasets/${encodeURIComponent(datasetId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}
