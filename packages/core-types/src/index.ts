/**
 * Cytos IDE shared domain types.
 *
 * Used by the cytos-ml VS Code extension and any future Cytos tooling
 * that needs shared Cytos domain type definitions.
 */

// ---------------------------------------------------------------------------
// Workflow
// ---------------------------------------------------------------------------

export type WorkflowType =
  | "dataset_creation"
  | "evaluation"
  | "export"
  | "simulation"
  | "inspection";

// ---------------------------------------------------------------------------
// Runtime events (emitted by cytos_engine, consumed by extension/dashboard)
// ---------------------------------------------------------------------------

export type RuntimeEventKind =
  | "run_started"
  | "step_started"
  | "log"
  | "metric"
  | "artifact"
  | "run_completed"
  | "process_exit"
  | "process_error";

export type RuntimeEvent = {
  event: RuntimeEventKind;
  run_id: string;
  workflow?: WorkflowType;
  step?: string;
  level?: "info" | "warning" | "error";
  message?: string;
  name?: string;
  value?: number | string;
  type?: string;
  path?: string;
  status?: "success" | "failed" | "cancelled";
  code?: number;
  timestamp: string;
};

// ---------------------------------------------------------------------------
// ML run metadata (fetched from .cytos/metadata.db via Python subprocess)
// ---------------------------------------------------------------------------

export type RunStatus = "running" | "success" | "failed" | "cancelled";

export type MlRunRecord = {
  run_id: string;
  workflow: string;
  status: RunStatus;
  started_at: string;
  completed_at: string | null;
  summary: string | null;
  duration_seconds: number | null;
};

export type MlDatasetRecord = {
  name: string;
  path: string;
  extension: string;
  size_mb: number;
  modified_at: string;
  checksum_sha256: string;
};

export type MlArtifactCounts = {
  models: number;
  reports: number;
  checkpoints: number;
  embeddings: number;
};

export type MlExperimentMetrics = {
  total_runs: number;
  running: number;
  succeeded: number;
  failed: number;
  cancelled: number;
};

export type MlReproducibility = {
  python_version: string;
  platform: string;
  dependency_lock_present: boolean;
  env_files: string[];
};

export type MlMetadataSnapshot = {
  generated_at: string;
  runs: MlRunRecord[];
  datasets: MlDatasetRecord[];
  artifacts: MlArtifactCounts;
  experiment_metrics: MlExperimentMetrics;
  reproducibility: MlReproducibility;
};
