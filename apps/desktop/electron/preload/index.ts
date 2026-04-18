import { contextBridge, ipcRenderer } from "electron";

type RuntimeEventPayload = {
  event: string;
  run_id: string;
  [key: string]: unknown;
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
  stopRun: (runId: string) => ipcRenderer.invoke("envoy:stop-run", runId),
  onRuntimeEvent: (callback: (payload: RuntimeEventPayload) => void) => {
    const handler = (_event: unknown, payload: RuntimeEventPayload) => callback(payload);
    ipcRenderer.on("envoy:runtime-event", handler);
    return () => ipcRenderer.removeListener("envoy:runtime-event", handler);
  },
};

contextBridge.exposeInMainWorld("envoy", api);
