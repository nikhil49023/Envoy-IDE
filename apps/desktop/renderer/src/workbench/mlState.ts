export type MlRunSummary = {
  run_id: string;
  workflow: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  summary: string | null;
  duration_seconds: number | null;
};

export type MlDatasetSummary = {
  name: string;
  path: string;
  extension: string;
  size_mb: number;
  modified_at: string;
  checksum_sha256: string;
};

export type MlMetadataState = {
  generated_at: string;
  runs: MlRunSummary[];
  datasets: MlDatasetSummary[];
  artifacts: {
    models: number;
    reports: number;
    checkpoints: number;
    embeddings: number;
  };
  experiment_metrics: {
    total_runs: number;
    running: number;
    succeeded: number;
    failed: number;
    cancelled: number;
  };
  reproducibility: {
    python_version: string;
    platform: string;
    dependency_lock_present: boolean;
    env_files: string[];
  };
};
