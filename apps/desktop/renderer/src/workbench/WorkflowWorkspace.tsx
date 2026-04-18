import type { MlMetadataState, MlRunSummary } from "./mlState";

type WorkflowWorkspaceProps = {
  onRunWorkflow: (workflow: string) => void;
  mlState: MlMetadataState | null;
  mlLoading: boolean;
  onRefresh: () => void;
};

const PLATFORM_SECTIONS = [
  {
    name: "Project Home",
    description: "Workspace summary, trust settings, and onboarding templates.",
  },
  {
    name: "Data",
    description: "Dataset registry, schema checks, previews, and lineage.",
  },
  {
    name: "Experiments",
    description: "Track hyperparameters, metrics, notes, and hardware traces.",
  },
  {
    name: "Training",
    description: "Launch local/remote jobs with monitoring and queue controls.",
  },
  {
    name: "Models",
    description: "Registry with versioning, promotion, rollback, and approvals.",
  },
  {
    name: "Deployments",
    description: "REST, gRPC, batch, streaming, shadow, and staged releases.",
  },
  {
    name: "Monitoring",
    description: "Drift, latency, failures, feature skew, and governance views.",
  },
];

const EXECUTION_TARGETS = [
  "Local Laptop",
  "SSH GPU Server",
  "Kubernetes Job",
  "Managed Cloud",
];

function formatTimestamp(value: string | null): string {
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
  if (typeof seconds !== "number" || Number.isNaN(seconds)) {
    return "-";
  }

  if (seconds < 1) {
    return `${Math.round(seconds * 1000)}ms`;
  }

  if (seconds < 60) {
    return `${seconds.toFixed(2)}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return `${minutes}m ${remainder}s`;
}

function statusClass(status: string): string {
  const normalized = status.trim().toLowerCase();
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

function compareLabel(run: MlRunSummary): string {
  return `${run.workflow} ${run.run_id.slice(0, 8)}`;
}

export function WorkflowWorkspace({ onRunWorkflow, mlState, mlLoading, onRefresh }: WorkflowWorkspaceProps) {
  const runs = mlState?.runs ?? [];
  const datasets = mlState?.datasets ?? [];
  const experimentMetrics = mlState?.experiment_metrics;
  const artifacts = mlState?.artifacts;
  const reproducibility = mlState?.reproducibility;

  const compareRuns = runs
    .filter((run) => run.completed_at || typeof run.duration_seconds === "number")
    .slice(0, 2);

  const extensionCounts = datasets.reduce<Record<string, number>>((acc, dataset) => {
    const key = dataset.extension || "(none)";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  const extensionSummary = Object.entries(extensionCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);

  return (
    <section className="panel workflow-workspace glass-panel">
      <div className="workspace-heading-row">
        <div>
          <h3 className="panel-title">Workflow Mode</h3>
          <p className="workspace-subtitle">Design and operate the full ML lifecycle in one surface.</p>
          <p className="workspace-subtitle workflow-generated-at">
            Snapshot: {mlState ? formatTimestamp(mlState.generated_at) : "No metadata yet"}
          </p>
        </div>
        <div className="workspace-actions">
          <button onClick={onRefresh} disabled={mlLoading}>
            {mlLoading ? "Refreshing..." : "Refresh State"}
          </button>
          <button onClick={() => onRunWorkflow("dataset_creation")}>Dataset Build</button>
          <button onClick={() => onRunWorkflow("evaluation")}>Evaluate</button>
          <button onClick={() => onRunWorkflow("inspection")}>Inspect Models</button>
          <button onClick={() => onRunWorkflow("export")}>Export Artifacts</button>
        </div>
      </div>

      <div className="workflow-metrics-grid">
        <article className="workflow-kpi-card">
          <h4>Total Runs</h4>
          <strong>{experimentMetrics?.total_runs ?? 0}</strong>
          <p>All executions recorded in local metadata.</p>
        </article>
        <article className="workflow-kpi-card">
          <h4>Running</h4>
          <strong>{experimentMetrics?.running ?? 0}</strong>
          <p>Active workflow or command runs now.</p>
        </article>
        <article className="workflow-kpi-card">
          <h4>Successful</h4>
          <strong>{experimentMetrics?.succeeded ?? 0}</strong>
          <p>Completed runs that reported success.</p>
        </article>
        <article className="workflow-kpi-card">
          <h4>Failed</h4>
          <strong>{experimentMetrics?.failed ?? 0}</strong>
          <p>Runs that exited with failure status.</p>
        </article>
        <article className="workflow-kpi-card">
          <h4>Datasets</h4>
          <strong>{datasets.length}</strong>
          <p>Discovered files under .axiom/datasets.</p>
        </article>
        <article className="workflow-kpi-card">
          <h4>Artifacts</h4>
          <strong>{(artifacts?.models ?? 0) + (artifacts?.reports ?? 0)}</strong>
          <p>
            {artifacts?.models ?? 0} models, {artifacts?.reports ?? 0} reports, {artifacts?.checkpoints ?? 0} checkpoints.
          </p>
        </article>
      </div>

      <div className="platform-section-grid">
        {PLATFORM_SECTIONS.map((section) => (
          <article key={section.name} className="platform-card">
            <h4>{section.name}</h4>
            <p>{section.description}</p>
          </article>
        ))}
      </div>

      <div className="workflow-registry-grid">
        <section className="workflow-module-card">
          <h4>Experiment Tracker</h4>
          {runs.length === 0 ? (
            <p>No runs recorded yet. Launch any workflow or command to start tracking.</p>
          ) : (
            <div className="workflow-table-wrap">
              <table className="workflow-table">
                <thead>
                  <tr>
                    <th>Run</th>
                    <th>Workflow</th>
                    <th>Status</th>
                    <th>Duration</th>
                    <th>Started</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.slice(0, 12).map((run) => (
                    <tr key={run.run_id}>
                      <td title={run.run_id}>{run.run_id.slice(0, 10)}</td>
                      <td>{run.workflow}</td>
                      <td>
                        <span className={`run-status ${statusClass(run.status)}`}>{run.status}</span>
                      </td>
                      <td>{formatDuration(run.duration_seconds)}</td>
                      <td>{formatTimestamp(run.started_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="workflow-module-card">
          <h4>Dataset Registry</h4>
          {datasets.length === 0 ? (
            <p>No datasets discovered yet. Run dataset workflows to populate registry metadata.</p>
          ) : (
            <div className="workflow-table-wrap">
              <table className="workflow-table compact">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Type</th>
                    <th>Size (MB)</th>
                    <th>Updated</th>
                    <th>Checksum</th>
                  </tr>
                </thead>
                <tbody>
                  {datasets.slice(0, 10).map((dataset) => (
                    <tr key={dataset.path}>
                      <td title={dataset.path}>{dataset.name}</td>
                      <td>{dataset.extension || "-"}</td>
                      <td>{dataset.size_mb.toFixed(2)}</td>
                      <td>{formatTimestamp(dataset.modified_at)}</td>
                      <td title={dataset.checksum_sha256}>{dataset.checksum_sha256.slice(0, 12)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {extensionSummary.length > 0 ? (
            <p>
              Top data formats: {extensionSummary.map(([ext, count]) => `${ext} (${count})`).join(", ")}.
            </p>
          ) : null}
        </section>
      </div>

      <div className="workflow-bottom-grid">
        <section className="workflow-module-card">
          <h4>Run Comparison</h4>
          {compareRuns.length < 2 ? (
            <p>Need at least two completed runs to compare execution profiles.</p>
          ) : (
            <div className="compare-run-grid">
              {compareRuns.map((run) => (
                <article key={run.run_id} className="compare-run-card">
                  <h5>{compareLabel(run)}</h5>
                  <p>Status: {run.status}</p>
                  <p>Duration: {formatDuration(run.duration_seconds)}</p>
                  <p>Started: {formatTimestamp(run.started_at)}</p>
                  <p>Finished: {formatTimestamp(run.completed_at)}</p>
                  <p>Summary: {run.summary ?? "No summary captured"}</p>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="workflow-module-card">
          <h4>Training Targets</h4>
          <ul>
            {EXECUTION_TARGETS.map((target) => (
              <li key={target}>{target}</li>
            ))}
          </ul>
          <p>Queue, pause/resume, retries, and scheduled execution are first-class controls.</p>
        </section>

        <section className="workflow-module-card">
          <h4>Reproducibility Stack</h4>
          <ul>
            <li>Python: {reproducibility?.python_version ?? "unknown"}</li>
            <li>Platform: {reproducibility?.platform ?? "unknown"}</li>
            <li>Dependency lock: {reproducibility?.dependency_lock_present ? "present" : "missing"}</li>
            <li>
              Env files: {reproducibility?.env_files.length ? reproducibility.env_files.join(", ") : "none found"}
            </li>
          </ul>
        </section>
      </div>
    </section>
  );
}
