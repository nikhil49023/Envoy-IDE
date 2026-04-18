export type WorkflowType =
  | "dataset_creation"
  | "evaluation"
  | "export"
  | "simulation"
  | "inspection";

export type RuntimeEvent = {
  event:
    | "run_started"
    | "step_started"
    | "log"
    | "metric"
    | "artifact"
    | "run_completed"
    | "process_exit"
    | "process_error";
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

export type FileNode = {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: FileNode[];
};

export type OpenTab = {
  path: string;
  content: string;
  dirty: boolean;
};
