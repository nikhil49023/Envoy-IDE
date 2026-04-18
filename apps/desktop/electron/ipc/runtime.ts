import { BrowserWindow, dialog, ipcMain } from "electron";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  spawn,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";

import type { FileNode, RuntimeEvent } from "@core-types/index";

const activeRuns = new Map<string, ChildProcessWithoutNullStreams>();

type PtyLikeProcess = {
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  kill: () => void;
  onData: (cb: (data: string) => void) => void;
  onExit: (cb: (event: { exitCode: number }) => void) => void;
};

type TerminalSession = {
  mode: "pty" | "fallback";
  pty?: PtyLikeProcess;
  child?: ChildProcessWithoutNullStreams;
};

const terminalSessions = new Map<string, TerminalSession>();

type PythonVariableSummary = {
  name: string;
  type: string;
  preview: string;
  shape?: string;
  dtype?: string;
};

type DataFramePreview = {
  name: string;
  columns: string[];
  rows: Array<Record<string, unknown>>;
  row_count: number;
};

type PythonExecutionResult = {
  stdout: string;
  stderr: string;
  error: string | null;
  variables: PythonVariableSummary[];
  dataframes: DataFramePreview[];
  plots: string[];
  html_outputs: string[];
};

const require = createRequire(import.meta.url);

function getNodePty(): null | {
  spawn: (
    file: string,
    args: string[],
    options: { cwd: string; cols: number; rows: number; env: Record<string, string> },
  ) => PtyLikeProcess;
} {
  try {
    return require("node-pty");
  } catch {
    return null;
  }
}

function emitRuntimeEvent(window: BrowserWindow, event: RuntimeEvent) {
  window.webContents.send("envoy:runtime-event", event);
}

function emitTerminalEvent(
  window: BrowserWindow,
  payload: { terminalId: string; type: "data" | "exit" | "error"; data?: string; code?: number },
) {
  window.webContents.send("envoy:terminal-event", payload);
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

function runPythonSnippet(projectRoot: string, code: string): Promise<PythonExecutionResult> {
  return new Promise((resolve) => {
    const encoded = Buffer.from(code, "utf-8").toString("base64");
    const wrapper = String.raw`
import base64
import contextlib
import io
import json
import traceback
import types

result = {
    "stdout": "",
    "stderr": "",
    "error": None,
    "variables": [],
    "dataframes": [],
    "plots": [],
    "html_outputs": [],
}

code = base64.b64decode("${encoded}").decode("utf-8")
scope = {}
std_out = io.StringIO()
std_err = io.StringIO()

try:
    with contextlib.redirect_stdout(std_out), contextlib.redirect_stderr(std_err):
        exec(code, scope, scope)
except Exception:
    result["error"] = traceback.format_exc()

result["stdout"] = std_out.getvalue()
result["stderr"] = std_err.getvalue()

try:
    import pandas as pd
except Exception:
    pd = None

for name, value in list(scope.items()):
    if name.startswith("_"):
        continue
    if isinstance(value, (types.ModuleType, types.FunctionType, type)):
        continue

    summary = {
        "name": name,
        "type": type(value).__name__,
        "preview": repr(value)[:180],
    }

    if hasattr(value, "shape"):
        try:
            summary["shape"] = str(getattr(value, "shape"))
        except Exception:
            pass
    if hasattr(value, "dtype"):
        try:
            summary["dtype"] = str(getattr(value, "dtype"))
        except Exception:
            pass

    result["variables"].append(summary)

    if pd is not None:
        try:
            if isinstance(value, pd.DataFrame):
                head = value.head(30)
                rows = head.to_dict(orient="records")
                result["dataframes"].append(
                    {
                        "name": name,
                        "columns": [str(col) for col in head.columns.tolist()],
                        "rows": rows,
                        "row_count": int(len(value)),
                    }
                )
        except Exception:
            pass

    if hasattr(value, "_repr_html_"):
        try:
            html = value._repr_html_()
            if isinstance(html, str) and html.strip():
                result["html_outputs"].append(html)
        except Exception:
            pass

try:
    import matplotlib.pyplot as plt
    import base64 as _base64
    import io as _io

    for fig_id in plt.get_fignums():
        fig = plt.figure(fig_id)
        buffer = _io.BytesIO()
        fig.savefig(buffer, format="png", bbox_inches="tight")
        buffer.seek(0)
        result["plots"].append(_base64.b64encode(buffer.read()).decode("ascii"))
        buffer.close()
    plt.close("all")
except Exception:
    pass

print(json.dumps(result))
`;

    const child = spawn(process.env.PYTHON_BIN ?? "python3", ["-c", wrapper], {
      cwd: projectRoot,
      env: {
        ...process.env,
        PYTHONPATH: pythonPathEnv(),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let out = "";
    let err = "";
    let settled = false;

    const settle = (payload: PythonExecutionResult) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(payload);
    };

    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      settle({
        stdout: out,
        stderr: err,
        error: "Execution timed out after 30 seconds.",
        variables: [],
        dataframes: [],
        plots: [],
        html_outputs: [],
      });
    }, 30_000);

    child.stdout.on("data", (chunk) => {
      out += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      err += chunk.toString();
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      settle({
        stdout: out,
        stderr: err,
        error: error.message,
        variables: [],
        dataframes: [],
        plots: [],
        html_outputs: [],
      });
    });

    child.on("close", () => {
      clearTimeout(timeout);
      const trimmed = out.trim();
      try {
        const parsed = JSON.parse(trimmed) as PythonExecutionResult;
        settle(parsed);
      } catch {
        settle({
          stdout: out,
          stderr: err,
          error: err || "Failed to parse execution output.",
          variables: [],
          dataframes: [],
          plots: [],
          html_outputs: [],
        });
      }
    });
  });
}

function createTerminalSession(window: BrowserWindow, terminalId: string, cwd: string): TerminalSession {
  const shell = process.env.SHELL || (process.platform === "win32" ? "powershell.exe" : "bash");
  const nodePty = getNodePty();

  if (nodePty) {
    const ptyProc = nodePty.spawn(shell, [], {
      cwd,
      cols: 120,
      rows: 32,
      env: {
        ...process.env,
      } as Record<string, string>,
    });

    ptyProc.onData((data) => {
      emitTerminalEvent(window, {
        terminalId,
        type: "data",
        data,
      });
    });

    ptyProc.onExit((event) => {
      emitTerminalEvent(window, {
        terminalId,
        type: "exit",
        code: event.exitCode,
      });
      terminalSessions.delete(terminalId);
    });

    return {
      mode: "pty",
      pty: ptyProc,
    };
  }

  const child = spawn(shell, [], {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
    },
  });

  child.stdout.on("data", (chunk) => {
    emitTerminalEvent(window, {
      terminalId,
      type: "data",
      data: chunk.toString(),
    });
  });

  child.stderr.on("data", (chunk) => {
    emitTerminalEvent(window, {
      terminalId,
      type: "data",
      data: chunk.toString(),
    });
  });

  child.on("error", (error) => {
    emitTerminalEvent(window, {
      terminalId,
      type: "error",
      data: error.message,
    });
  });

  child.on("close", (code) => {
    emitTerminalEvent(window, {
      terminalId,
      type: "exit",
      code: code ?? 0,
    });
    terminalSessions.delete(terminalId);
  });

  return {
    mode: "fallback",
    child,
  };
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

  ipcMain.handle(
    "envoy:execute-python",
    async (_event, projectRoot: string, code: string) => {
      return runPythonSnippet(projectRoot, code);
    },
  );

  ipcMain.handle("envoy:terminal-create", async (_event, projectRoot: string) => {
    const terminalId = randomUUID();
    const session = createTerminalSession(window, terminalId, projectRoot);
    terminalSessions.set(terminalId, session);
    return terminalId;
  });

  ipcMain.handle("envoy:terminal-write", async (_event, terminalId: string, data: string) => {
    const session = terminalSessions.get(terminalId);
    if (!session) {
      return false;
    }

    if (session.mode === "pty" && session.pty) {
      session.pty.write(data);
      return true;
    }

    if (session.child && session.child.stdin.writable) {
      session.child.stdin.write(data);
      return true;
    }

    return false;
  });

  ipcMain.handle(
    "envoy:terminal-resize",
    async (_event, terminalId: string, cols: number, rows: number) => {
      const session = terminalSessions.get(terminalId);
      if (!session) {
        return false;
      }

      if (session.mode === "pty" && session.pty) {
        session.pty.resize(cols, rows);
      }

      return true;
    },
  );

  ipcMain.handle("envoy:terminal-kill", async (_event, terminalId: string) => {
    const session = terminalSessions.get(terminalId);
    if (!session) {
      return false;
    }

    if (session.mode === "pty" && session.pty) {
      session.pty.kill();
    } else if (session.child) {
      session.child.kill("SIGTERM");
    }

    terminalSessions.delete(terminalId);
    return true;
  });
}
