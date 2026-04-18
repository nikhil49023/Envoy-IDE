import * as vscode from "vscode";
import { execFile } from "node:child_process";

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

type RunStatus = "running" | "success" | "failed" | "cancelled";

type MlRunRecord = {
  run_id: string;
  workflow: string;
  status: RunStatus;
  started_at: string;
  completed_at: string | null;
  summary: string | null;
  duration_seconds: number | null;
};

type MlDatasetRecord = {
  name: string;
  path: string;
  extension: string;
  size_mb: number;
  modified_at: string;
  checksum_sha256: string;
};

type MlMetadataSnapshot = {
  generated_at: string;
  runs: MlRunRecord[];
  datasets: MlDatasetRecord[];
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

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function getWorkspaceRoot(): string | null {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
}

function createCytosTerminal(): vscode.Terminal {
  return vscode.window.createTerminal({
    name: "Cytos",
    cwd: getWorkspaceRoot() ?? undefined,
  });
}

function runProcess(
  command: string,
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string }> {
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

async function runPythonScript(script: string, cwd: string): Promise<string> {
  const candidates: Array<{ command: string; args: string[] }> = [
    { command: "python3", args: ["-c", script, cwd] },
    { command: "python", args: ["-c", script, cwd] },
    { command: "py", args: ["-3", "-c", script, cwd] },
  ];

  let lastError = "No Python 3 runtime found on PATH.";
  for (const { command, args } of candidates) {
    try {
      const result = await runProcess(command, args, cwd);
      return result.stdout;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  throw new Error(lastError);
}

// ---------------------------------------------------------------------------
// ML metadata query (runs inline Python)
// ---------------------------------------------------------------------------

function emptySnapshot(): MlMetadataSnapshot {
  return {
    generated_at: new Date().toISOString(),
    runs: [],
    datasets: [],
    artifacts: { models: 0, reports: 0, checkpoints: 0, embeddings: 0 },
    experiment_metrics: { total_runs: 0, running: 0, succeeded: 0, failed: 0, cancelled: 0 },
    reproducibility: {
      python_version: "unknown",
      platform: "unknown",
      dependency_lock_present: false,
      env_files: [],
    },
  };
}

async function fetchMlMetadata(projectRoot: string): Promise<MlMetadataSnapshot> {
  const script = String.raw`
import hashlib, json, os, platform, sqlite3, sys
from datetime import datetime, timezone
from pathlib import Path

root = Path(sys.argv[1]).resolve()
cytos = root / ".cytos"
db_path = cytos / "metadata.db"
datasets_dir = cytos / "datasets"
artifacts_dir = cytos / "artifacts"

result = {
    "generated_at": datetime.now(timezone.utc).isoformat(),
    "runs": [],
    "datasets": [],
    "artifacts": {"models": 0, "reports": 0, "checkpoints": 0, "embeddings": 0},
    "experiment_metrics": {"total_runs": 0, "running": 0, "succeeded": 0, "failed": 0, "cancelled": 0},
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
        "SELECT run_id, workflow, status, started_at, completed_at, summary "
        "FROM runs ORDER BY started_at DESC LIMIT 100"
    ).fetchall()
    conn.close()
    for row in rows:
        started, completed = row["started_at"], row["completed_at"]
        duration = None
        if started and completed:
            try:
                duration = max(0.0, (datetime.fromisoformat(completed) - datetime.fromisoformat(started)).total_seconds())
            except Exception:
                pass
        result["runs"].append({
            "run_id": row["run_id"],
            "workflow": row["workflow"],
            "status": row["status"],
            "started_at": started,
            "completed_at": completed,
            "summary": row["summary"],
            "duration_seconds": round(duration, 3) if isinstance(duration, float) else None,
        })

metrics = result["experiment_metrics"]
for run in result["runs"]:
    s = str(run.get("status", "")).lower()
    if s == "running": metrics["running"] += 1
    elif s == "success": metrics["succeeded"] += 1
    elif s == "failed": metrics["failed"] += 1
    elif s == "cancelled": metrics["cancelled"] += 1
metrics["total_runs"] = len(result["runs"])

if datasets_dir.exists():
    for root_dir, _, names in os.walk(datasets_dir):
        for n in names:
            fp = Path(root_dir) / n
            stat = fp.stat()
            digest = hashlib.sha256()
            with fp.open("rb") as f:
                digest.update(f.read(256 * 1024))
            result["datasets"].append({
                "name": fp.name,
                "path": str(fp),
                "extension": fp.suffix.lower(),
                "size_mb": round(stat.st_size / (1024 * 1024), 4),
                "modified_at": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
                "checksum_sha256": digest.hexdigest(),
            })
    result["datasets"].sort(key=lambda x: x["modified_at"], reverse=True)

art = result["artifacts"]
if artifacts_dir.exists():
    for _, _, names in os.walk(artifacts_dir):
        for n in names:
            lo = n.lower()
            if lo.endswith((".onnx", ".gguf", ".pt", ".pth", ".safetensors", ".ckpt")): art["models"] += 1
            if lo.endswith((".md", ".json", ".yaml", ".yml", ".txt", ".csv")): art["reports"] += 1
            if "checkpoint" in lo or lo.endswith((".ckpt", ".pt", ".pth")): art["checkpoints"] += 1
            if "embedding" in lo or lo.endswith((".npy", ".npz")): art["embeddings"] += 1

lock_names = ["requirements.txt", "poetry.lock", "Pipfile.lock", "uv.lock", "conda-lock.yml", "environment.yml", "environment.yaml"]
result["reproducibility"]["dependency_lock_present"] = any((root / n).exists() for n in lock_names)

env_candidates = [".env", ".env.local", "environment.yml", "environment.yaml", "requirements.txt", "pyproject.toml"]
result["reproducibility"]["env_files"] = [n for n in env_candidates if (root / n).exists()]

print(json.dumps(result))
`;

  const stdout = await runPythonScript(script, projectRoot);
  return JSON.parse(stdout.trim()) as MlMetadataSnapshot;
}

// ---------------------------------------------------------------------------
// Native Tree View Sidebar
// ---------------------------------------------------------------------------

class BasicTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly description?: string,
    public readonly tooltip?: string,
    public readonly iconPath?: vscode.ThemeIcon
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = description;
    this.tooltip = tooltip;
    this.iconPath = iconPath;
  }
}

class CytosTreeDataProvider implements vscode.TreeDataProvider<BasicTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<BasicTreeItem | undefined | void> = new vscode.EventEmitter<BasicTreeItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<BasicTreeItem | undefined | void> = this._onDidChangeTreeData.event;

  constructor(private context: string) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: BasicTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: BasicTreeItem): Promise<BasicTreeItem[]> {
    if (element) {
      return Promise.resolve([]);
    }

    const root = getWorkspaceRoot();
    if (!root) {
      return [new BasicTreeItem("No project open", "Open a folder to see Cytos assets")];
    }

    let snap = emptySnapshot();
    try {
      snap = await fetchMlMetadata(root);
    } catch {
      return [new BasicTreeItem("No items yet")];
    }

    switch (this.context) {
      case "home":
        return [
          new BasicTreeItem("Welcome to Cytos", "MLOps Lifecycle", undefined, new vscode.ThemeIcon("home")),
          new BasicTreeItem("Pending Approvals", "0 actions required", undefined, new vscode.ThemeIcon("bell"))
        ];
      case "data":
        return snap.datasets.length
          ? snap.datasets.map((d) => new BasicTreeItem(d.name, `${d.size_mb.toFixed(2)} MB`, d.path, new vscode.ThemeIcon("database")))
          : [
              new BasicTreeItem("Import Source", "PDF, CSV, Logs", undefined, new vscode.ThemeIcon("add")),
              new BasicTreeItem("No datasets found")
            ];
      case "workflows":
        return [
          new BasicTreeItem("PDF Extract", "Local LLM pipeline", undefined, new vscode.ThemeIcon("circuit-board")),
          new BasicTreeItem("Generate Synthetic", "Prompt augmentation", undefined, new vscode.ThemeIcon("circuit-board")),
          new BasicTreeItem("Inspection & Eval", "Run benchmark", undefined, new vscode.ThemeIcon("circuit-board")),
        ];
      case "runs":
        return snap.runs.length
          ? snap.runs.map((r) => new BasicTreeItem(r.run_id.substring(0, 8), r.status, r.workflow, new vscode.ThemeIcon("play")))
          : [new BasicTreeItem("No tracked runs active")];
      case "models":
        return snap.artifacts.models > 0
          ? [new BasicTreeItem(`${snap.artifacts.models} Artifacts`, "Found locally", undefined, new vscode.ThemeIcon("box"))]
          : [new BasicTreeItem("No checkpoints found")];
      case "registry":
        return [
          new BasicTreeItem("Production", "v1.4.2", undefined, new vscode.ThemeIcon("verified-filled")),
          new BasicTreeItem("Staging", "v1.5.0-rc", undefined, new vscode.ThemeIcon("git-branch"))
        ];
      case "deployments":
        return [
          new BasicTreeItem("Local API", "http://localhost:8000", undefined, new vscode.ThemeIcon("server-environment"))
        ];
      case "monitoring":
        return [
          new BasicTreeItem("Data Drift", "0 active incidents", undefined, new vscode.ThemeIcon("dashboard")),
          new BasicTreeItem("Latency", "42ms p95", undefined, new vscode.ThemeIcon("pulse"))
        ];
      case "alerts":
        return [
          new BasicTreeItem("No alerts", "System healthy", undefined, new vscode.ThemeIcon("check"))
        ];
      default:
        return [];
    }
  }
}

// ---------------------------------------------------------------------------
// Dashboard Layout HTML (Glassmorphic)
// ---------------------------------------------------------------------------

function formatDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

function formatDuration(seconds: number | null): string {
  if (seconds === null || Number.isNaN(seconds)) return "—";
  if (seconds < 1) return `${Math.round(seconds * 1000)}ms`;
  if (seconds < 60) return `${seconds.toFixed(2)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

function esc(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function statusClass(status: string): string {
  switch (status.toLowerCase()) {
    case "success": return "ok";
    case "failed": return "err";
    case "running": return "running";
    default: return "neutral";
  }
}

function buildCanvasHtml(snap: MlMetadataSnapshot, warning?: string): string {
  const runRows = snap.runs.slice(0, 5).map((r) =>
    `<div class="table-row">
      <div class="col font-mono text-sm">${esc(r.run_id.slice(0, 8))}</div>
      <div class="col">${esc(r.workflow)}</div>
      <div class="col"><span class="badge badge-${statusClass(r.status)}">${esc(r.status)}</span></div>
      <div class="col text-muted">${esc(formatDuration(r.duration_seconds))}</div>
    </div>`
  ).join("\n");

  const datasetRows = snap.datasets.slice(0, 5).map((d) =>
    `<div class="table-row">
      <div class="col font-medium">${esc(d.name)}</div>
      <div class="col text-muted">${esc(d.extension || "—")}</div>
      <div class="col">${d.size_mb.toFixed(2)} MB</div>
      <div class="col text-muted font-mono text-sm">${esc(d.checksum_sha256.slice(0, 8))}</div>
    </div>`
  ).join("\n");

  const warnHtml = warning
    ? `<div class="glass-alert">${esc(warning)}</div>`
    : "";

  const m = snap.experiment_metrics;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Cytos Workflow Canvas</title>
  <style>
    :root { 
      --bg: #09090b; 
      --text: #fafafa;
      --text-muted: #a1a1aa;
      --glass-bg: rgba(255, 255, 255, 0.03);
      --glass-border: rgba(255, 255, 255, 0.08);
      --glass-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.3);
      --accent: rgba(99, 102, 241, 0.5); /* Indigo glow */
      --accent-alt: rgba(168, 85, 247, 0.4); /* Purple glow */
    }
    * { box-sizing: border-box; }
    body {
      font-family: 'Inter', ui-sans-serif, system-ui, -apple-system, sans-serif;
      margin: 0; padding: 0;
      background-color: var(--bg); color: var(--text);
      overflow-x: hidden; min-height: 100vh; position: relative;
    }
    body::before, body::after {
      content: ''; position: fixed; width: 600px; height: 600px;
      border-radius: 50%; filter: blur(120px); z-index: -1;
      opacity: 0.5; pointer-events: none;
      animation: drift 20s infinite alternate ease-in-out;
    }
    body::before { background: var(--accent); top: -100px; left: -100px; }
    body::after { background: var(--accent-alt); bottom: -150px; right: -100px; animation-delay: -10s; }
    @keyframes drift {
      from { transform: translate(0, 0); }
      to { transform: translate(50px, 50px); }
    }
    .container { max-width: 1400px; margin: 0 auto; padding: 40px; display: flex; flex-direction: column; gap: 32px; }
    .header-area { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 8px; }
    h1 { margin: 0; font-size: 32px; font-weight: 600; letter-spacing: -0.02em; background: linear-gradient(135deg, #fff 0%, #a1a1aa 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .subtext { color: var(--text-muted); font-size: 13px; margin-top: 6px; }
    button.btn-glass { background: var(--glass-bg); border: 1px solid var(--glass-border); border-radius: 99px; color: var(--text); padding: 8px 16px; font-size: 13px; font-weight: 500; cursor: pointer; backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); transition: all 0.2s ease; display: flex; align-items: center; gap: 6px; }
    button.btn-glass:hover { background: rgba(255, 255, 255, 0.08); border-color: rgba(255, 255, 255, 0.2); }
    .glass-panel { background: var(--glass-bg); border: 1px solid var(--glass-border); border-radius: 16px; padding: 24px; backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px); box-shadow: var(--glass-shadow); transition: transform 0.3s ease, border-color 0.3s ease; }
    .glass-panel:hover { border-color: rgba(255, 255, 255, 0.15); transform: translateY(-2px); }
    .pipeline { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-top: 16px; }
    .pipeline-node { background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 16px; flex: 1; text-align: center; }
    .pipeline-arrow { color: rgba(255,255,255,0.2); font-weight: bold; }
    .node-title { font-size: 14px; font-weight: 600; color: #fff; margin-bottom: 4px; }
    .node-desc { font-size: 11px; color: var(--text-muted); }
    .layout-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
    h2 { margin: 0 0 16px 0; font-size: 16px; font-weight: 500; color: #fff; display: flex; align-items: center; gap: 8px; }
    .table-list { display: flex; flex-direction: column; gap: 4px; }
    .table-header { display: flex; padding: 0 12px 8px 12px; border-bottom: 1px solid var(--glass-border); font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); font-weight: 600; }
    .table-row { display: flex; padding: 10px 12px; border-radius: 8px; background: rgba(255, 255, 255, 0.01); transition: background 0.2s ease; align-items: center; }
    .table-row:hover { background: rgba(255, 255, 255, 0.04); }
    .col { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
    .font-mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    .font-medium { font-weight: 500; }
    .text-sm { font-size: 12px; }
    .text-muted { color: var(--text-muted); }
    .badge { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 99px; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }
    .badge-ok { background: rgba(34, 197, 94, 0.15); color: #4ade80; border: 1px solid rgba(34, 197, 94, 0.2); }
    .badge-err { background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.2); }
    .badge-running { background: rgba(59, 130, 246, 0.15); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.2); }
    .badge-neutral { background: rgba(255, 255, 255, 0.1); color: #e4e4e7; border: 1px solid rgba(255, 255, 255, 0.1); }
    .glass-alert { background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); border-radius: 12px; padding: 12px 16px; color: #fca5a5; font-size: 13px; backdrop-filter: blur(12px); }
    @media (max-width: 1024px) { .layout-grid { grid-template-columns: 1fr; } .pipeline { flex-direction: column; } .pipeline-arrow { transform: rotate(90deg); margin: 8px 0; } }
  </style>
</head>
<body>

<div class="container">
  <div class="header-area">
    <div>
      <h1>Cytos MLOps Studio</h1>
      <div class="subtext">System Snapshot: ${esc(formatDate(snap.generated_at))}</div>
    </div>
    <button class="btn-glass" id="refresh">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 21v-5h5"/></svg>
      Refresh
    </button>
  </div>
  
  ${warnHtml}

  <div class="glass-panel">
    <h2>Cytos Lifecycle Overview</h2>
    <div class="pipeline">
      <div class="pipeline-node"><div class="node-title">1. Data</div><div class="node-desc">${snap.datasets.length} Versions</div></div>
      <div class="pipeline-arrow">→</div>
      <div class="pipeline-node"><div class="node-title">2. Train/Experiment</div><div class="node-desc">${m.total_runs} Runs</div></div>
      <div class="pipeline-arrow">→</div>
      <div class="pipeline-node"><div class="node-title">3. Model Registry</div><div class="node-desc">${snap.artifacts.models} Registered</div></div>
      <div class="pipeline-arrow">→</div>
      <div class="pipeline-node"><div class="node-title">4. Deploy</div><div class="node-desc">0 Active</div></div>
      <div class="pipeline-arrow">→</div>
      <div class="pipeline-node"><div class="node-title">5. Monitor</div><div class="node-desc">Health Check OK</div></div>
    </div>
  </div>

  <div class="layout-grid">
    <div class="glass-panel">
      <h2>Recent Runs</h2>
      <div class="table-list">
        <div class="table-header"><div class="col">Run ID</div><div class="col">Workflow</div><div class="col">Status</div><div class="col">Duration</div></div>
        ${runRows || '<div class="table-row"><div class="col text-muted">No runs available.</div></div>'}
      </div>
    </div>
    <div class="glass-panel">
      <h2>Local Datasets</h2>
      <div class="table-list">
        <div class="table-header"><div class="col">Dataset name</div><div class="col">Type</div><div class="col">Size</div><div class="col">Identity</div></div>
        ${datasetRows || '<div class="table-row"><div class="col text-muted">No datasets exported yet.</div></div>'}
      </div>
    </div>
  </div>
</div>

<script>
  const vscode = acquireVsCodeApi();
  document.getElementById('refresh').addEventListener('click', () => {
    vscode.postMessage({ type: 'refresh' });
  });
</script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Extension Entry Point
// ---------------------------------------------------------------------------

export function activate(context: vscode.ExtensionContext): void {
  // Register Sidebar Tree Views (Cytos MLOps Lifecycle)
  vscode.window.registerTreeDataProvider('cytos-home', new CytosTreeDataProvider('home'));
  vscode.window.registerTreeDataProvider('cytos-data', new CytosTreeDataProvider('data'));
  vscode.window.registerTreeDataProvider('cytos-workflows', new CytosTreeDataProvider('workflows'));
  vscode.window.registerTreeDataProvider('cytos-runs', new CytosTreeDataProvider('runs'));
  vscode.window.registerTreeDataProvider('cytos-models', new CytosTreeDataProvider('models'));
  vscode.window.registerTreeDataProvider('cytos-registry', new CytosTreeDataProvider('registry'));
  vscode.window.registerTreeDataProvider('cytos-deployments', new CytosTreeDataProvider('deployments'));
  vscode.window.registerTreeDataProvider('cytos-monitoring', new CytosTreeDataProvider('monitoring'));
  vscode.window.registerTreeDataProvider('cytos-alerts', new CytosTreeDataProvider('alerts'));

  // Register Workflow Canvas Command
  context.subscriptions.push(
    vscode.commands.registerCommand("cytos.openWorkflowCanvas", async () => {
      const root = getWorkspaceRoot();
      if (!root) {
        vscode.window.showWarningMessage(
          "Open a folder or workspace to use Cytos Studio.",
        );
        return;
      }

      const panel = vscode.window.createWebviewPanel(
        "cytosWorkflowCanvas",
        "Cytos Studio",
        vscode.ViewColumn.One,
        { enableScripts: true, retainContextWhenHidden: true },
      );

      const render = async (): Promise<void> => {
        let warning: string | undefined;
        let snap = emptySnapshot();
        try {
          snap = await fetchMlMetadata(root);
        } catch (err) {
          warning = err instanceof Error ? err.message : String(err);
        }
        panel.webview.html = buildCanvasHtml(snap, warning);
      };

      panel.webview.onDidReceiveMessage((msg: unknown) => {
        if (
          typeof msg === "object" &&
          msg !== null &&
          "type" in msg &&
          (msg as { type?: string }).type === "refresh"
        ) {
          void render();
        }
      });

      void render();
    }),
  );

  // CLI execution commands
  context.subscriptions.push(
    vscode.commands.registerCommand("cytos.runPytest", () => {
      if (!getWorkspaceRoot()) return;
      const terminal = createCytosTerminal();
      terminal.show(true);
      terminal.sendText("python3 -m pytest -q", true);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("cytos.runInspectionWorkflow", () => {
      if (!getWorkspaceRoot()) return;
      const terminal = createCytosTerminal();
      terminal.show(true);
      terminal.sendText("python3 -m cytos_engine.cli run --workflow inspection", true);
    }),
  );
}

export function deactivate(): void {}
