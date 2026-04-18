import { useEffect, useRef } from "react";

import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

type TerminalChunk = {
  seq: number;
  data: string;
};

type XtermViewportProps = {
  terminalId: string | null;
  latestChunk: TerminalChunk;
  onWrite: (data: string) => void;
  onResize: (cols: number, rows: number) => void;
  onStop: () => void;
};

export function XtermViewport({ terminalId, latestChunk, onWrite, onResize, onStop }: XtermViewportProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const onWriteRef = useRef(onWrite);
  const onResizeRef = useRef(onResize);

  useEffect(() => {
    onWriteRef.current = onWrite;
  }, [onWrite]);

  useEffect(() => {
    onResizeRef.current = onResize;
  }, [onResize]);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const terminal = new Terminal({
      allowProposedApi: false,
      cursorBlink: true,
      cursorStyle: "bar",
      fontFamily: "JetBrains Mono, IBM Plex Mono, monospace",
      fontSize: 13,
      lineHeight: 1.25,
      scrollback: 3000,
      convertEol: false,
      theme: {
        background: "#050a10",
        foreground: "#d2ffec",
        cursor: "#9affe3",
        black: "#1d2732",
        red: "#ff8f83",
        green: "#89f8bc",
        yellow: "#ffd98e",
        blue: "#7db4ff",
        magenta: "#f0b8ff",
        cyan: "#6de3f3",
        white: "#eaf3ff",
        brightBlack: "#5e6f86",
        brightRed: "#ffb7ad",
        brightGreen: "#b5ffd4",
        brightYellow: "#ffe8bb",
        brightBlue: "#accfff",
        brightMagenta: "#f8d4ff",
        brightCyan: "#a8f5ff",
        brightWhite: "#ffffff",
      },
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(containerRef.current);
    fitAddon.fit();
    onResizeRef.current(terminal.cols, terminal.rows);
    terminal.writeln("Envoy terminal ready.");

    const disposeInput = terminal.onData((data) => {
      onWriteRef.current(data);
    });

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      onResizeRef.current(terminal.cols, terminal.rows);
    });
    resizeObserver.observe(containerRef.current);

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    return () => {
      resizeObserver.disconnect();
      disposeInput.dispose();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!terminalRef.current) {
      return;
    }

    if (!terminalId) {
      terminalRef.current.writeln("\r\n[terminal offline] Open a project to start a shell.");
      return;
    }

    terminalRef.current.writeln(`\r\n[attached ${terminalId.slice(0, 8)}]`);
  }, [terminalId]);

  useEffect(() => {
    if (!terminalRef.current) {
      return;
    }
    if (!latestChunk.data) {
      return;
    }
    terminalRef.current.write(latestChunk.data);
  }, [latestChunk]);

  return (
    <section className="terminal-panel xterm-host-panel">
      <div className="terminal-header-row">
        <h3 className="panel-title">Terminal</h3>
        <div className="terminal-actions">
          <button
            onClick={() => {
              terminalRef.current?.clear();
            }}
          >
            Clear
          </button>
          <button onClick={onStop} disabled={!terminalId}>
            Stop
          </button>
        </div>
      </div>
      <div ref={containerRef} className="xterm-host" />
    </section>
  );
}
