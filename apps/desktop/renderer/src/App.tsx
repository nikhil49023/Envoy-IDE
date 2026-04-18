import { useEffect, useMemo, useState } from "react";

import type { FileNode, OpenTab } from "@core-types/index";

import { EditorPane } from "./editor/EditorPane";
import { FileExplorer } from "./explorer/FileExplorer";
import { CommandBar } from "./layout/CommandBar";
import { InspectorPanel } from "./panels/InspectorPanel";
import { TerminalPanel } from "./terminal/TerminalPanel";

export function App() {
  const [projectRoot, setProjectRoot] = useState<string | null>(null);
  const [tree, setTree] = useState<FileNode[]>([]);
  const [tabs, setTabs] = useState<Record<string, OpenTab>>({});
  const [activePath, setActivePath] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([
    "Envoy IDE ready.",
    "Open a project and start running workflows.",
  ]);
  const [latestRunId, setLatestRunId] = useState<string | null>(null);
  const [commandInput, setCommandInput] = useState("python3 -V");

  useEffect(() => {
    const dispose = window.envoy.onRuntimeEvent((payload) => {
      const line = JSON.stringify(payload);
      setLogs((prev) => [...prev.slice(-300), line]);
      const runId = payload.run_id;
      if (typeof runId === "string") {
        setLatestRunId(runId);
      }
    });

    return () => {
      dispose();
    };
  }, []);

  const activeTab = useMemo(() => {
    if (!activePath) {
      return null;
    }
    return tabs[activePath] ?? null;
  }, [activePath, tabs]);

  async function handleOpenFolder() {
    const folder = await window.envoy.openFolder();
    if (!folder) {
      return;
    }
    setProjectRoot(folder);
    const nodes = await window.envoy.listTree(folder);
    setTree(nodes);
    setLogs((prev) => [...prev, `Opened folder: ${folder}`]);
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
      setLogs((prev) => [...prev, "Open a project first."]);
      return;
    }
    const runId = await window.envoy.runWorkflow(projectRoot, workflow, {
      active_file: activePath,
    });
    setLatestRunId(runId);
    setLogs((prev) => [...prev, `Workflow started: ${workflow} (${runId})`]);
  }

  async function runCustomCommand() {
    if (!projectRoot) {
      setLogs((prev) => [...prev, "Open a project first."]);
      return;
    }
    const parts = commandInput.trim().split(/\s+/);
    const command = parts[0];
    const args = parts.slice(1);
    const runId = await window.envoy.runCommand(projectRoot, command, args);
    setLatestRunId(runId);
    setLogs((prev) => [...prev, `Command started: ${commandInput} (${runId})`]);
  }

  return (
    <div className="app-shell">
      <CommandBar
        onOpenFolder={handleOpenFolder}
        onRunCommand={runCustomCommand}
        onWorkflow={runWorkflow}
        commandInput={commandInput}
        setCommandInput={setCommandInput}
      />

      <div className="workspace-grid">
        <FileExplorer nodes={tree} onOpenFile={handleOpenFile} />
        <EditorPane tab={activeTab} onChange={handleEditorChange} />
        <InspectorPanel
          projectRoot={projectRoot}
          activeFilePath={activePath}
          latestRunId={latestRunId}
        />
      </div>

      <TerminalPanel logs={logs} />
    </div>
  );
}
