import type { FileNode } from "@core-types/index";
import type { MlMetadataState } from "./workbench/mlState";

type PythonExecutionResult = {
  stdout: string;
  stderr: string;
  error: string | null;
  variables: Array<{ name: string; type: string; preview: string; shape?: string; dtype?: string }>;
  dataframes: Array<{
    name: string;
    columns: string[];
    rows: Array<Record<string, unknown>>;
    row_count: number;
  }>;
  plots: string[];
  html_outputs: string[];
};

declare global {
  interface Window {
    envoy: {
      openFolder: () => Promise<string | null>;
      listTree: (rootPath: string) => Promise<FileNode[]>;
      readFile: (filePath: string) => Promise<string>;
      writeFile: (filePath: string, content: string) => Promise<boolean>;
      runCommand: (projectRoot: string, command: string, args: string[]) => Promise<string>;
      runWorkflow: (
        projectRoot: string,
        workflow: string,
        config: Record<string, unknown>,
      ) => Promise<string>;
      executePython: (projectRoot: string, code: string) => Promise<PythonExecutionResult>;
      queryMlState: (projectRoot: string) => Promise<MlMetadataState>;
      stopRun: (runId: string) => Promise<boolean>;
      createTerminal: (projectRoot: string) => Promise<string>;
      writeTerminal: (terminalId: string, data: string) => Promise<boolean>;
      resizeTerminal: (terminalId: string, cols: number, rows: number) => Promise<boolean>;
      killTerminal: (terminalId: string) => Promise<boolean>;
      onRuntimeEvent: (callback: (payload: Record<string, unknown>) => void) => () => void;
      onTerminalEvent: (
        callback: (payload: { terminalId: string; type: string; data?: string; code?: number }) => void,
      ) => () => void;
    };
  }
}

export {};
