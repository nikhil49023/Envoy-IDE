import { useEffect, useMemo, useState } from "react";

import type { OpenTab } from "@core-types/index";

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

type NotebookOutput =
  | { kind: "text"; value: string }
  | { kind: "error"; value: string }
  | { kind: "image"; value: string }
  | { kind: "html"; value: string };

type NotebookCell = {
  id: string;
  cellType: "code" | "markdown";
  source: string;
  outputs: NotebookOutput[];
};

type NotebookWorkspaceProps = {
  tab: OpenTab | null;
  onNotebookChange: (content: string) => void;
  onSave: () => void;
  onExecuteCode: (code: string) => Promise<PythonExecutionResult | null>;
};

function toLines(text: string): string[] {
  return text.split("\n").map((line) => `${line}\n`);
}

function parseNotebookContent(content: string): NotebookCell[] {
  try {
    const parsed = JSON.parse(content) as { cells?: Array<Record<string, unknown>> };
    const rawCells = Array.isArray(parsed.cells) ? parsed.cells : [];

    if (rawCells.length === 0) {
      return [
        {
          id: crypto.randomUUID(),
          cellType: "markdown",
          source: "# Notebook\nDocument your experiment here.",
          outputs: [],
        },
        {
          id: crypto.randomUUID(),
          cellType: "code",
          source: "print('hello notebook')",
          outputs: [],
        },
      ];
    }

    return rawCells.map((cell, index) => {
      const cellType = cell.cell_type === "markdown" ? "markdown" : "code";
      const sourceRaw = cell.source;
      const source = Array.isArray(sourceRaw)
        ? sourceRaw.join("")
        : typeof sourceRaw === "string"
          ? sourceRaw
          : "";

      const outputsRaw = Array.isArray(cell.outputs) ? cell.outputs : [];
      const outputs: NotebookOutput[] = [];
      outputsRaw.forEach((output) => {
        if (!output || typeof output !== "object") {
          return;
        }
        const typed = output as Record<string, unknown>;
        const outputType = typed.output_type;
        if (outputType === "stream") {
          const text = Array.isArray(typed.text)
            ? typed.text.join("")
            : typeof typed.text === "string"
              ? typed.text
              : "";
          if (text) {
            outputs.push({ kind: "text", value: text });
          }
          return;
        }

        const data = (typed.data ?? {}) as Record<string, unknown>;
        const textPlain = data["text/plain"];
        if (typeof textPlain === "string") {
          outputs.push({ kind: "text", value: textPlain });
        } else if (Array.isArray(textPlain)) {
          outputs.push({ kind: "text", value: textPlain.join("") });
        }

        const html = data["text/html"];
        if (typeof html === "string") {
          outputs.push({ kind: "html", value: html });
        } else if (Array.isArray(html)) {
          outputs.push({ kind: "html", value: html.join("") });
        }

        const png = data["image/png"];
        if (typeof png === "string") {
          outputs.push({ kind: "image", value: png });
        }
      });

      return {
        id:
          ((cell.metadata as { id?: string } | undefined)?.id ??
            `cell-${index + 1}-${Math.random().toString(16).slice(2, 8)}`) as string,
        cellType,
        source,
        outputs,
      };
    });
  } catch {
    return [
      {
        id: crypto.randomUUID(),
        cellType: "markdown",
        source: "# Notebook\n",
        outputs: [],
      },
      {
        id: crypto.randomUUID(),
        cellType: "code",
        source: content,
        outputs: [],
      },
    ];
  }
}

function serializeNotebook(cells: NotebookCell[]): string {
  const serialized = {
    cells: cells.map((cell) => {
      const outputs =
        cell.cellType === "code"
          ? cell.outputs.map((output) => {
              if (output.kind === "text") {
                return {
                  output_type: "stream",
                  name: "stdout",
                  text: toLines(output.value),
                };
              }

              if (output.kind === "error") {
                return {
                  output_type: "stream",
                  name: "stderr",
                  text: toLines(output.value),
                };
              }

              if (output.kind === "image") {
                return {
                  output_type: "display_data",
                  data: {
                    "image/png": output.value,
                  },
                };
              }

              return {
                output_type: "display_data",
                data: {
                  "text/html": output.value,
                },
              };
            })
          : [];

      return {
        cell_type: cell.cellType,
        metadata: {
          language: cell.cellType === "code" ? "python" : "markdown",
        },
        source: toLines(cell.source),
        outputs,
      };
    }),
    metadata: {
      kernelspec: {
        name: "python3",
        display_name: "Python 3",
      },
      language_info: {
        name: "python",
      },
    },
    nbformat: 4,
    nbformat_minor: 5,
  };

  return `${JSON.stringify(serialized, null, 2)}\n`;
}

export function NotebookWorkspace({
  tab,
  onNotebookChange,
  onSave,
  onExecuteCode,
}: NotebookWorkspaceProps) {
  const [cells, setCells] = useState<NotebookCell[]>([]);

  useEffect(() => {
    if (!tab) {
      setCells([]);
      return;
    }
    setCells(parseNotebookContent(tab.content));
  }, [tab?.path]);

  const notebookTitle = useMemo(() => {
    if (!tab) {
      return "Notebook";
    }
    return tab.path.split(/[\\/]/).pop() ?? tab.path;
  }, [tab]);

  useEffect(() => {
    if (!tab || cells.length === 0) {
      return;
    }
    onNotebookChange(serializeNotebook(cells));
  }, [cells, onNotebookChange, tab]);

  if (!tab) {
    return (
      <section className="panel notebook-workspace glass-panel">
        <div className="empty-state">Open a .ipynb file to start notebook exploration.</div>
      </section>
    );
  }

  function updateCell(id: string, patch: Partial<NotebookCell>) {
    setCells((prev) => prev.map((cell) => (cell.id === id ? { ...cell, ...patch } : cell)));
  }

  function addCell(cellType: "code" | "markdown") {
    setCells((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        cellType,
        source: cellType === "code" ? "" : "## Notes",
        outputs: [],
      },
    ]);
  }

  function removeCell(id: string) {
    setCells((prev) => prev.filter((cell) => cell.id !== id));
  }

  async function runCodeCell(id: string) {
    const cell = cells.find((entry) => entry.id === id);
    if (!cell || cell.cellType !== "code") {
      return;
    }

    const result = await onExecuteCode(cell.source);
    if (!result) {
      return;
    }

    const outputs: NotebookOutput[] = [];
    if (result.stdout.trim()) {
      outputs.push({ kind: "text", value: result.stdout.trimEnd() });
    }
    if (result.stderr.trim()) {
      outputs.push({ kind: "error", value: result.stderr.trimEnd() });
    }
    if (result.error) {
      outputs.push({ kind: "error", value: result.error });
    }
    result.plots.forEach((plot) => outputs.push({ kind: "image", value: plot }));
    result.html_outputs.forEach((html) => outputs.push({ kind: "html", value: html }));

    updateCell(id, { outputs });
  }

  async function runAllCodeCells() {
    for (const cell of cells) {
      if (cell.cellType === "code") {
        // eslint-disable-next-line no-await-in-loop
        await runCodeCell(cell.id);
      }
    }
  }

  return (
    <section className="panel notebook-workspace glass-panel">
      <div className="workspace-heading-row">
        <div>
          <h3 className="panel-title">Notebook Mode</h3>
          <p className="workspace-subtitle">{notebookTitle}</p>
        </div>
        <div className="workspace-actions">
          <button onClick={() => addCell("markdown")}>Add Markdown</button>
          <button onClick={() => addCell("code")}>Add Code</button>
          <button onClick={() => void runAllCodeCells()}>Run All</button>
          <button onClick={onSave}>Save Notebook</button>
        </div>
      </div>

      <div className="notebook-cells">
        {cells.map((cell, index) => (
          <article key={cell.id} className="notebook-cell">
            <div className="notebook-cell-toolbar">
              <span>
                Cell {index + 1} - {cell.cellType.toUpperCase()}
              </span>
              <div>
                {cell.cellType === "code" ? (
                  <button onClick={() => void runCodeCell(cell.id)}>Run</button>
                ) : null}
                <button onClick={() => removeCell(cell.id)}>Delete</button>
              </div>
            </div>

            <textarea
              className={`notebook-editor ${cell.cellType}`}
              value={cell.source}
              onChange={(event) => updateCell(cell.id, { source: event.target.value })}
              placeholder={cell.cellType === "code" ? "Write Python code..." : "Write markdown notes..."}
            />

            {cell.outputs.length > 0 ? (
              <div className="notebook-output">
                {cell.outputs.map((output, outputIndex) => {
                  if (output.kind === "image") {
                    return (
                      <img
                        key={`${cell.id}-out-${outputIndex}`}
                        src={`data:image/png;base64,${output.value}`}
                        className="notebook-image"
                        alt="Cell plot output"
                      />
                    );
                  }
                  if (output.kind === "html") {
                    return (
                      <div
                        // notebook html output, including widget-like rich repr
                        key={`${cell.id}-out-${outputIndex}`}
                        className="notebook-html-output"
                        dangerouslySetInnerHTML={{ __html: output.value }}
                      />
                    );
                  }

                  return (
                    <pre
                      key={`${cell.id}-out-${outputIndex}`}
                      className={`notebook-text-output ${output.kind === "error" ? "error" : ""}`.trim()}
                    >
                      {output.value}
                    </pre>
                  );
                })}
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}
