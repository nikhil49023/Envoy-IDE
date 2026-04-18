type CommandBarProps = {
  onOpenFolder: () => void;
  onRunCommand: () => void;
  onWorkflow: (workflow: string) => void;
  commandInput: string;
  setCommandInput: (value: string) => void;
};

export function CommandBar({
  onOpenFolder,
  onRunCommand,
  onWorkflow,
  commandInput,
  setCommandInput,
}: CommandBarProps) {
  return (
    <header className="command-bar">
      <button onClick={onOpenFolder}>Open Project</button>
      <button onClick={() => onWorkflow("evaluation")}>Evaluate</button>
      <button onClick={() => onWorkflow("export")}>Export</button>
      <button onClick={() => onWorkflow("simulation")}>Simulate</button>
      <button onClick={() => onWorkflow("inspection")}>Inspect</button>
      <input
        className="command-input"
        value={commandInput}
        onChange={(event) => setCommandInput(event.target.value)}
        placeholder="Custom run command, e.g. python train.py"
      />
      <button onClick={onRunCommand}>Run Command</button>
    </header>
  );
}
