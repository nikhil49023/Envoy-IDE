import type { FileNode } from "@core-types/index";

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
