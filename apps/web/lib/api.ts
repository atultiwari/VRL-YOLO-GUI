import type {
  DatasetInfo,
  HardwareInfo,
  HealthResponse,
  InferenceResponse,
  ModelInfo,
  ModelsListResponse,
  PresetsListResponse,
  ReportRequestBody,
  StartTrainingBody,
  Task,
  TrainingJobInfo,
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
export function uploadDataset(
  files: File[],
  onProgress?: (p: DatasetUploadProgress) => void,
  signal?: AbortSignal,
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

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE}/datasets/inspect`);
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
