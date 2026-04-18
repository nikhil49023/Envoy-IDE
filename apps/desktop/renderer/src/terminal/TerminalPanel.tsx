type TerminalPanelProps = {
  title: string;
  logs: string[];
  terminalInput: string;
  setTerminalInput: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  hasTerminal: boolean;
  showControls?: boolean;
};

export function TerminalPanel({
  title,
  logs,
  terminalInput,
  setTerminalInput,
  onSend,
  onStop,
  hasTerminal,
  showControls = true,
}: TerminalPanelProps) {
  return (
    <section className="terminal-panel">
      <h3 className="panel-title">{title}</h3>
      <pre>{logs.join("\n")}</pre>
      {showControls ? (
        <div className="terminal-controls">
          <input
            value={terminalInput}
            onChange={(event) => setTerminalInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                onSend();
              }
            }}
            placeholder={hasTerminal ? "Type command and press Enter" : "Open a project to start terminal"}
            disabled={!hasTerminal}
          />
          <button onClick={onSend} disabled={!hasTerminal}>
            Send
          </button>
          <button onClick={onStop} disabled={!hasTerminal}>
            Stop
          </button>
        </div>
      ) : null}
    </section>
  );
}
