import { BrowserWindow, dialog, ipcMain } from "electron";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import type { FileNode, RuntimeEvent } from "@core-types/index";

const activeRuns = new Map<string, ChildProcessWithoutNullStreams>();

function emitRuntimeEvent(window: BrowserWindow, event: RuntimeEvent) {
  window.webContents.send("envoy:runtime-event", event);
}

async function buildTree(rootPath: string, depth = 0): Promise<FileNode[]> {
  if (depth > 4) {
    return [];
  }

  const entries = await fs.readdir(rootPath, { withFileTypes: true });
  const sorted = entries
    .filter((entry) => !entry.name.startsWith("."))
    .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));

  const nodes: FileNode[] = [];
  for (const entry of sorted) {
    const fullPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      nodes.push({
        name: entry.name,
        path: fullPath,
        type: "directory",
        children: await buildTree(fullPath, depth + 1),
      });
    } else {
      nodes.push({
        name: entry.name,
        path: fullPath,
        type: "file",
      });
    }
  }

  return nodes;
}

function repoRootFromAppPath() {
  return path.resolve(process.cwd());
}

function pythonPathEnv() {
  const root = repoRootFromAppPath();
  const enginePath = path.join(root, "python");
  const existing = process.env.PYTHONPATH ?? "";
  return existing ? `${enginePath}${path.delimiter}${existing}` : enginePath;
}

function startStreamingProcess(
  window: BrowserWindow,
  runId: string,
  command: string,
  args: string[],
  cwd: string,
  workflow?: string,
) {
  const child = spawn(command, args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PYTHONPATH: pythonPathEnv(),
    },
  });

  activeRuns.set(runId, child);

  emitRuntimeEvent(window, {
    event: "run_started",
    run_id: runId,
    workflow: workflow as RuntimeEvent["workflow"],
    timestamp: new Date().toISOString(),
  });

  child.stdout.on("data", (chunk) => {
    const message = chunk.toString();
    for (const line of message.split("\n")) {
      if (!line.trim()) {
        continue;
      }
      try {
        const parsed = JSON.parse(line) as RuntimeEvent;
        emitRuntimeEvent(window, parsed);
      } catch {
        emitRuntimeEvent(window, {
          event: "log",
          run_id: runId,
          level: "info",
          message: line,
          timestamp: new Date().toISOString(),
        });
      }
    }
  });

  child.stderr.on("data", (chunk) => {
    emitRuntimeEvent(window, {
      event: "log",
      run_id: runId,
      level: "error",
      message: chunk.toString(),
      timestamp: new Date().toISOString(),
    });
  });

  child.on("error", (error) => {
    emitRuntimeEvent(window, {
      event: "process_error",
      run_id: runId,
      message: error.message,
      timestamp: new Date().toISOString(),
    });
  });

  child.on("close", (code) => {
    emitRuntimeEvent(window, {
      event: "process_exit",
      run_id: runId,
      code: code ?? 0,
      status: code === 0 ? "success" : "failed",
      timestamp: new Date().toISOString(),
    });
    activeRuns.delete(runId);
  });
}

export function registerRuntimeIpc(window: BrowserWindow) {
  ipcMain.handle("envoy:open-folder", async () => {
    const result = await dialog.showOpenDialog(window, {
      properties: ["openDirectory"],
      title: "Open Project Folder",
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return result.filePaths[0];
  });

  ipcMain.handle("envoy:list-tree", async (_event, rootPath: string) => {
    return buildTree(rootPath);
  });

  ipcMain.handle("envoy:read-file", async (_event, filePath: string) => {
    return fs.readFile(filePath, "utf-8");
  });

  ipcMain.handle("envoy:write-file", async (_event, filePath: string, content: string) => {
    await fs.writeFile(filePath, content, "utf-8");
    return true;
  });

  ipcMain.handle(
    "envoy:run-command",
    async (_event, projectRoot: string, command: string, args: string[]) => {
      const runId = randomUUID();
      startStreamingProcess(window, runId, command, args, projectRoot, "inspection");
      return runId;
    },
  );

  ipcMain.handle(
    "envoy:run-workflow",
    async (_event, projectRoot: string, workflow: string, config: Record<string, unknown>) => {
      const runId = randomUUID();
      const payload = JSON.stringify(config ?? {});
      startStreamingProcess(
        window,
        runId,
        process.env.PYTHON_BIN ?? "python3",
        [
          "-m",
          "axiom_engine.cli.main",
          "run",
          "--project-root",
          projectRoot,
          "--workflow",
          workflow,
          "--run-id",
          runId,
          "--config-json",
          payload,
        ],
        projectRoot,
        workflow,
      );
      return runId;
    },
  );

  ipcMain.handle("envoy:stop-run", async (_event, runId: string) => {
    const processRef = activeRuns.get(runId);
    if (!processRef) {
      return false;
    }
    processRef.kill("SIGTERM");
    activeRuns.delete(runId);
    return true;
  });
}
