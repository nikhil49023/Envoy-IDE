import type { WorkflowType } from "@core-types/index";

export type WorkflowRequest = {
  workflow: WorkflowType;
  projectRoot: string;
  config: Record<string, unknown>;
};
