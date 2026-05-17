import type {
  DatasetInfo,
  HardwareInfo,
  HealthResponse,
  InferenceResponse,
  ModelInfo,
  ModelsListResponse,
  PresetsListResponse,
  ReportRequestBody,
  Task,
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
