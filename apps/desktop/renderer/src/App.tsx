import { useCallback, useEffect, useMemo, useState } from "react";

import type { FileNode, OpenTab } from "@core-types/index";

import { EditorPane } from "./editor/EditorPane";
import { FileExplorer } from "./explorer/FileExplorer";
import { CommandBar } from "./layout/CommandBar";
import { InspectorPanel } from "./panels/InspectorPanel";
import { TerminalPanel } from "./terminal/TerminalPanel";

type ActivityView = "explorer" | "workflows";
type BottomView = "terminal" | "events";

const WORKFLOW_OPTIONS = [
  { id: "evaluation", label: "Evaluation" },
  { id: "export", label: "Export" },
  { id: "simulation", label: "Simulation" },
  { id: "inspection", label: "Inspection" },
] as const;

export function App() {
  const [projectRoot, setProjectRoot] = useState<string | null>(null);
  const [tree, setTree] = useState<FileNode[]>([]);
  const [tabs, setTabs] = useState<Record<string, OpenTab>>({});
  const [tabOrder, setTabOrder] = useState<string[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [runtimeLogs, setRuntimeLogs] = useState<string[]>([
    "Envoy IDE ready.",
    "Open a project and start running workflows.",
  ]);
  const [terminalLogs, setTerminalLogs] = useState<string[]>([
    "Terminal is idle. Open a project to start an interactive shell.",
  ]);
  const [latestRunId, setLatestRunId] = useState<string | null>(null);
  const [commandInput, setCommandInput] = useState("python3 -V");
  const [terminalId, setTerminalId] = useState<string | null>(null);
  const [terminalInput, setTerminalInput] = useState("");
  const [activityView, setActivityView] = useState<ActivityView>("explorer");
  const [bottomView, setBottomView] = useState<BottomView>("terminal");

  useEffect(() => {
    const disposeRuntime = window.envoy.onRuntimeEvent((payload) => {
      const line = JSON.stringify(payload);
      setRuntimeLogs((prev) => [...prev.slice(-300), line]);
      const runId = payload.run_id;
      if (typeof runId === "string") {
        setLatestRunId(runId);
      }
    });

    return () => {
      disposeRuntime();
    };
  }, []);

  useEffect(() => {
    const disposeTerminal = window.envoy.onTerminalEvent((payload) => {
      if (terminalId && payload.terminalId !== terminalId) {
        return;
      }

      if (payload.type === "data") {
        const lines = (payload.data ?? "")
          .split(/\r?\n/)
          .map((line) => line.trimEnd())
          .filter((line) => line.length > 0);
        if (lines.length > 0) {
          setTerminalLogs((prev) => [...prev.slice(-600), ...lines]);
        }
      }

      if (payload.type === "exit") {
        setTerminalLogs((prev) => [...prev.slice(-600), `Terminal exited with code ${payload.code ?? 0}`]);
      }

      if (payload.type === "error") {
        setTerminalLogs((prev) => [...prev.slice(-600), `Terminal error: ${payload.data ?? "unknown"}`]);
      }
    });

    return () => {
      disposeTerminal();
    };
  }, [terminalId]);

  const openTabs = useMemo(
    () => tabOrder.map((path) => tabs[path]).filter((tab): tab is OpenTab => Boolean(tab)),
    [tabOrder, tabs],
  );

  const saveActiveFile = useCallback(async () => {
    if (!activePath) {
      return;
    }

    const tab = tabs[activePath];
    if (!tab) {
      return;
    }

    const ok = await window.envoy.writeFile(activePath, tab.content);
    if (ok) {
      setTabs((prev) => ({
        ...prev,
        [activePath]: {
          ...prev[activePath],
          dirty: false,
        },
      }));
      setRuntimeLogs((prev) => [...prev.slice(-300), `Saved: ${activePath}`]);
      return;
    }

    setRuntimeLogs((prev) => [...prev.slice(-300), `Save failed: ${activePath}`]);
  }, [activePath, tabs]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveActiveFile();
      }
    };

    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
    };
  }, [saveActiveFile]);

  async function handleOpenFolder() {
    const folder = await window.envoy.openFolder();
    if (!folder) {
      return;
    }

    if (terminalId) {
      await window.envoy.killTerminal(terminalId);
    }

    setProjectRoot(folder);
    setTabs({});
    setTabOrder([]);
    setActivePath(null);

    const nodes = await window.envoy.listTree(folder);
    setTree(nodes);
    setRuntimeLogs((prev) => [...prev.slice(-300), `Opened folder: ${folder}`]);

    const createdTerminalId = await window.envoy.createTerminal(folder);
    setTerminalId(createdTerminalId);
    setTerminalLogs([
      `Terminal ready: ${createdTerminalId}`,
      "Type a command in the prompt below and press Enter.",
    ]);
  }

  async function handleOpenFile(path: string) {
    const content = await window.envoy.readFile(path);
    setTabs((prev) => ({
      ...prev,
      [path]: {
        path,
        content,
        dirty: false,
      },
    }));
    setTabOrder((prev) => (prev.includes(path) ? prev : [...prev, path]));
    setActivePath(path);
  }

  function handleEditorChange(value: string) {
    if (!activePath) {
      return;
    }
    setTabs((prev) => ({
      ...prev,
      [activePath]: {
        ...(prev[activePath] ?? { path: activePath, content: "", dirty: false }),
        content: value,
        dirty: true,
      },
    }));
  }

  async function runWorkflow(workflow: string) {
    if (!projectRoot) {
      setRuntimeLogs((prev) => [...prev.slice(-300), "Open a project first."]);
      return;
    }
    const runId = await window.envoy.runWorkflow(projectRoot, workflow, {
      active_file: activePath,
    });
    setLatestRunId(runId);
    setRuntimeLogs((prev) => [...prev.slice(-300), `Workflow started: ${workflow} (${runId})`]);
  }

  async function runCustomCommand() {
    if (!projectRoot) {
      setRuntimeLogs((prev) => [...prev.slice(-300), "Open a project first."]);
      return;
    }

    const parts = commandInput.trim().split(/\s+/);
    const command = parts[0];
    const args = parts.slice(1);

    if (!command) {
      setRuntimeLogs((prev) => [...prev.slice(-300), "Enter a command before running."]);
      return;
    }

    const runId = await window.envoy.runCommand(projectRoot, command, args);
    setLatestRunId(runId);
    setRuntimeLogs((prev) => [...prev.slice(-300), `Command started: ${commandInput} (${runId})`]);
  }

  async function sendTerminalInput() {
    if (!terminalId) {
      setTerminalLogs((prev) => [...prev.slice(-600), "Terminal is not initialized."]);
      return;
    }
    if (!terminalInput.trim()) {
      return;
    }

    await window.envoy.writeTerminal(terminalId, `${terminalInput}\n`);
    setTerminalInput("");
  }

  async function stopTerminal() {
    if (!terminalId) {
      return;
    }
    await window.envoy.killTerminal(terminalId);
    setTerminalId(null);
    setTerminalLogs((prev) => [...prev.slice(-600), "Terminal stopped."]);
  }

  function closeTab(path: string) {
    setTabs((prev) => {
      const next = { ...prev };
      delete next[path];
      return next;
    });

    setTabOrder((prev) => {
      const index = prev.indexOf(path);
      const next = prev.filter((item) => item !== path);
      setActivePath((current) => {
        if (current !== path) {
          return current;
        }
        return next[index] ?? next[index - 1] ?? null;
      });
      return next;
    });
  }

  const activeFileName = activePath?.split(/[\\/]/).pop() ?? "No file";
  const projectName = projectRoot?.split(/[\\/]/).filter(Boolean).pop() ?? "No project";
  const activeBottomLogs = bottomView === "terminal" ? terminalLogs : runtimeLogs;

  return (
    <div className="app-shell">
      <CommandBar
        onOpenFolder={handleOpenFolder}
        onRunCommand={runCustomCommand}
        onWorkflow={runWorkflow}
        commandInput={commandInput}
        setCommandInput={setCommandInput}
        projectRoot={projectRoot}
      />

      <div className="ide-body">
        <aside className="activity-rail glass-panel">
          <button
            className={activityView === "explorer" ? "active" : ""}
            onClick={() => setActivityView("explorer")}
          >
            EX
          </button>
          <button
            className={activityView === "workflows" ? "active" : ""}
            onClick={() => setActivityView("workflows")}
          >
            WF
          </button>
        </aside>

        <aside className="left-pane">
          {activityView === "explorer" ? (
            <FileExplorer nodes={tree} onOpenFile={handleOpenFile} activePath={activePath} />
          ) : (
            <section className="panel workflow-panel glass-panel">
              <h3 className="panel-title">Workflow Studio</h3>
              <p>Launch workflow presets for your current project context.</p>
              <div className="workflow-list">
                {WORKFLOW_OPTIONS.map((workflow) => (
                  <button key={workflow.id} onClick={() => runWorkflow(workflow.id)}>
                    {workflow.label}
                  </button>
                ))}
              </div>
            </section>
          )}
        </aside>

        <main className="center-pane">
          <EditorPane
            tabs={openTabs}
            activePath={activePath}
            onActivateTab={setActivePath}
            onCloseTab={closeTab}
            onSave={() => {
              void saveActiveFile();
            }}
            onChange={handleEditorChange}
          />

          <section className="panel bottom-panel glass-panel">
            <div className="bottom-tabs">
              <button
                className={bottomView === "terminal" ? "active" : ""}
                onClick={() => setBottomView("terminal")}
              >
                Terminal
              </button>
              <button
                className={bottomView === "events" ? "active" : ""}
                onClick={() => setBottomView("events")}
              >
                Events
              </button>
            </div>
            <TerminalPanel
              title={bottomView === "terminal" ? "Terminal" : "Runtime Events"}
              logs={activeBottomLogs}
              terminalInput={terminalInput}
              setTerminalInput={setTerminalInput}
              onSend={sendTerminalInput}
              onStop={stopTerminal}
              hasTerminal={Boolean(terminalId)}
              showControls={bottomView === "terminal"}
            />
          </section>
        </main>

        <InspectorPanel
          projectRoot={projectRoot}
          activeFilePath={activePath}
          latestRunId={latestRunId}
        />
      </div>

      <footer className="status-bar glass-panel">
        <span>Project: {projectName}</span>
        <span>File: {activeFileName}</span>
        <span>Run: {latestRunId ?? "none"}</span>
        <span>Terminal: {terminalId ? "connected" : "offline"}</span>
      </footer>
    </div>
  );
}
