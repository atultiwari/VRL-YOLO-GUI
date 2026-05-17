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

// --- Dataset + hardware (Train wizard) ---

export type DatasetFormat =
  | "roboflow_yolo"
  | "yolo"
  | "coco"
  | "voc"
  | "imagefolder"
  | "unknown";

export interface DatasetSplit {
  name: string;
  image_count: number;
  label_count: number;
}

export interface DatasetInfo {
  id: string;
  format: DatasetFormat;
  task: Task;
  root_path: string;
  splits: DatasetSplit[];
  classes: string[];
  class_counts: Record<string, number>;
  warnings: string[];
}

export interface HardwareInfo {
  kind: "cuda" | "mps" | "cpu";
  name: string;
  vram_gb: number | null;
  suggested_batch_size: number;
}

// --- Training ---

export type TrainingStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface TrainingMetrics {
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

export interface TrainingJobInfo {
  job_id: string;
  status: TrainingStatus;
  dataset_id: string;
  model: string;
  task: Task;
  epochs_total: number;
  epoch_current: number;
  started_at: string;
  finished_at: string | null;
  accelerator_kind: "cuda" | "mps" | "cpu";
  output_dir: string;
  metrics: TrainingMetrics;
  error_message: string | null;
}

export interface StartTrainingBody {
  dataset_id: string;
  model: string;
  epochs: number;
  imgsz: number;
  batch: number;
}

// Events shipped over /api/training/{id}/stream. Frontend reduces these
// into a TrainingJobInfo snapshot + scrolling log + Recharts series.
export type TrainingEvent =
  | { type: "hello"; job_id: string; status: TrainingStatus }
  | {
      type: "start";
      ts: number;
      dataset: string;
      model: string;
      task: Task;
      epochs: number;
      imgsz: number;
      batch: number;
      device: string | null;
    }
  | {
      type: "epoch";
      ts: number;
      epoch: number;
      epoch_total: number;
      metrics: TrainingMetrics;
    }
  | {
      type: "complete";
      ts: number;
      best_pt: string | null;
      metrics: Partial<TrainingMetrics>;
    }
  | { type: "error"; ts: number; message: string; traceback?: string }
  | { type: "cancelled"; ts: number; message?: string }
  | { type: "log"; ts: number; line: string }
  | { type: "closed"; status: TrainingStatus };
