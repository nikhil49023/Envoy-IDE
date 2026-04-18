type TerminalPanelProps = {
  title: string;
  logs: string[];
};

export function TerminalPanel({ title, logs }: TerminalPanelProps) {
  return (
    <section className="terminal-panel">
      <h3 className="panel-title">{title}</h3>
      <pre>{logs.join("\n")}</pre>
    </section>
  );
}
