export type Task = "detect" | "classify";

export type ModelSource = "bundled" | "user" | "trained";

export interface ModelInfo {
  name: string;
  task: Task;
  source: ModelSource;
  num_classes: number;
  classes: Record<string, string>;
  params: number;
  size_mb: number;
}

export interface ModelsListResponse {
  models: ModelInfo[];
  defaults: Partial<Record<Task, string>>;
}

export interface Accelerator {
  kind: "cuda" | "mps" | "cpu";
  name: string;
}

export interface DetectionBox {
  class_id: number;
  class_name: string;
  conf: number;
  xyxy: [number, number, number, number];
  xywhn: [number, number, number, number];
}

export interface DetectionResponse {
  task: "detect";
  model: string;
  image_size: [number, number];
  accelerator: Accelerator;
  inference_ms: number;
  boxes: DetectionBox[];
  counts_per_class: Record<string, number>;
}

export interface ClassificationPrediction {
  class_id: number;
  class_name: string;
  conf: number;
}

export interface ClassificationResponse {
  task: "classify";
  model: string;
  image_size: [number, number];
  accelerator: Accelerator;
  inference_ms: number;
  top1: ClassificationPrediction;
  top5: ClassificationPrediction[];
}

// Discriminated union — narrow via `if (result.task === "detect")`.
export type InferenceResponse = DetectionResponse | ClassificationResponse;

export interface HealthResponse {
  status: string;
  version: string;
  python: string;
  platform: string;
}

// --- Presets ---

export type Domain = "histopathology" | "hematology";

export interface PresetInfo {
  id: string;
  domain: Domain;
  task: Task;
  label: string;
  description: string;
  default_model: string;
  conf: number;
  iou: number | null;
  class_filter: string[] | null;
}

export interface PresetsListResponse {
  presets: PresetInfo[];
}

// --- Reports ---

export interface ReportBoxIn {
  class_name: string;
  conf: number;
}

export interface ReportPredictionIn {
  class_name: string;
  conf: number;
}

export interface ReportItemIn {
  filename: string;
  inference_ms: number;
  // detect-only
  boxes?: ReportBoxIn[];
  counts_per_class?: Record<string, number>;
  // classify-only
  top1?: ReportPredictionIn | null;
  top5?: ReportPredictionIn[];
  // PDF-only thumbnail (base64 without `data:` prefix).
  image_b64?: string;
}

export interface ReportRequestBody {
  task: Task;
  model: string;
  items: ReportItemIn[];
  review_threshold: number;
  detect_per_class?: Record<string, number> | null;
  classify_per_class?: Record<string, number> | null;
  classify_flagged_count?: number | null;
}
