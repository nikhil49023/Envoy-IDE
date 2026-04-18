type CommandBarProps = {
  onOpenFolder: () => void;
  onRunCommand: () => void;
  onWorkflow: (workflow: string) => void;
  commandInput: string;
  setCommandInput: (value: string) => void;
  projectRoot: string | null;
  theme: string;
  setTheme: (value: string) => void;
  layoutPreset: string;
  setLayoutPreset: (value: string) => void;
};

export function CommandBar({
  onOpenFolder,
  onRunCommand,
  onWorkflow,
  commandInput,
  setCommandInput,
  projectRoot,
  theme,
  setTheme,
  layoutPreset,
  setLayoutPreset,
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

      <label className="theme-select-wrap" htmlFor="theme-select">
        Theme
        <select
          id="theme-select"
          className="theme-select"
          value={theme}
          onChange={(event) => setTheme(event.target.value)}
        >
          <option value="aurora">Aurora Glass</option>
          <option value="graphite">Graphite Mist</option>
          <option value="ember">Ember Lux</option>
        </select>
      </label>

      <label className="theme-select-wrap" htmlFor="layout-select">
        Layout
        <select
          id="layout-select"
          className="theme-select"
          value={layoutPreset}
          onChange={(event) => setLayoutPreset(event.target.value)}
        >
          <option value="balanced">Balanced</option>
          <option value="focus">Focus</option>
          <option value="analysis">Analysis</option>
          <option value="wide">Wide</option>
        </select>
      </label>

      <button className="ghost-button" onClick={onOpenFolder}>
        Open Project
      </button>
    </header>
  );
}
