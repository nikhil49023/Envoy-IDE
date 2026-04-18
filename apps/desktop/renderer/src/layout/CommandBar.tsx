type CommandBarProps = {
  onOpenFolder: () => void;
  onRunCommand: () => void;
  onWorkflow: (workflow: string) => void;
  commandInput: string;
  setCommandInput: (value: string) => void;
  projectRoot: string | null;
};

export function CommandBar({
  onOpenFolder,
  onRunCommand,
  onWorkflow,
  commandInput,
  setCommandInput,
  projectRoot,
}: CommandBarProps) {
  const projectName = projectRoot?.split(/[\\/]/).filter(Boolean).pop() ?? "No project open";

  return (
    <header className="command-bar">
      <div className="brand-cluster">
        <span className="brand-mark">Envoy IDE</span>
        <span className="brand-meta">{projectName}</span>
      </div>

      <div className="workflow-chip-row">
        <button onClick={() => onWorkflow("evaluation")}>Evaluate</button>
        <button onClick={() => onWorkflow("export")}>Export</button>
        <button onClick={() => onWorkflow("simulation")}>Simulate</button>
        <button onClick={() => onWorkflow("inspection")}>Inspect</button>
      </div>

      <div className="command-runner">
        <input
          className="command-input"
          value={commandInput}
          onChange={(event) => setCommandInput(event.target.value)}
          placeholder="Custom run command, e.g. python train.py"
        />
        <button onClick={onRunCommand}>Run</button>
      </div>

      <button className="ghost-button" onClick={onOpenFolder}>
        Open Project
      </button>
    </header>
  );
}
