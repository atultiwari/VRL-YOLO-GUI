import type {
  DetectionResponse,
  ModelInfo,
  ModelsListResponse,
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

export async function fetchHealth(): Promise<{
  status: string;
  version: string;
  python: string;
  platform: string;
}> {
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
}: InferSingleArgs): Promise<DetectionResponse> {
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
