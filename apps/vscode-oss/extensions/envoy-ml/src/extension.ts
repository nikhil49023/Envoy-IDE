import * as vscode from "vscode";
import { execFile } from "node:child_process";

type MlRunSummary = {
  run_id: string;
  workflow: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  summary: string | null;
  duration_seconds: number | null;
};

type MlDatasetSummary = {
  name: string;
  path: string;
  extension: string;
  size_mb: number;
  modified_at: string;
  checksum_sha256: string;
};

type MlMetadataState = {
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

function getWorkspaceRoot(): string | null {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
}

function createEnvoyTerminal(): vscode.Terminal {
  return vscode.window.createTerminal({
    name: "Envoy ML",
    cwd: getWorkspaceRoot() ?? undefined,
  });
}

function runPython(command: string, args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      {
        cwd,
        encoding: "utf-8",
        maxBuffer: 10 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message));
          return;
        }
        resolve({ stdout, stderr });
      },
    );
  });
}

async function runPythonWithFallback(script: string, cwd: string): Promise<string> {
  const attempts: Array<{ command: string; args: string[] }> = [
    { command: "python3", args: ["-c", script, cwd] },
    { command: "python", args: ["-c", script, cwd] },
    { command: "py", args: ["-3", "-c", script, cwd] },
  ];

  let lastError = "Python runtime is unavailable.";
  for (const attempt of attempts) {
    try {
      const result = await runPython(attempt.command, attempt.args, cwd);
      return result.stdout;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  throw new Error(lastError);
}

function emptyMetadataState(): MlMetadataState {
  return {
    generated_at: new Date().toISOString(),
    runs: [],
    datasets: [],
    artifacts: {
      models: 0,
      reports: 0,
      checkpoints: 0,
      embeddings: 0,
    },
    experiment_metrics: {
      total_runs: 0,
      running: 0,
      succeeded: 0,
      failed: 0,
      cancelled: 0,
    },
    reproducibility: {
      python_version: "unknown",
      platform: "unknown",
      dependency_lock_present: false,
      env_files: [],
    },
  };
}

async function queryMlMetadata(projectRoot: string): Promise<MlMetadataState> {
  const script = String.raw`
import hashlib
import json
import os
import platform
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

root = Path(sys.argv[1]).resolve()
axiom = root / ".axiom"
db_path = axiom / "metadata.db"
datasets_dir = axiom / "datasets"
artifacts_dir = axiom / "artifacts"

result = {
    "generated_at": datetime.now(timezone.utc).isoformat(),
    "runs": [],
    "datasets": [],
    "artifacts": {
        "models": 0,
        "reports": 0,
        "checkpoints": 0,
        "embeddings": 0,
    },
    "experiment_metrics": {
        "total_runs": 0,
        "running": 0,
        "succeeded": 0,
        "failed": 0,
        "cancelled": 0,
    },
    "reproducibility": {
        "python_version": sys.version.split()[0],
        "platform": platform.platform(),
        "dependency_lock_present": False,
        "env_files": [],
    },
}

if db_path.exists():
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        """
        SELECT run_id, workflow, status, started_at, completed_at, summary
        FROM runs
        ORDER BY started_at DESC
        LIMIT 100
        """
    ).fetchall()
    conn.close()

    for row in rows:
        started = row["started_at"]
        completed = row["completed_at"]
        duration = None
        if started and completed:
            try:
                start_dt = datetime.fromisoformat(started)
                end_dt = datetime.fromisoformat(completed)
                duration = max(0.0, (end_dt - start_dt).total_seconds())
            except Exception:
                duration = None

        result["runs"].append(
            {
                "run_id": row["run_id"],
                "workflow": row["workflow"],
                "status": row["status"],
                "started_at": started,
                "completed_at": completed,
                "summary": row["summary"],
                "duration_seconds": round(duration, 3) if isinstance(duration, float) else None,
            }
        )

for run in result["runs"]:
    status = str(run.get("status", "")).lower()
    if status == "running":
        result["experiment_metrics"]["running"] += 1
    elif status == "success":
        result["experiment_metrics"]["succeeded"] += 1
    elif status == "failed":
        result["experiment_metrics"]["failed"] += 1
    elif status == "cancelled":
        result["experiment_metrics"]["cancelled"] += 1

result["experiment_metrics"]["total_runs"] = len(result["runs"])

if datasets_dir.exists():
    files = []
    for current, _, names in os.walk(datasets_dir):
        for name in names:
            files.append(Path(current) / name)

    files = sorted(files, key=lambda p: p.stat().st_mtime, reverse=True)[:100]

    for file_path in files:
        stat = file_path.stat()
        digest = hashlib.sha256()
        with file_path.open("rb") as fp:
            digest.update(fp.read(256 * 1024))
        result["datasets"].append(
            {
                "name": file_path.name,
                "path": str(file_path),
                "extension": file_path.suffix.lower(),
                "size_mb": round(stat.st_size / (1024 * 1024), 4),
                "modified_at": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
                "checksum_sha256": digest.hexdigest(),
            }
        )

if artifacts_dir.exists():
    for current, _, names in os.walk(artifacts_dir):
        for name in names:
            lower = name.lower()
            if lower.endswith((".onnx", ".gguf", ".pt", ".pth", ".safetensors", ".ckpt")):
                result["artifacts"]["models"] += 1
            if lower.endswith((".md", ".json", ".yaml", ".yml", ".txt", ".csv")):
                result["artifacts"]["reports"] += 1
            if "checkpoint" in lower or lower.endswith((".ckpt", ".pt", ".pth")):
                result["artifacts"]["checkpoints"] += 1
            if "embedding" in lower or lower.endswith((".npy", ".npz")):
                result["artifacts"]["embeddings"] += 1

lock_names = [
    "requirements.txt",
    "poetry.lock",
    "Pipfile.lock",
    "uv.lock",
    "conda-lock.yml",
    "environment.yml",
    "environment.yaml",
]
result["reproducibility"]["dependency_lock_present"] = any((root / name).exists() for name in lock_names)

env_candidates = [
    ".env",
    ".env.local",
    "environment.yml",
    "environment.yaml",
    "requirements.txt",
    "pyproject.toml",
]
result["reproducibility"]["env_files"] = [name for name in env_candidates if (root / name).exists()]

print(json.dumps(result))
`;

  const stdout = await runPythonWithFallback(script, projectRoot);
  const parsed = JSON.parse(stdout.trim()) as MlMetadataState;
  return parsed;
}

function formatDate(value: string | null): string {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

function formatDuration(seconds: number | null): string {
  if (seconds === null || Number.isNaN(seconds)) {
    return "-";
  }
  if (seconds < 1) {
    return `${Math.round(seconds * 1000)}ms`;
  }
  if (seconds < 60) {
    return `${seconds.toFixed(2)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const rem = Math.round(seconds % 60);
  return `${minutes}m ${rem}s`;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function runStatusClass(status: string): string {
  const normalized = status.toLowerCase();
  if (normalized === "success") {
    return "ok";
  }
  if (normalized === "failed") {
    return "failed";
  }
  if (normalized === "running") {
    return "running";
  }
  if (normalized === "cancelled") {
    return "cancelled";
  }
  return "neutral";
}

function dashboardHtml(state: MlMetadataState, warning?: string): string {
  const runRows = state.runs
    .slice(0, 10)
    .map(
      (run) =>
        `<tr>
          <td title="${escapeHtml(run.run_id)}">${escapeHtml(run.run_id.slice(0, 10))}</td>
          <td>${escapeHtml(run.workflow)}</td>
          <td><span class="status ${runStatusClass(run.status)}">${escapeHtml(run.status)}</span></td>
          <td>${escapeHtml(formatDuration(run.duration_seconds))}</td>
          <td>${escapeHtml(formatDate(run.started_at))}</td>
        </tr>`,
    )
    .join("\n");

  const datasetRows = state.datasets
    .slice(0, 8)
    .map(
      (dataset) =>
        `<tr>
          <td title="${escapeHtml(dataset.path)}">${escapeHtml(dataset.name)}</td>
          <td>${escapeHtml(dataset.extension || "-")}</td>
          <td>${dataset.size_mb.toFixed(2)}</td>
          <td>${escapeHtml(formatDate(dataset.modified_at))}</td>
          <td title="${escapeHtml(dataset.checksum_sha256)}">${escapeHtml(dataset.checksum_sha256.slice(0, 12))}</td>
        </tr>`,
    )
    .join("\n");

  const envFiles = state.reproducibility.env_files.length > 0 ? state.reproducibility.env_files.join(", ") : "none";

  const warningBlock = warning
    ? `<div class="warn">${escapeHtml(warning)}</div>`
    : "";

  return [
    "<!doctype html>",
    "<html>",
    "<head>",
    "  <meta charset=\"utf-8\" />",
    "  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />",
    "  <style>",
    "    :root { color-scheme: dark; }",
    "    body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 0; background: #10151f; color: #ebf0ff; }",
    "    .wrap { padding: 18px; display: grid; gap: 12px; }",
    "    .header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }",
    "    h1 { margin: 0; font-size: 20px; }",
    "    .sub { margin: 4px 0 0 0; color: #b8c7e8; font-size: 12px; }",
    "    button { border: 1px solid #41628c; border-radius: 9px; background: #22436b; color: #ebf0ff; padding: 7px 11px; cursor: pointer; }",
    "    .warn { border: 1px solid #8b6c24; background: #473914; color: #ffe9ad; border-radius: 8px; padding: 8px; font-size: 12px; }",
    "    .grid { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 8px; }",
    "    .card { border: 1px solid #2b3e5f; border-radius: 10px; background: #182234; padding: 10px; }",
    "    .kpi { margin: 0; font-size: 11px; color: #b8c7e8; text-transform: uppercase; letter-spacing: 0.08em; }",
    "    .kpi-v { margin: 5px 0 0 0; font-size: 22px; font-weight: 700; }",
    "    h2 { margin: 0 0 8px 0; font-size: 14px; }",
    "    table { width: 100%; border-collapse: collapse; font-size: 12px; }",
    "    th, td { text-align: left; border-bottom: 1px solid #2b3e5f; padding: 6px 7px; white-space: nowrap; }",
    "    th { color: #b8c7e8; font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; }",
    "    .status { border-radius: 999px; border: 1px solid #425a7d; padding: 2px 6px; text-transform: uppercase; font-size: 10px; }",
    "    .status.ok { color: #b6f2cb; border-color: #43895a; background: #1d4228; }",
    "    .status.failed { color: #ffc4bf; border-color: #ac4f48; background: #4c231f; }",
    "    .status.running { color: #bfe9ff; border-color: #3e78a5; background: #1f3e5f; }",
    "    .status.cancelled, .status.neutral { color: #f4edbe; border-color: #8b8248; background: #4f4a24; }",
    "    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }",
    "    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: #cbd8f4; }",
    "    @media (max-width: 1220px) { .grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } .row { grid-template-columns: 1fr; } }",
    "    @media (max-width: 760px) { .grid { grid-template-columns: 1fr; } }",
    "  </style>",
    "</head>",
    "<body>",
    "  <div class=\"wrap\">",
    "    <div class=\"header\">",
    "      <div>",
    "        <h1>Envoy ML Workflow Dashboard</h1>",
    `        <p class=\"sub\">Snapshot: ${escapeHtml(formatDate(state.generated_at))}</p>`,
    "      </div>",
    "      <button id=\"refresh\">Refresh</button>",
    "    </div>",
    `    ${warningBlock}`,
    "    <div class=\"grid\">",
    "      <article class=\"card\"><p class=\"kpi\">Total Runs</p><p class=\"kpi-v\">" + state.experiment_metrics.total_runs + "</p></article>",
    "      <article class=\"card\"><p class=\"kpi\">Running</p><p class=\"kpi-v\">" + state.experiment_metrics.running + "</p></article>",
    "      <article class=\"card\"><p class=\"kpi\">Successful</p><p class=\"kpi-v\">" + state.experiment_metrics.succeeded + "</p></article>",
    "      <article class=\"card\"><p class=\"kpi\">Failed</p><p class=\"kpi-v\">" + state.experiment_metrics.failed + "</p></article>",
    "      <article class=\"card\"><p class=\"kpi\">Datasets</p><p class=\"kpi-v\">" + state.datasets.length + "</p></article>",
    "      <article class=\"card\"><p class=\"kpi\">Models</p><p class=\"kpi-v\">" + state.artifacts.models + "</p></article>",
    "    </div>",
    "    <div class=\"row\">",
    "      <section class=\"card\">",
    "        <h2>Experiment Tracker</h2>",
    `        <table><thead><tr><th>Run</th><th>Workflow</th><th>Status</th><th>Duration</th><th>Started</th></tr></thead><tbody>${runRows || "<tr><td colspan=\"5\">No runs yet.</td></tr>"}</tbody></table>`,
    "      </section>",
    "      <section class=\"card\">",
    "        <h2>Dataset Registry</h2>",
    `        <table><thead><tr><th>Name</th><th>Type</th><th>MB</th><th>Updated</th><th>Checksum</th></tr></thead><tbody>${datasetRows || "<tr><td colspan=\"5\">No datasets yet.</td></tr>"}</tbody></table>`,
    "      </section>",
    "    </div>",
    "    <section class=\"card\">",
    "      <h2>Reproducibility</h2>",
    `      <p class=\"mono\">python=${escapeHtml(state.reproducibility.python_version)} | lock=${state.reproducibility.dependency_lock_present ? "present" : "missing"}</p>`,
    `      <p class=\"mono\">platform=${escapeHtml(state.reproducibility.platform)}</p>`,
    `      <p class=\"mono\">env_files=${escapeHtml(envFiles)}</p>`,
    "    </section>",
    "  </div>",
    "  <script>",
    "    const vscode = acquireVsCodeApi();",
    "    document.getElementById('refresh').addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));",
    "  </script>",
    "</body>",
    "</html>",
  ].join("\n");
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("envoy.openWorkflowDashboard", async () => {
      const root = getWorkspaceRoot();
      if (!root) {
        vscode.window.showWarningMessage("Open a folder/workspace before using Envoy workflow dashboard.");
        return;
      }

      const panel = vscode.window.createWebviewPanel(
        "envoyWorkflowDashboard",
        "Envoy Workflow Dashboard",
        vscode.ViewColumn.Two,
        { enableScripts: true, retainContextWhenHidden: true },
      );

      const render = async () => {
        let warning: string | undefined;
        let state = emptyMetadataState();
        try {
          state = await queryMlMetadata(root);
        } catch (error) {
          warning = error instanceof Error ? error.message : String(error);
        }
        panel.webview.html = dashboardHtml(state, warning);
      };

      panel.webview.onDidReceiveMessage((message: unknown) => {
        if (typeof message === "object" && message !== null && "type" in message) {
          const type = (message as { type?: string }).type;
          if (type === "refresh") {
            void render();
          }
        }
      });

      void render();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("envoy.runPytest", () => {
      if (!getWorkspaceRoot()) {
        vscode.window.showWarningMessage("Open a folder/workspace before running tests.");
        return;
      }
      const terminal = createEnvoyTerminal();
      terminal.show(true);
      terminal.sendText("python3 -m pytest -q", true);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("envoy.runInspectionWorkflow", () => {
      if (!getWorkspaceRoot()) {
        vscode.window.showWarningMessage("Open a folder/workspace before running inspection workflow.");
        return;
      }
      const terminal = createEnvoyTerminal();
      terminal.show(true);
      terminal.sendText("python3 -m axiom_engine.cli run --workflow inspection", true);
    }),
  );
}

export function deactivate(): void {
  // No-op: all resources are subscription-bound.
}
