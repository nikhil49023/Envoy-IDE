type WorkflowWorkspaceProps = {
  onRunWorkflow: (workflow: string) => void;
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

export function WorkflowWorkspace({ onRunWorkflow }: WorkflowWorkspaceProps) {
  return (
    <section className="panel workflow-workspace glass-panel">
      <div className="workspace-heading-row">
        <div>
          <h3 className="panel-title">Workflow Mode</h3>
          <p className="workspace-subtitle">Design and operate the full ML lifecycle in one surface.</p>
        </div>
        <div className="workspace-actions">
          <button onClick={() => onRunWorkflow("dataset_creation")}>Dataset Build</button>
          <button onClick={() => onRunWorkflow("evaluation")}>Evaluate</button>
          <button onClick={() => onRunWorkflow("inspection")}>Inspect Models</button>
          <button onClick={() => onRunWorkflow("export")}>Export Artifacts</button>
        </div>
      </div>

      <div className="platform-section-grid">
        {PLATFORM_SECTIONS.map((section) => (
          <article key={section.name} className="platform-card">
            <h4>{section.name}</h4>
            <p>{section.description}</p>
          </article>
        ))}
      </div>

      <div className="workflow-bottom-grid">
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
            <li>Environment snapshots (Conda/pip/Docker/CUDA)</li>
            <li>Seed and dependency lock capture</li>
            <li>Replay runs from experiment metadata</li>
            <li>Run/model/dataset side-by-side comparison</li>
          </ul>
        </section>

        <section className="workflow-module-card">
          <h4>Governance + Collaboration</h4>
          <ul>
            <li>Notebook-aware Git and diff-ready workflows</li>
            <li>Comments on runs, models, and datasets</li>
            <li>Role-based access and audit lineage</li>
            <li>Secrets, trust, and sandbox execution boundaries</li>
          </ul>
        </section>
      </div>
    </section>
  );
}
