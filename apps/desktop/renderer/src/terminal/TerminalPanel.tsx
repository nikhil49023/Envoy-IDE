type TerminalPanelProps = {
  logs: string[];
};

export function TerminalPanel({ logs }: TerminalPanelProps) {
  return (
    <section className="panel terminal-panel">
      <h3>Terminal / Logs</h3>
      <pre>{logs.join("\n")}</pre>
    </section>
  );
}
