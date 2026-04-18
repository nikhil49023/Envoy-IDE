type InspectorPanelProps = {
  projectRoot: string | null;
  activeFilePath: string | null;
  latestRunId: string | null;
};

export function InspectorPanel({ projectRoot, activeFilePath, latestRunId }: InspectorPanelProps) {
  return (
    <section className="panel inspector-panel">
      <h3>Inspector</h3>
      <div className="inspector-item">
        <label>Project Root</label>
        <p>{projectRoot ?? "Not opened"}</p>
      </div>
      <div className="inspector-item">
        <label>Active File</label>
        <p>{activeFilePath ?? "None"}</p>
      </div>
      <div className="inspector-item">
        <label>Latest Run</label>
        <p>{latestRunId ?? "No runs yet"}</p>
      </div>
      <div className="inspector-item">
        <label>Assistant Scope</label>
        <p>Error explanation, workflow suggestion, metrics summary, export guidance.</p>
      </div>
    </section>
  );
}
