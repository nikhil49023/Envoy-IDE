import { execFile } from "node:child_process";
import * as path from "node:path";
import * as vscode from "vscode";

type RunStatus = "running" | "success" | "failed" | "cancelled";
type CanvasRoute =
  | "home"
  | "data"
  | "workflows"
  | "runs"
  | "models"
  | "registry"
  | "deployments"
  | "monitoring"
  | "alerts";

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

const ROUTES: CanvasRoute[] = [
  "home",
  "data",
  "workflows",
  "runs",
  "models",
  "registry",
  "deployments",
  "monitoring",
  "alerts",
];

const ROUTE_LABELS: Record<CanvasRoute, string> = {
  home: "Home",
  data: "Data",
  workflows: "Workflows",
  runs: "Runs",
  models: "Models",
  registry: "Registry",
  deployments: "Deployments",
  monitoring: "Monitoring",
  alerts: "Alerts",
};

const ROUTE_SUBTITLES: Record<CanvasRoute, string> = {
  home: "Approvals, health, lineage, and active work",
  data: "Ingest, prepare, version, review, and publish datasets",
  workflows: "Reusable MLOps pipelines with gates and artifacts",
  runs: "Experiments, training jobs, evaluations, prompts, and logs",
  models: "Model behavior, tokenizer probes, checkpoints, and output variance",
  registry: "Versioned candidates, promotion stages, lineage, and approvals",
  deployments: "Endpoints, batch jobs, releases, canaries, and rollback",
  monitoring: "Drift, skew, latency, failures, quality, and slices",
  alerts: "Incidents, response workflows, relabeling, retraining, and rollback",
};

function getWorkspaceRoot(): string | null {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
}

function isCanvasRoute(value: unknown): value is CanvasRoute {
  return typeof value === "string" && ROUTES.includes(value as CanvasRoute);
}

function createCytosTerminal(): vscode.Terminal {
  return vscode.window.createTerminal({
    name: "Cytos",
    cwd: getWorkspaceRoot() ?? undefined,
  });
}

async function promptToOpenWorkspace(): Promise<boolean> {
  const selection = await vscode.window.showInformationMessage(
    "Open a project folder to start Cytos dataset creation, local inference, runs, and monitoring.",
    { modal: true },
    "Open Folder",
  );
  if (selection === "Open Folder") {
    await vscode.commands.executeCommand("workbench.action.files.openFolder");
  }
  return selection === "Open Folder";
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function pythonModuleCommand(context: vscode.ExtensionContext, projectRoot: string, args: string[]): string {
  const repoPythonRoot = path.resolve(context.extensionPath, "..", "..", "..", "..", "python");
  const projectPythonRoot = path.join(projectRoot, "python");
  const pythonPath = `${shellQuote(repoPythonRoot)}:${shellQuote(projectPythonRoot)}:\${PYTHONPATH:-}`;
  return `PYTHONPATH=${pythonPath} python3 -m cytos_engine.cli ${args.join(" ")}`;
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
legacy = root / ".axiom"
data_roots = [cytos] if cytos.exists() else ([legacy] if legacy.exists() else [])
db_path = next((p for p in [cytos / "metadata.db", legacy / "metadata.db"] if p.exists()), cytos / "metadata.db")

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

for data_root in data_roots:
    datasets_dir = data_root / "datasets"
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
for data_root in data_roots:
    artifacts_dir = data_root / "artifacts"
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

class BasicTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly description?: string,
    public readonly tooltip?: string,
    public readonly iconPath?: vscode.ThemeIcon,
    public readonly command?: vscode.Command,
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = description;
    this.tooltip = tooltip;
    this.iconPath = iconPath;
    this.command = command;
  }
}

class CytosTreeDataProvider implements vscode.TreeDataProvider<BasicTreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<BasicTreeItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<BasicTreeItem | undefined | void> = this._onDidChangeTreeData.event;

  constructor(private readonly context: CanvasRoute) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: BasicTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: BasicTreeItem): Promise<BasicTreeItem[]> {
    if (element) return [];

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

    const routeCommand = (route: CanvasRoute): vscode.Command => ({
      command: "cytos.openCanvasRoute",
      title: "Open Cytos Studio",
      arguments: [route],
    });

    switch (this.context) {
      case "home":
        return [
          new BasicTreeItem("Open Command Deck", "Projects, alerts, approvals", undefined, new vscode.ThemeIcon("home"), routeCommand("home")),
          new BasicTreeItem("Pending Approvals", "0 actions required", undefined, new vscode.ThemeIcon("pass"), routeCommand("home")),
        ];
      case "data":
        return snap.datasets.length
          ? [
              new BasicTreeItem("Open Data Studio", "Ingest, review, publish", undefined, new vscode.ThemeIcon("database"), routeCommand("data")),
              new BasicTreeItem(
                "PDF to Dataset",
                "Local inference",
                "Create a JSONL dataset from a local PDF",
                new vscode.ThemeIcon("file-pdf"),
                { command: "cytos.createDatasetFromPdf", title: "Cytos: PDF to Dataset" },
              ),
              ...snap.datasets.map((d) => new BasicTreeItem(d.name, `${d.size_mb.toFixed(2)} MB`, d.path, new vscode.ThemeIcon("layers"))),
            ]
          : [
              new BasicTreeItem("Open Data Studio", "Dataset creation", undefined, new vscode.ThemeIcon("database"), routeCommand("data")),
              new BasicTreeItem(
                "PDF to Dataset",
                "Local inference",
                "Create a JSONL dataset from a local PDF",
                new vscode.ThemeIcon("file-pdf"),
                { command: "cytos.createDatasetFromPdf", title: "Cytos: PDF to Dataset" },
              ),
              new BasicTreeItem("Import Sources", "PDF, CSV, JSON, logs", undefined, new vscode.ThemeIcon("add"), routeCommand("data")),
            ];
      case "workflows":
        return [
          new BasicTreeItem("Open Workflow Graph", "Pipelines and gates", undefined, new vscode.ThemeIcon("circuit-board"), routeCommand("workflows")),
          new BasicTreeItem("Templates", "Ingest to monitor", undefined, new vscode.ThemeIcon("symbol-class"), routeCommand("workflows")),
        ];
      case "runs":
        return snap.runs.length
          ? [
              new BasicTreeItem("Open Run Lab", "Experiments and evals", undefined, new vscode.ThemeIcon("beaker"), routeCommand("runs")),
              ...snap.runs.map((r) => new BasicTreeItem(r.run_id.substring(0, 8), r.status, r.workflow, new vscode.ThemeIcon("play"))),
            ]
          : [new BasicTreeItem("Open Run Lab", "No tracked experiments yet", undefined, new vscode.ThemeIcon("beaker"), routeCommand("runs"))];
      case "models":
        return [
          new BasicTreeItem("Open Model Inspector", `${snap.artifacts.models} model artifacts`, undefined, new vscode.ThemeIcon("symbol-misc"), routeCommand("models")),
          new BasicTreeItem("Prompt Probes", "Tokenizer and output traces", undefined, new vscode.ThemeIcon("sparkle"), routeCommand("models")),
        ];
      case "registry":
        return [
          new BasicTreeItem("Open Registry", "Candidates and approvals", undefined, new vscode.ThemeIcon("archive"), routeCommand("registry")),
          new BasicTreeItem("Staging", "Awaiting approval", undefined, new vscode.ThemeIcon("git-branch"), routeCommand("registry")),
        ];
      case "deployments":
        return [
          new BasicTreeItem("Open Deployment Console", "Endpoints and releases", undefined, new vscode.ThemeIcon("rocket"), routeCommand("deployments")),
          new BasicTreeItem("Release Controls", "Canary and rollback", undefined, new vscode.ThemeIcon("server-environment"), routeCommand("deployments")),
        ];
      case "monitoring":
        return [
          new BasicTreeItem("Open Monitor Console", "Drift, skew, latency", undefined, new vscode.ThemeIcon("pulse"), routeCommand("monitoring")),
          new BasicTreeItem("Quality Slices", "No active incidents", undefined, new vscode.ThemeIcon("graph"), routeCommand("monitoring")),
        ];
      case "alerts":
        return [
          new BasicTreeItem("Open Recovery Room", "Incidents and response", undefined, new vscode.ThemeIcon("bell"), routeCommand("alerts")),
          new BasicTreeItem("Recovery Actions", "Relabel, retrain, rollback", undefined, new vscode.ThemeIcon("tools"), routeCommand("alerts")),
        ];
    }
  }
}

function formatDate(value: string | null): string {
  if (!value) return "-";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

function formatDuration(seconds: number | null): string {
  if (seconds === null || Number.isNaN(seconds)) return "-";
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

function statCard(label: string, value: string, tone = "neutral"): string {
  return `<div class="stat ${tone}"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
}

function lane(label: string, copy: string): string {
  return `<div class="lane"><strong>${esc(label)}</strong><span>${esc(copy)}</span></div>`;
}

function buildRecentRuns(snap: MlMetadataSnapshot): string {
  const rows = snap.runs.slice(0, 6).map((r) =>
    `<div class="table-row">
      <div class="cell mono">${esc(r.run_id.slice(0, 8))}</div>
      <div class="cell">${esc(r.workflow)}</div>
      <div class="cell"><span class="badge badge-${statusClass(r.status)}">${esc(r.status)}</span></div>
      <div class="cell muted">${esc(formatDuration(r.duration_seconds))}</div>
    </div>`
  ).join("");
  return rows || `<div class="empty">No runs tracked yet.</div>`;
}

function buildDatasets(snap: MlMetadataSnapshot): string {
  const rows = snap.datasets.slice(0, 6).map((d) =>
    `<div class="table-row">
      <div class="cell strong">${esc(d.name)}</div>
      <div class="cell muted">${esc(d.extension || "-")}</div>
      <div class="cell">${d.size_mb.toFixed(2)} MB</div>
      <div class="cell mono muted">${esc(d.checksum_sha256.slice(0, 8))}</div>
    </div>`
  ).join("");
  return rows || `<div class="empty">No dataset versions published yet.</div>`;
}

function routePanel(route: CanvasRoute, snap: MlMetadataSnapshot): string {
  const m = snap.experiment_metrics;
  const panels: Record<CanvasRoute, string> = {
    home: `
      <section class="hero">
        <div>
          <div class="eyebrow">Cytos Command Deck</div>
          <h1>Ship better models from raw data to recovery.</h1>
          <p>Active projects, approvals, datasets, runs, deployments, monitoring, and response workflows live in one operating surface.</p>
        </div>
        <div class="hero-stack">
          ${statCard("Dataset versions", String(snap.datasets.length), "emerald")}
          ${statCard("Tracked runs", String(m.total_runs), "gold")}
          ${statCard("Model artifacts", String(snap.artifacts.models), "rose")}
        </div>
      </section>
      <section class="dashboard-grid">
        <div class="panel wide">
          <h2>MLOps loop</h2>
          <div class="flow">
            ${lane("Data", "Ingest and version")}
            ${lane("Runs", "Train and evaluate")}
            ${lane("Models", "Inspect behavior")}
            ${lane("Registry", "Approve and promote")}
            ${lane("Deploy", "Release safely")}
            ${lane("Monitor", "Detect drift")}
            ${lane("Recover", "Retrain or rollback")}
          </div>
        </div>
        <div class="panel">
          <h2>Approvals</h2>
          ${statCard("Pending gates", "0", "emerald")}
          ${statCard("Failed checks", String(m.failed), m.failed ? "rose" : "neutral")}
        </div>
        <div class="panel">
          <h2>System pulse</h2>
          ${statCard("Drift", "Clear", "emerald")}
          ${statCard("Latency p95", "42ms", "gold")}
        </div>
      </section>
    `,
    data: `
      <section class="studio-layout">
        <div class="panel main-stage">
          <h2>Dataset creation</h2>
          <div class="split-preview">
            <div class="document-pane">
              <span class="eyebrow">Source preview</span>
              <strong>PDF / CSV / JSON / logs</strong>
              <p>Load raw files, extract records, split text, attach metadata, and queue rows for review.</p>
              <div class="panel-actions">
                <button class="action-btn primary" data-command="createDatasetFromPdf">PDF to Dataset</button>
                <button class="action-btn" data-command="openTerminal">Local Inference Terminal</button>
              </div>
            </div>
            <div class="row-pane">
              <span class="eyebrow">Review table</span>
              ${buildDatasets(snap)}
            </div>
          </div>
        </div>
        <aside class="panel inspector">
          <h2>Schema</h2>
          ${statCard("Published versions", String(snap.datasets.length), "emerald")}
          ${statCard("Quality score", "94%", "gold")}
          ${statCard("Synthetic candidates", "0", "neutral")}
        </aside>
      </section>
    `,
    workflows: `
      <section class="studio-layout">
        <div class="panel main-stage">
          <h2>Workflow graph</h2>
          <div class="node-board">
            ${lane("Source loader", "PDF, folder, API, logs")}
            ${lane("Extractor", "OCR, parser, splitter")}
            ${lane("Validator", "Schema, nulls, duplicates")}
            ${lane("Synthesizer", "Edge cases and augmentation")}
            ${lane("Trainer", "Fine-tune and embeddings")}
            ${lane("Evaluator", "Benchmarks and gates")}
            ${lane("Registry action", "Promote or rollback")}
            ${lane("Monitor action", "Drift and alert emission")}
          </div>
        </div>
        <aside class="panel inspector">
          <h2>Selected node</h2>
          ${statCard("Gate policy", "Strict", "gold")}
          ${statCard("Artifacts", String(snap.artifacts.reports), "neutral")}
          ${statCard("Scheduler", "Manual", "emerald")}
        </aside>
      </section>
    `,
    runs: `
      <section class="dashboard-grid">
        <div class="panel">
          <h2>Experiment health</h2>
          ${statCard("Total runs", String(m.total_runs), "gold")}
          ${statCard("Running", String(m.running), "emerald")}
          ${statCard("Failed", String(m.failed), m.failed ? "rose" : "neutral")}
        </div>
        <div class="panel wide">
          <h2>Run compare</h2>
          <div class="table">
            <div class="table-head"><span>Run ID</span><span>Workflow</span><span>Status</span><span>Duration</span></div>
            ${buildRecentRuns(snap)}
          </div>
        </div>
        <div class="panel">
          <h2>Evaluation gates</h2>
          ${statCard("Accuracy", "91%", "emerald")}
          ${statCard("F1", "88%", "gold")}
          ${statCard("Regression risk", "Low", "emerald")}
        </div>
      </section>
    `,
    models: `
      <section class="studio-layout">
        <div class="panel main-stage">
          <h2>Model inspector</h2>
          <div class="probe-grid">
            ${lane("Prompt probe", "Compare outputs across checkpoints")}
            ${lane("Token stream", "Inspect generation trace")}
            ${lane("Logits summary", "Surface uncertainty and variance")}
            ${lane("Checkpoint diff", "Compare artifacts and behavior")}
          </div>
        </div>
        <aside class="panel inspector">
          <h2>Model metadata</h2>
          ${statCard("Models", String(snap.artifacts.models), "rose")}
          ${statCard("Checkpoints", String(snap.artifacts.checkpoints), "gold")}
          ${statCard("Embeddings", String(snap.artifacts.embeddings), "emerald")}
        </aside>
      </section>
    `,
    registry: `
      <section class="dashboard-grid">
        <div class="panel wide">
          <h2>Promotion board</h2>
          <div class="stage-board">
            ${lane("Candidate", "Evaluation pending")}
            ${lane("Staging", "Approval required")}
            ${lane("Production", "No active promotion")}
            ${lane("Rollback", "Ready")}
          </div>
        </div>
        <div class="panel">
          <h2>Lineage</h2>
          ${statCard("Datasets", String(snap.datasets.length), "emerald")}
          ${statCard("Runs", String(m.total_runs), "gold")}
          ${statCard("Reports", String(snap.artifacts.reports), "neutral")}
        </div>
      </section>
    `,
    deployments: `
      <section class="dashboard-grid">
        <div class="panel">
          <h2>Endpoint manager</h2>
          ${statCard("Live endpoints", "0", "neutral")}
          ${statCard("Canary", "Ready", "gold")}
          ${statCard("Rollback", "Armed", "emerald")}
        </div>
        <div class="panel wide">
          <h2>Release console</h2>
          <div class="flow">
            ${lane("Package", "Bundle model and config")}
            ${lane("Shadow", "Mirror production traffic")}
            ${lane("Canary", "Ramp with gates")}
            ${lane("Promote", "Switch target")}
          </div>
        </div>
      </section>
    `,
    monitoring: `
      <section class="dashboard-grid">
        <div class="panel">
          <h2>Health</h2>
          ${statCard("Drift", "Clear", "emerald")}
          ${statCard("Skew", "Clear", "emerald")}
          ${statCard("Latency p95", "42ms", "gold")}
        </div>
        <div class="panel wide">
          <h2>Quality slices</h2>
          <div class="monitor-grid">
            ${lane("High value segment", "No degradation")}
            ${lane("Long context prompts", "Variance stable")}
            ${lane("Fresh data window", "Distribution aligned")}
            ${lane("Failed examples", "0 queued")}
          </div>
        </div>
      </section>
    `,
    alerts: `
      <section class="studio-layout">
        <div class="panel main-stage">
          <h2>Recovery room</h2>
          <div class="flow vertical">
            ${lane("Detect", "Alert raised from drift, latency, skew, or quality")}
            ${lane("Diagnose", "Attach examples, lineage, and owning model")}
            ${lane("Respond", "Relabel, synthesize, retrain, rollback")}
            ${lane("Verify", "Gate before promotion")}
          </div>
        </div>
        <aside class="panel inspector">
          <h2>Alert inbox</h2>
          ${statCard("Open alerts", "0", "emerald")}
          ${statCard("Retrain queues", "0", "neutral")}
          ${statCard("Rollback actions", "Ready", "gold")}
        </aside>
      </section>
    `,
  };

  return panels[route];
}

function buildCanvasHtml(snap: MlMetadataSnapshot, route: CanvasRoute, warning?: string): string {
  const nav = ROUTES.map((item) =>
    `<button class="nav-item ${route === item ? "active" : ""}" data-route="${item}">
      <span>${esc(ROUTE_LABELS[item])}</span>
      <small>${esc(ROUTE_SUBTITLES[item].split(",")[0])}</small>
    </button>`
  ).join("");

  const warnHtml = warning ? `<div class="alert">${esc(warning)}</div>` : "";
  const primaryAction = route === "data"
    ? `<button class="action-btn primary" data-command="createDatasetFromPdf">PDF to Dataset</button>`
    : `<button class="action-btn primary" data-command="runInspection">Run Inspection</button>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Cytos Studio</title>
  <style>
    :root {
      --onyx: #050806;
      --carbon: #0b1110;
      --smoke: rgba(255, 255, 255, 0.055);
      --smoke-strong: rgba(255, 255, 255, 0.095);
      --line: rgba(230, 255, 246, 0.14);
      --line-strong: rgba(230, 255, 246, 0.24);
      --text: #f3fff9;
      --muted: #91a39a;
      --emerald: #35e6af;
      --gold: #d6b25e;
      --rose: #e9788f;
      --aqua: #7dd8c7;
      --shadow: rgba(0, 0, 0, 0.42);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      color: var(--text);
      background:
        linear-gradient(145deg, #050806 0%, #0d1512 42%, #12140d 100%),
        repeating-linear-gradient(90deg, rgba(255,255,255,0.025) 0 1px, transparent 1px 120px);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, sans-serif;
    }
    .shell {
      min-height: 100vh;
      display: grid;
      grid-template-columns: 260px minmax(0, 1fr);
    }
    .left-rail {
      position: sticky;
      top: 0;
      height: 100vh;
      padding: 22px 14px;
      border-right: 1px solid var(--line);
      background: rgba(5, 8, 6, 0.56);
      backdrop-filter: blur(30px);
      -webkit-backdrop-filter: blur(30px);
    }
    .brand {
      padding: 12px 12px 18px;
      border-bottom: 1px solid var(--line);
      margin-bottom: 14px;
    }
    .brand strong { display: block; font-size: 22px; letter-spacing: 0; }
    .brand span { color: var(--muted); font-size: 12px; }
    .nav { display: flex; flex-direction: column; gap: 7px; }
    .nav-item {
      width: 100%;
      text-align: left;
      border: 1px solid transparent;
      border-radius: 8px;
      color: var(--text);
      background: transparent;
      padding: 10px 11px;
      cursor: pointer;
    }
    .nav-item span { display: block; font-size: 13px; font-weight: 700; }
    .nav-item small { display: block; margin-top: 2px; color: var(--muted); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .nav-item:hover, .nav-item.active {
      background: var(--smoke);
      border-color: var(--line-strong);
      box-shadow: inset 3px 0 0 var(--gold);
    }
    .workspace {
      padding: 28px;
      display: flex;
      flex-direction: column;
      gap: 20px;
    }
    .topbar {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      align-items: flex-start;
    }
    .top-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      justify-content: flex-end;
      min-width: 280px;
    }
    .eyebrow {
      color: var(--gold);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-weight: 800;
    }
    h1, h2, p { margin: 0; letter-spacing: 0; }
    h1 { margin-top: 7px; max-width: 760px; font-size: 38px; line-height: 1.08; font-weight: 760; }
    h2 { font-size: 16px; font-weight: 760; margin-bottom: 14px; }
    p { color: var(--muted); line-height: 1.6; margin-top: 12px; max-width: 680px; }
    .action-btn {
      border: 1px solid var(--line-strong);
      border-radius: 8px;
      background: var(--smoke);
      color: var(--text);
      font-weight: 800;
      padding: 10px 14px;
      cursor: pointer;
    }
    .action-btn:hover {
      background: var(--smoke-strong);
      border-color: var(--gold);
    }
    .action-btn.primary {
      color: #04100c;
      background: linear-gradient(135deg, var(--emerald), var(--gold));
      border-color: transparent;
    }
    .panel-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 18px;
    }
    .hero {
      min-height: 310px;
      display: grid;
      grid-template-columns: minmax(0, 1.5fr) minmax(280px, 0.7fr);
      gap: 20px;
      align-items: stretch;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 28px;
      background:
        linear-gradient(135deg, rgba(53, 230, 175, 0.12), transparent 34%),
        linear-gradient(315deg, rgba(214, 178, 94, 0.14), transparent 30%),
        var(--smoke);
      box-shadow: 0 28px 70px var(--shadow);
      backdrop-filter: blur(28px);
      -webkit-backdrop-filter: blur(28px);
    }
    .hero-stack, .dashboard-grid, .studio-layout, .split-preview, .probe-grid, .monitor-grid, .node-board, .stage-board, .flow {
      display: grid;
      gap: 12px;
    }
    .hero-stack { align-content: end; }
    .dashboard-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .studio-layout { grid-template-columns: minmax(0, 1fr) 330px; }
    .split-preview { grid-template-columns: 0.8fr 1.2fr; }
    .probe-grid, .monitor-grid, .node-board, .stage-board { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .flow { grid-template-columns: repeat(7, minmax(110px, 1fr)); }
    .flow.vertical { grid-template-columns: 1fr; }
    .panel, .stat, .lane, .document-pane, .row-pane {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--smoke);
      box-shadow: 0 16px 45px rgba(0,0,0,0.22);
      backdrop-filter: blur(24px);
      -webkit-backdrop-filter: blur(24px);
    }
    .panel { padding: 18px; }
    .wide { grid-column: span 2; }
    .main-stage { min-height: 430px; }
    .inspector { min-height: 430px; }
    .stat {
      min-height: 88px;
      padding: 14px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    .stat span { color: var(--muted); font-size: 12px; }
    .stat strong { font-size: 28px; line-height: 1; }
    .stat.emerald { border-color: rgba(53, 230, 175, 0.34); }
    .stat.gold { border-color: rgba(214, 178, 94, 0.42); }
    .stat.rose { border-color: rgba(233, 120, 143, 0.38); }
    .lane {
      min-height: 78px;
      padding: 13px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .lane strong { font-size: 13px; }
    .lane span { color: var(--muted); font-size: 12px; line-height: 1.45; }
    .document-pane, .row-pane { min-height: 320px; padding: 16px; }
    .table { display: grid; gap: 5px; }
    .table-head, .table-row {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
      align-items: center;
    }
    .table-head {
      color: var(--muted);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      font-weight: 800;
      padding: 0 10px 8px;
      border-bottom: 1px solid var(--line);
    }
    .table-row {
      min-height: 40px;
      padding: 9px 10px;
      border-radius: 8px;
      background: rgba(255,255,255,0.035);
    }
    .cell { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
    .strong { font-weight: 800; }
    .muted { color: var(--muted); }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    .badge {
      display: inline-flex;
      padding: 2px 8px;
      border-radius: 8px;
      font-size: 10px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .badge-ok { background: rgba(53, 230, 175, 0.13); color: #7ff0cd; border: 1px solid rgba(53, 230, 175, 0.24); }
    .badge-err { background: rgba(233, 120, 143, 0.13); color: #f29bac; border: 1px solid rgba(233, 120, 143, 0.24); }
    .badge-running { background: rgba(214, 178, 94, 0.14); color: #e8cb83; border: 1px solid rgba(214, 178, 94, 0.26); }
    .badge-neutral { background: rgba(255,255,255,0.08); color: var(--text); border: 1px solid var(--line); }
    .empty, .alert {
      min-height: 40px;
      border-radius: 8px;
      padding: 11px 12px;
      color: var(--muted);
      background: rgba(255,255,255,0.035);
      border: 1px solid var(--line);
    }
    .alert { color: #f2a3b2; border-color: rgba(233, 120, 143, 0.34); }
    @media (max-width: 1180px) {
      .shell, .studio-layout, .split-preview, .dashboard-grid, .flow { grid-template-columns: 1fr; }
      .left-rail { position: static; height: auto; }
      .wide { grid-column: auto; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <aside class="left-rail">
      <div class="brand">
        <strong>Cytos</strong>
        <span>MLOps Operating System</span>
      </div>
      <nav class="nav">${nav}</nav>
    </aside>

    <main class="workspace">
      <header class="topbar">
        <div>
          <div class="eyebrow">${esc(ROUTE_LABELS[route])}</div>
          <h1>${esc(ROUTE_SUBTITLES[route])}</h1>
          <p>System snapshot: ${esc(formatDate(snap.generated_at))}</p>
        </div>
        <div class="top-actions">
          ${primaryAction}
          <button class="action-btn" data-command="runTests">Run Tests</button>
          <button class="action-btn" data-command="openTerminal">Terminal</button>
          <button class="action-btn" data-command="refresh">Refresh</button>
        </div>
      </header>
      ${warnHtml}
      ${routePanel(route, snap)}
    </main>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    document.addEventListener('click', (event) => {
      const routeButton = event.target.closest('[data-route]');
      if (routeButton) {
        event.preventDefault();
        vscode.postMessage({ type: 'navigate', route: routeButton.getAttribute('data-route') });
        return;
      }

      const commandButton = event.target.closest('[data-command]');
      if (commandButton) {
        event.preventDefault();
        const command = commandButton.getAttribute('data-command');
        if (command === 'refresh') {
          vscode.postMessage({ type: 'refresh' });
        } else {
          vscode.postMessage({ type: 'command', command });
        }
      }
    });
  </script>
</body>
</html>`;
}

export function activate(context: vscode.ExtensionContext): void {
  let canvasPanel: vscode.WebviewPanel | undefined;
  let activeRoute: CanvasRoute = "home";
  let messageSubscription: vscode.Disposable | undefined;
  const treeProviders: CytosTreeDataProvider[] = [];

  const runInspectionWorkflow = (): void => {
    const root = getWorkspaceRoot();
    if (!root) {
      void promptToOpenWorkspace();
      return;
    }
    const terminal = createCytosTerminal();
    const runId = `inspection-${Date.now()}`;
    const activeFile = vscode.window.activeTextEditor?.document.uri.fsPath ?? "";
    const configJson = JSON.stringify({ active_file: activeFile });
    terminal.show(true);
    terminal.sendText(
      pythonModuleCommand(context, root, [
        "run",
        "--project-root", shellQuote(root),
        "--workflow", "inspection",
        "--run-id", shellQuote(runId),
        "--config-json", shellQuote(configJson),
      ]),
      true,
    );
  };

  const createDatasetFromPdf = async (): Promise<void> => {
    const root = getWorkspaceRoot();
    if (!root) {
      await promptToOpenWorkspace();
      return;
    }

    const picked = await vscode.window.showOpenDialog({
      title: "Select a PDF for Cytos dataset creation",
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters: {
        "PDF documents": ["pdf"],
        "Text sources": ["txt", "md", "csv", "json", "jsonl", "log"],
      },
    });
    const source = picked?.[0]?.fsPath;
    if (!source) return;

    const runId = `dataset-${Date.now()}`;
    const datasetName = source.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") || "dataset";
    const configJson = JSON.stringify({
      source_path: source,
      dataset_name: datasetName,
      chunk_chars: 1800,
      overlap_chars: 160,
      local_inference: true,
    });
    const terminal = createCytosTerminal();
    terminal.show(true);
    terminal.sendText(
      pythonModuleCommand(context, root, [
        "run",
        "--project-root", shellQuote(root),
        "--workflow", "dataset_creation",
        "--run-id", shellQuote(runId),
        "--config-json", shellQuote(configJson),
      ]),
      true,
    );
    vscode.window.showInformationMessage("Cytos is creating a local dataset from your PDF. The new JSONL artifact will appear under .cytos/datasets.");
    treeProviders.forEach((provider) => provider.refresh());
  };

  const runPytest = (): void => {
    if (!getWorkspaceRoot()) {
      void promptToOpenWorkspace();
      return;
    }
    const terminal = createCytosTerminal();
    terminal.show(true);
    terminal.sendText("python3 -m pytest -q", true);
  };

  const openTerminal = (): void => {
    createCytosTerminal().show(true);
  };

  const openCanvas = async (route: CanvasRoute = "home"): Promise<void> => {
    const root = getWorkspaceRoot();
    if (!root) {
      await promptToOpenWorkspace();
      return;
    }

    activeRoute = route;

    if (!canvasPanel) {
      canvasPanel = vscode.window.createWebviewPanel(
        "cytosWorkflowCanvas",
        "Cytos Studio",
        vscode.ViewColumn.One,
        { enableScripts: true, retainContextWhenHidden: true },
      );
      canvasPanel.onDidDispose(() => {
        canvasPanel = undefined;
        messageSubscription?.dispose();
        messageSubscription = undefined;
      });
    } else {
      canvasPanel.reveal(vscode.ViewColumn.One, false);
    }

    const render = async (): Promise<void> => {
      if (!canvasPanel) return;
      let warning: string | undefined;
      let snap = emptySnapshot();
      try {
        snap = await fetchMlMetadata(root);
      } catch (err) {
        warning = err instanceof Error ? err.message : String(err);
      }
      canvasPanel.webview.html = buildCanvasHtml(snap, activeRoute, warning);
    };

    messageSubscription?.dispose();
    messageSubscription = canvasPanel.webview.onDidReceiveMessage((msg: unknown) => {
      if (typeof msg !== "object" || msg === null || !("type" in msg)) return;
      const event = msg as { type?: string; route?: string; command?: string };
      if (event.type === "refresh") {
        void render();
        return;
      }
      if (event.type === "navigate" && isCanvasRoute(event.route)) {
        activeRoute = event.route;
        void render();
        return;
      }
      if (event.type === "command") {
        if (event.command === "runInspection") runInspectionWorkflow();
        if (event.command === "createDatasetFromPdf") void createDatasetFromPdf();
        if (event.command === "runTests") runPytest();
        if (event.command === "openTerminal") openTerminal();
      }
    });

    await render();
  };

  for (const route of ROUTES) {
    const provider = new CytosTreeDataProvider(route);
    treeProviders.push(provider);
    vscode.window.registerTreeDataProvider(`cytos-${route}`, provider);
  }

  context.subscriptions.push(
    vscode.commands.registerCommand("cytos.openCanvasRoute", async (route: unknown) => {
      await openCanvas(isCanvasRoute(route) ? route : "home");
    }),
    vscode.commands.registerCommand("cytos.openWorkflowCanvas", async (route?: unknown) => {
      await openCanvas(isCanvasRoute(route) ? route : "home");
    }),
    vscode.commands.registerCommand("cytos.openWorkflowDashboard", async () => {
      await openCanvas("home");
    }),
    vscode.commands.registerCommand("cytos.runPytest", () => {
      runPytest();
    }),
    vscode.commands.registerCommand("cytos.runInspectionWorkflow", () => {
      runInspectionWorkflow();
    }),
    vscode.commands.registerCommand("cytos.createDatasetFromPdf", () => {
      void createDatasetFromPdf();
    }),
    vscode.commands.registerCommand("cytos.openTerminal", () => {
      openTerminal();
    }),
  );

  if (getWorkspaceRoot()) {
    void vscode.commands.executeCommand("cytos.openWorkflowCanvas");
  } else {
    void promptToOpenWorkspace();
  }
}

export function deactivate(): void {}
