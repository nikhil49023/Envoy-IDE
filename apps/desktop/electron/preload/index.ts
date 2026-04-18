import { contextBridge, ipcRenderer } from "electron";

type RuntimeEventPayload = {
  event: string;
  run_id: string;
  [key: string]: unknown;
};

type TerminalEventPayload = {
  terminalId: string;
  type: "data" | "exit" | "error";
  data?: string;
  code?: number;
};

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

const api = {
  openFolder: (): Promise<string | null> => ipcRenderer.invoke("envoy:open-folder"),
  listTree: (rootPath: string): Promise<unknown> => ipcRenderer.invoke("envoy:list-tree", rootPath),
  readFile: (filePath: string): Promise<string> => ipcRenderer.invoke("envoy:read-file", filePath),
  writeFile: (filePath: string, content: string): Promise<boolean> =>
    ipcRenderer.invoke("envoy:write-file", filePath, content),
  runCommand: (projectRoot: string, command: string, args: string[]) =>
    ipcRenderer.invoke("envoy:run-command", projectRoot, command, args),
  runWorkflow: (projectRoot: string, workflow: string, config: Record<string, unknown>) =>
    ipcRenderer.invoke("envoy:run-workflow", projectRoot, workflow, config),
  executePython: (projectRoot: string, code: string): Promise<PythonExecutionResult> =>
    ipcRenderer.invoke("envoy:execute-python", projectRoot, code),
  stopRun: (runId: string) => ipcRenderer.invoke("envoy:stop-run", runId),
  createTerminal: (projectRoot: string) => ipcRenderer.invoke("envoy:terminal-create", projectRoot),
  writeTerminal: (terminalId: string, data: string) =>
    ipcRenderer.invoke("envoy:terminal-write", terminalId, data),
  resizeTerminal: (terminalId: string, cols: number, rows: number) =>
    ipcRenderer.invoke("envoy:terminal-resize", terminalId, cols, rows),
  killTerminal: (terminalId: string) => ipcRenderer.invoke("envoy:terminal-kill", terminalId),
  onRuntimeEvent: (callback: (payload: RuntimeEventPayload) => void) => {
    const handler = (_event: unknown, payload: RuntimeEventPayload) => callback(payload);
    ipcRenderer.on("envoy:runtime-event", handler);
    return () => ipcRenderer.removeListener("envoy:runtime-event", handler);
  },
  onTerminalEvent: (callback: (payload: TerminalEventPayload) => void) => {
    const handler = (_event: unknown, payload: TerminalEventPayload) => callback(payload);
    ipcRenderer.on("envoy:terminal-event", handler);
    return () => ipcRenderer.removeListener("envoy:terminal-event", handler);
  },
};

contextBridge.exposeInMainWorld("envoy", api);
