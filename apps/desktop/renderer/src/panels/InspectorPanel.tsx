import { useMemo, useState } from "react";

type InspectorPanelProps = {
  projectRoot: string | null;
  activeFilePath: string | null;
  latestRunId: string | null;
  variables: Array<{ name: string; type: string; preview: string; shape?: string; dtype?: string }>;
  dataframes: Array<{
    name: string;
    columns: string[];
    rows: Array<Record<string, unknown>>;
    row_count: number;
  }>;
};

export function InspectorPanel({
  projectRoot,
  activeFilePath,
  latestRunId,
  variables,
  dataframes,
}: InspectorPanelProps) {
  const [variableQuery, setVariableQuery] = useState("");
  const [dataframeFilter, setDataframeFilter] = useState("");

  const visibleVariables = useMemo(() => {
    const query = variableQuery.trim().toLowerCase();
    if (!query) {
      return variables;
    }
    return variables.filter((variable) => {
      return (
        variable.name.toLowerCase().includes(query) ||
        variable.type.toLowerCase().includes(query) ||
        variable.preview.toLowerCase().includes(query)
      );
    });
  }, [variableQuery, variables]);

  const activeFrame = dataframes[0] ?? null;

  const filteredRows = useMemo(() => {
    if (!activeFrame) {
      return [];
    }
    const query = dataframeFilter.trim().toLowerCase();
    if (!query) {
      return activeFrame.rows;
    }
    return activeFrame.rows.filter((row) => {
      return activeFrame.columns.some((column) => {
        const value = row[column];
        return String(value ?? "").toLowerCase().includes(query);
      });
    });
  }, [activeFrame, dataframeFilter]);

  return (
    <section className="panel inspector-panel glass-panel">
      <h3 className="panel-title">Inspector</h3>
      <div className="inspector-item">
        <label>Project Root</label>
        <p>{projectRoot ?? "Not opened"}</p>
      </div>
      <div className="inspector-item">
        <label>Active File</label>
        <p>{activeFilePath ?? "None"}</p>
      </div>
      <div className="inspector-item">
        <label>Latest Run</label>
        <p>{latestRunId ?? "No runs yet"}</p>
      </div>
      <div className="inspector-item">
        <label>Assistant Scope</label>
        <p>Error explanation, workflow suggestion, metrics summary, export guidance.</p>
      </div>

      <div className="inspector-item">
        <label>Variable Explorer</label>
        <input
          className="inspector-filter"
          placeholder="Filter variables"
          value={variableQuery}
          onChange={(event) => setVariableQuery(event.target.value)}
        />
        {visibleVariables.length === 0 ? (
          <p className="inspector-empty">No variables captured yet.</p>
        ) : (
          <div className="variable-table-wrap">
            <table className="variable-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Shape</th>
                </tr>
              </thead>
              <tbody>
                {visibleVariables.slice(0, 64).map((variable) => (
                  <tr key={`${variable.name}-${variable.type}`}>
                    <td>{variable.name}</td>
                    <td>{variable.type}</td>
                    <td>{variable.shape ?? variable.dtype ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="inspector-item">
        <label>Data Viewer</label>
        {activeFrame ? (
          <>
            <p className="inspector-meta">
              {activeFrame.name} - {activeFrame.row_count} rows
            </p>
            <input
              className="inspector-filter"
              placeholder="Filter dataframe rows"
              value={dataframeFilter}
              onChange={(event) => setDataframeFilter(event.target.value)}
            />
            <div className="dataframe-table-wrap">
              <table className="variable-table">
                <thead>
                  <tr>
                    {activeFrame.columns.slice(0, 8).map((column) => (
                      <th key={column}>{column}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.slice(0, 25).map((row, rowIndex) => (
                    <tr key={`${activeFrame.name}-${rowIndex}`}>
                      {activeFrame.columns.slice(0, 8).map((column) => (
                        <td key={`${rowIndex}-${column}`}>{String(row[column] ?? "")}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p className="inspector-empty">Run notebook/script cells to preview dataframes.</p>
        )}
      </div>
    </section>
  );
}
