type TerminalPanelProps = {
  logs: string[];
  terminalInput: string;
  setTerminalInput: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  hasTerminal: boolean;
};

export function TerminalPanel({
  logs,
  terminalInput,
  setTerminalInput,
  onSend,
  onStop,
  hasTerminal,
}: TerminalPanelProps) {
  return (
    <section className="panel terminal-panel">
      <h3>Terminal / Logs</h3>
      <pre>{logs.join("\n")}</pre>
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
    </section>
  );
}
