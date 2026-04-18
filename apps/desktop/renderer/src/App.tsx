import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";

import type { FileNode, OpenTab } from "@core-types/index";

import { EditorPane } from "./editor/EditorPane";
import { FileExplorer } from "./explorer/FileExplorer";
import { CommandBar } from "./layout/CommandBar";
import { QuickOpenPalette } from "./layout/QuickOpenPalette";
import type { QuickOpenItem } from "./layout/QuickOpenPalette";
import { InspectorPanel } from "./panels/InspectorPanel";
import { TerminalPanel } from "./terminal/TerminalPanel";
import { XtermViewport } from "./terminal/XtermViewport";
import { NotebookWorkspace } from "./workbench/NotebookWorkspace";
import { WorkflowWorkspace } from "./workbench/WorkflowWorkspace";

type ActivityView = "explorer" | "workflows";
type BottomView = "terminal" | "events";
type ThemePreset = "aurora" | "graphite" | "ember";
type LayoutPreset = "balanced" | "focus" | "analysis" | "wide";
type DragTarget = "left" | "right" | "bottom";
type CenterMode = "notebook" | "script" | "workflow";

type DragState = {
  target: DragTarget;
  startX: number;
  startY: number;
  startLeft: number;
  startRight: number;
  startBottom: number;
};

type TerminalChunk = {
  seq: number;
  data: string;
};

type PythonExecutionResult = {
  stdout: string;
  stderr: string;
  error: string | null;
  variables: Array<{ name: string; type: string; preview: string; shape?: string; dtype?: string }>;
  dataframes: Array<{
    name: string;
    columns: string[];
    rows: Array<Record<string, unknown>>;
    row_count: number;
  }>;
  plots: string[];
  html_outputs: string[];
};

type ScriptCell = {
  index: number;
  title: string;
  code: string;
};

const STORAGE_THEME_KEY = "envoy-ui-theme";
const STORAGE_LAYOUT_KEY = "envoy-ui-layout";
const STORAGE_FAVORITES_KEY = "envoy-ui-favorites";
const STORAGE_RECENT_KEY = "envoy-ui-recent";

const WORKFLOW_OPTIONS = [
  { id: "evaluation", label: "Evaluation" },
  { id: "export", label: "Export" },
  { id: "simulation", label: "Simulation" },
  { id: "inspection", label: "Inspection" },
] as const;

function readStoredArray(key: string): string[] {
  const value = window.localStorage.getItem(key);
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

function collectFilePaths(nodes: FileNode[]): string[] {
  const result: string[] = [];

  function visit(list: FileNode[]) {
    list.forEach((node) => {
      if (node.type === "file") {
        result.push(node.path);
      } else {
        visit(node.children ?? []);
      }
    });
  }

  visit(nodes);
  return result;
}

function nextThemePreset(theme: ThemePreset): ThemePreset {
  if (theme === "aurora") {
    return "graphite";
  }
  if (theme === "graphite") {
    return "ember";
  }
  return "aurora";
}

function inferModeFromPath(filePath: string | null): CenterMode {
  if (!filePath) {
    return "script";
  }

  const lower = filePath.toLowerCase();
  if (lower.endsWith(".ipynb")) {
    return "notebook";
  }
  return "script";
}

function parseScriptCells(source: string): ScriptCell[] {
  const lines = source.split("\n");
  const markerIndexes: number[] = [];

  lines.forEach((line, index) => {
    if (line.trim().startsWith("# %%")) {
      markerIndexes.push(index);
    }
  });

  if (markerIndexes.length === 0) {
    return [
      {
        index: 1,
        title: "Cell 1",
        code: source,
      },
    ];
  }

  const cells: ScriptCell[] = [];
  markerIndexes.forEach((startIndex, markerPosition) => {
    const endIndex = markerIndexes[markerPosition + 1] ?? lines.length;
    const markerLine = lines[startIndex]?.trim() ?? "# %%";
    const title = markerLine.replace("# %%", "").trim() || `Cell ${markerPosition + 1}`;
    const code = lines.slice(startIndex + 1, endIndex).join("\n");
    cells.push({
      index: markerPosition + 1,
      title,
      code,
    });
  });

  return cells;
}

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
  const [latestTerminalChunk, setLatestTerminalChunk] = useState<TerminalChunk>({ seq: 0, data: "" });
  const [latestRunId, setLatestRunId] = useState<string | null>(null);
  const [commandInput, setCommandInput] = useState("python3 -V");
  const [terminalId, setTerminalId] = useState<string | null>(null);
  const [activityView, setActivityView] = useState<ActivityView>("explorer");
  const [bottomView, setBottomView] = useState<BottomView>("terminal");
  const [centerMode, setCenterMode] = useState<CenterMode>("script");
  const [latestExecution, setLatestExecution] = useState<PythonExecutionResult | null>(null);
  const [theme, setTheme] = useState<ThemePreset>(() => {
    const stored = window.localStorage.getItem(STORAGE_THEME_KEY);
    if (stored === "graphite" || stored === "ember" || stored === "aurora") {
      return stored;
    }
    return "aurora";
  });
  const [layoutPreset, setLayoutPreset] = useState<LayoutPreset>(() => {
    const stored = window.localStorage.getItem(STORAGE_LAYOUT_KEY);
    if (stored === "balanced" || stored === "focus" || stored === "analysis" || stored === "wide") {
      return stored;
    }
    return "balanced";
  });
  const [favorites, setFavorites] = useState<string[]>(() => readStoredArray(STORAGE_FAVORITES_KEY));
  const [recentFiles, setRecentFiles] = useState<string[]>(() => readStoredArray(STORAGE_RECENT_KEY));
  const [isQuickOpenVisible, setIsQuickOpenVisible] = useState(false);
  const [quickOpenQuery, setQuickOpenQuery] = useState("");
  const [leftPaneWidth, setLeftPaneWidth] = useState(280);
  const [rightPaneWidth, setRightPaneWidth] = useState(300);
  const [bottomPaneHeight, setBottomPaneHeight] = useState(270);
  const [dragState, setDragState] = useState<DragState | null>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(STORAGE_THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_FAVORITES_KEY, JSON.stringify(favorites));
  }, [favorites]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_RECENT_KEY, JSON.stringify(recentFiles));
  }, [recentFiles]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_LAYOUT_KEY, layoutPreset);

    if (layoutPreset === "focus") {
      setLeftPaneWidth(240);
      setRightPaneWidth(250);
      setBottomPaneHeight(220);
      return;
    }

    if (layoutPreset === "analysis") {
      setLeftPaneWidth(320);
      setRightPaneWidth(360);
      setBottomPaneHeight(320);
      return;
    }

    if (layoutPreset === "wide") {
      setLeftPaneWidth(360);
      setRightPaneWidth(280);
      setBottomPaneHeight(260);
      return;
    }

    setLeftPaneWidth(280);
    setRightPaneWidth(300);
    setBottomPaneHeight(270);
  }, [layoutPreset]);

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
        const chunk = payload.data ?? "";
        setLatestTerminalChunk((prev) => ({ seq: prev.seq + 1, data: chunk }));

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
        setTerminalId(null);
      }

      if (payload.type === "error") {
        setTerminalLogs((prev) => [...prev.slice(-600), `Terminal error: ${payload.data ?? "unknown"}`]);
      }
    });

    return () => {
      disposeTerminal();
    };
  }, [terminalId]);

  useEffect(() => {
    if (!dragState) {
      return;
    }

    const onMove = (event: MouseEvent) => {
      if (dragState.target === "left") {
        const deltaX = event.clientX - dragState.startX;
        setLeftPaneWidth(Math.min(420, Math.max(220, dragState.startLeft + deltaX)));
      }

      if (dragState.target === "right") {
        const deltaX = event.clientX - dragState.startX;
        setRightPaneWidth(Math.min(460, Math.max(240, dragState.startRight - deltaX)));
      }

      if (dragState.target === "bottom") {
        const deltaY = event.clientY - dragState.startY;
        setBottomPaneHeight(Math.min(460, Math.max(180, dragState.startBottom - deltaY)));
      }
    };

    const onUp = () => {
      setDragState(null);
    };

    document.body.style.userSelect = "none";
    document.body.style.cursor = dragState.target === "bottom" ? "row-resize" : "col-resize";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);

    return () => {
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragState]);

  useEffect(() => {
    if (centerMode === "workflow") {
      return;
    }
    setCenterMode(inferModeFromPath(activePath));
  }, [activePath]);

  const openTabs = useMemo(
    () => tabOrder.map((path) => tabs[path]).filter((tab): tab is OpenTab => Boolean(tab)),
    [tabOrder, tabs],
  );
  const activeTab = useMemo(() => {
    if (!activePath) {
      return null;
    }
    return tabs[activePath] ?? null;
  }, [activePath, tabs]);
  const scriptCells = useMemo(
    () => parseScriptCells(activeTab?.content ?? ""),
    [activeTab?.content],
  );
  const allProjectFiles = useMemo(() => collectFilePaths(tree), [tree]);
  const filePathSet = useMemo(() => new Set(allProjectFiles), [allProjectFiles]);
  const visibleFavorites = useMemo(
    () => favorites.filter((path) => filePathSet.has(path)),
    [favorites, filePathSet],
  );
  const visibleRecentFiles = useMemo(
    () => recentFiles.filter((path) => filePathSet.has(path)),
    [recentFiles, filePathSet],
  );

  const quickOpenItems = useMemo(() => {
    const normalizedQuery = quickOpenQuery.trim().toLowerCase();

    const actions: QuickOpenItem[] = [
      {
        id: "action:open-project",
        kind: "action",
        label: "Open Project",
        description: "Select a folder for this workspace",
      },
      {
        id: "action:workflow-evaluation",
        kind: "action",
        label: "Run Evaluation Workflow",
      },
      {
        id: "action:workflow-export",
        kind: "action",
        label: "Run Export Workflow",
      },
      {
        id: "action:workflow-simulation",
        kind: "action",
        label: "Run Simulation Workflow",
      },
      {
        id: "action:workflow-inspection",
        kind: "action",
        label: "Run Inspection Workflow",
      },
      {
        id: "action:focus-explorer",
        kind: "action",
        label: "Focus Explorer",
      },
      {
        id: "action:focus-workflows",
        kind: "action",
        label: "Focus Workflow Studio",
      },
      {
        id: "action:bottom-terminal",
        kind: "action",
        label: "Show Terminal Panel",
      },
      {
        id: "action:bottom-events",
        kind: "action",
        label: "Show Runtime Events Panel",
      },
      {
        id: "action:cycle-theme",
        kind: "action",
        label: "Cycle Theme Preset",
      },
      {
        id: "action:cycle-layout",
        kind: "action",
        label: "Cycle Layout Preset",
      },
      {
        id: "action:mode-notebook",
        kind: "action",
        label: "Switch to Notebook Mode",
      },
      {
        id: "action:mode-script",
        kind: "action",
        label: "Switch to Script Mode",
      },
      {
        id: "action:mode-workflow",
        kind: "action",
        label: "Switch to Workflow Mode",
      },
      {
        id: "action:run-tests",
        kind: "action",
        label: "Run Python Tests",
      },
    ];

    const actionResults = actions.filter((item) => {
      if (normalizedQuery.length === 0) {
        return true;
      }
      return (
        item.label.toLowerCase().includes(normalizedQuery) ||
        (item.description ?? "").toLowerCase().includes(normalizedQuery)
      );
    });

    const recentPriority = [...visibleRecentFiles, ...allProjectFiles.filter((path) => !visibleRecentFiles.includes(path))];

    const fileResults = recentPriority
      .filter((path) => {
        if (normalizedQuery.length === 0) {
          return true;
        }
        const name = path.split(/[\\/]/).pop()?.toLowerCase() ?? "";
        return name.includes(normalizedQuery) || path.toLowerCase().includes(normalizedQuery);
      })
      .slice(0, 180)
      .map((path) => ({
        id: `file:${path}`,
        kind: "file" as const,
        label: path.split(/[\\/]/).pop() ?? path,
        description: path,
        path,
      }));

    return [...actionResults.slice(0, 30), ...fileResults].slice(0, 220);
  }, [allProjectFiles, quickOpenQuery, visibleRecentFiles]);

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

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "p") {
        event.preventDefault();
        setQuickOpenQuery("");
        setIsQuickOpenVisible(true);
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
    setRecentFiles((prev) => [path, ...prev.filter((item) => item !== path)].slice(0, 30));
  }

  function toggleFavorite(path: string) {
    setFavorites((prev) => {
      if (prev.includes(path)) {
        return prev.filter((item) => item !== path);
      }
      return [path, ...prev].slice(0, 60);
    });
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

  async function runProjectCommand(rawCommand: string) {
    if (!projectRoot) {
      setRuntimeLogs((prev) => [...prev.slice(-300), "Open a project first."]);
      return;
    }

    const parts = rawCommand.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) {
      return;
    }

    const runId = await window.envoy.runCommand(projectRoot, parts[0], parts.slice(1));
    setLatestRunId(runId);
    setRuntimeLogs((prev) => [...prev.slice(-300), `Command started: ${rawCommand} (${runId})`]);
  }

  async function executePythonSnippet(code: string): Promise<PythonExecutionResult | null> {
    if (!projectRoot) {
      setRuntimeLogs((prev) => [...prev.slice(-300), "Open a project first."]);
      return null;
    }

    const result = await window.envoy.executePython(projectRoot, code);
    setLatestExecution(result);

    if (result.error) {
      setRuntimeLogs((prev) => [...prev.slice(-300), `Python execution error: ${result.error}`]);
    } else {
      const vars = result.variables.length;
      const frames = result.dataframes.length;
      setRuntimeLogs((prev) => [...prev.slice(-300), `Python execution completed (${vars} vars, ${frames} dataframes).`]);
    }

    return result;
  }

  const sendTerminalInput = useCallback(async (data: string) => {
    if (!terminalId) {
      setTerminalLogs((prev) => [...prev.slice(-600), "Terminal is not initialized."]);
      return;
    }

    if (!data) {
      return;
    }

    await window.envoy.writeTerminal(terminalId, data);
  }, [terminalId]);

  const resizeTerminal = useCallback(
    async (cols: number, rows: number) => {
      if (!terminalId) {
        return;
      }
      await window.envoy.resizeTerminal(terminalId, cols, rows);
    },
    [terminalId],
  );

  const stopTerminal = useCallback(async () => {
    if (!terminalId) {
      return;
    }
    await window.envoy.killTerminal(terminalId);
    setTerminalId(null);
    setTerminalLogs((prev) => [...prev.slice(-600), "Terminal stopped."]);
  }, [terminalId]);

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

  function runQuickAction(actionId: string) {
    switch (actionId) {
      case "action:open-project":
        void handleOpenFolder();
        break;
      case "action:workflow-evaluation":
        void runWorkflow("evaluation");
        break;
      case "action:workflow-export":
        void runWorkflow("export");
        break;
      case "action:workflow-simulation":
        void runWorkflow("simulation");
        break;
      case "action:workflow-inspection":
        void runWorkflow("inspection");
        break;
      case "action:focus-explorer":
        setActivityView("explorer");
        break;
      case "action:focus-workflows":
        setActivityView("workflows");
        break;
      case "action:bottom-terminal":
        setBottomView("terminal");
        break;
      case "action:bottom-events":
        setBottomView("events");
        break;
      case "action:cycle-theme":
        setTheme((prev) => nextThemePreset(prev));
        break;
      case "action:cycle-layout":
        setLayoutPreset((prev) => {
          if (prev === "balanced") {
            return "focus";
          }
          if (prev === "focus") {
            return "analysis";
          }
          if (prev === "analysis") {
            return "wide";
          }
          return "balanced";
        });
        break;
      case "action:mode-notebook":
        setCenterMode("notebook");
        break;
      case "action:mode-script":
        setCenterMode("script");
        break;
      case "action:mode-workflow":
        setCenterMode("workflow");
        break;
      case "action:run-tests":
        void runProjectCommand("python3 -m pytest -q");
        break;
      default:
        break;
    }
  }

  function handleQuickOpenChoose(item: QuickOpenItem) {
    if (item.kind === "file" && item.path) {
      void handleOpenFile(item.path);
    }

    if (item.kind === "action") {
      runQuickAction(item.id);
    }

    setIsQuickOpenVisible(false);
  }

  function startDrag(event: ReactMouseEvent, target: DragTarget) {
    event.preventDefault();
    setDragState({
      target,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: leftPaneWidth,
      startRight: rightPaneWidth,
      startBottom: bottomPaneHeight,
    });
  }

  const activeFileName = activePath?.split(/[\\/]/).pop() ?? "No file";
  const projectName = projectRoot?.split(/[\\/]/).filter(Boolean).pop() ?? "No project";

  const ideLayoutStyle = {
    "--left-pane-width": `${leftPaneWidth}px`,
    "--right-pane-width": `${rightPaneWidth}px`,
  } as CSSProperties;

  const centerLayoutStyle = {
    "--bottom-pane-height": `${bottomPaneHeight}px`,
  } as CSSProperties;

  return (
    <div className="app-shell">
      <CommandBar
        onOpenFolder={handleOpenFolder}
        onRunCommand={runCustomCommand}
        onWorkflow={runWorkflow}
        commandInput={commandInput}
        setCommandInput={setCommandInput}
        projectRoot={projectRoot}
        theme={theme}
        setTheme={(value) => {
          if (value === "aurora" || value === "graphite" || value === "ember") {
            setTheme(value);
          }
        }}
        layoutPreset={layoutPreset}
        setLayoutPreset={(value) => {
          if (value === "balanced" || value === "focus" || value === "analysis" || value === "wide") {
            setLayoutPreset(value);
          }
        }}
      />

      <div className="ide-body" style={ideLayoutStyle}>
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
            <FileExplorer
              nodes={tree}
              onOpenFile={handleOpenFile}
              activePath={activePath}
              favorites={visibleFavorites}
              recentFiles={visibleRecentFiles}
              onToggleFavorite={toggleFavorite}
              onClearRecent={() => setRecentFiles([])}
            />
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

        <div
          className="pane-splitter vertical"
          onMouseDown={(event) => {
            startDrag(event, "left");
          }}
        />

        <main className="center-pane" style={centerLayoutStyle}>
          <section className="panel center-mode-panel glass-panel">
            <div className="center-mode-tabs">
              <button
                className={centerMode === "notebook" ? "active" : ""}
                onClick={() => setCenterMode("notebook")}
              >
                Notebook
              </button>
              <button
                className={centerMode === "script" ? "active" : ""}
                onClick={() => setCenterMode("script")}
              >
                Script
              </button>
              <button
                className={centerMode === "workflow" ? "active" : ""}
                onClick={() => setCenterMode("workflow")}
              >
                Workflow
              </button>
            </div>

            {centerMode === "workflow" ? (
              <WorkflowWorkspace onRunWorkflow={runWorkflow} />
            ) : null}

            {centerMode === "notebook" ? (
              <NotebookWorkspace
                tab={activeTab}
                onNotebookChange={handleEditorChange}
                onSave={() => {
                  void saveActiveFile();
                }}
                onExecuteCode={executePythonSnippet}
              />
            ) : null}

            {centerMode === "script" ? (
              <div className="script-workspace-stack">
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

                <section className="panel script-cells-panel glass-panel">
                  <div className="workspace-heading-row">
                    <div>
                      <h3 className="panel-title">Script Productivity</h3>
                      <p className="workspace-subtitle">
                        IntelliSense active in Monaco. Use # %% for cell-based execution in .py files.
                      </p>
                    </div>
                    <div className="workspace-actions">
                      <button
                        onClick={() => {
                          if (activeTab) {
                            void executePythonSnippet(activeTab.content);
                          }
                        }}
                        disabled={!activeTab}
                      >
                        Run File
                      </button>
                      <button onClick={() => void runProjectCommand("python3 -m pytest -q")}>Run Tests</button>
                      <button
                        onClick={() => {
                          if (activePath) {
                            void runProjectCommand(`python3 -m pdb ${activePath}`);
                          }
                        }}
                        disabled={!activePath}
                      >
                        Debug
                      </button>
                    </div>
                  </div>

                  <div className="script-cell-list">
                    {scriptCells.map((cell) => (
                      <article key={`script-cell-${cell.index}`} className="script-cell-card">
                        <h4>
                          Cell {cell.index}: {cell.title}
                        </h4>
                        <pre>{cell.code.trim() || "(empty cell)"}</pre>
                        <button onClick={() => void executePythonSnippet(cell.code)}>Run Cell</button>
                      </article>
                    ))}
                  </div>
                </section>
              </div>
            ) : null}
          </section>

          <div
            className="pane-splitter horizontal"
            onMouseDown={(event) => {
              startDrag(event, "bottom");
            }}
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
            {bottomView === "terminal" ? (
              <XtermViewport
                terminalId={terminalId}
                latestChunk={latestTerminalChunk}
                onWrite={sendTerminalInput}
                onResize={resizeTerminal}
                onStop={stopTerminal}
              />
            ) : (
              <TerminalPanel title="Runtime Events" logs={runtimeLogs} />
            )}
          </section>
        </main>

        <div
          className="pane-splitter vertical"
          onMouseDown={(event) => {
            startDrag(event, "right");
          }}
        />

        <InspectorPanel
          projectRoot={projectRoot}
          activeFilePath={activePath}
          latestRunId={latestRunId}
          variables={latestExecution?.variables ?? []}
          dataframes={latestExecution?.dataframes ?? []}
        />
      </div>

      <footer className="status-bar glass-panel">
        <span>Project: {projectName}</span>
        <span>File: {activeFileName}</span>
        <span>Run: {latestRunId ?? "none"}</span>
        <span>Terminal: {terminalId ? "connected" : "offline"}</span>
      </footer>

      <QuickOpenPalette
        open={isQuickOpenVisible}
        query={quickOpenQuery}
        setQuery={setQuickOpenQuery}
        items={quickOpenItems}
        onClose={() => setIsQuickOpenVisible(false)}
        onChoose={handleQuickOpenChoose}
      />
    </div>
  );
}
