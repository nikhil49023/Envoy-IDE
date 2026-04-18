import Editor from "@monaco-editor/react";

import type { OpenTab } from "@core-types/index";

type EditorPaneProps = {
  tabs: OpenTab[];
  activePath: string | null;
  onActivateTab: (path: string) => void;
  onCloseTab: (path: string) => void;
  onSave: () => void;
  onChange: (value: string) => void;
};

function guessLanguage(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  if (extension === "ts" || extension === "tsx") {
    return "typescript";
  }
  if (extension === "js" || extension === "jsx") {
    return "javascript";
  }
  if (extension === "json") {
    return "json";
  }
  if (extension === "md") {
    return "markdown";
  }
  if (extension === "css") {
    return "css";
  }
  if (extension === "html") {
    return "html";
  }
  if (extension === "py") {
    return "python";
  }
  return "plaintext";
}

export function EditorPane({
  tabs,
  activePath,
  onActivateTab,
  onCloseTab,
  onSave,
  onChange,
}: EditorPaneProps) {
  const activeTab = tabs.find((tab) => tab.path === activePath) ?? null;

  if (!activeTab) {
    return (
      <section className="panel editor-panel glass-panel">
        <div className="editor-tabs empty">
          <span>No files open</span>
        </div>
        <div className="empty-state">Open a file to start editing.</div>
      </section>
    );
  }

  return (
    <section className="panel editor-panel glass-panel">
      <div className="editor-tabs">
        <div className="editor-tab-list">
          {tabs.map((tab) => (
            <button
              key={tab.path}
              className={`editor-tab ${tab.path === activePath ? "active" : ""}`.trim()}
              onClick={() => onActivateTab(tab.path)}
            >
              <span>{tab.path.split(/[\\/]/).pop() ?? tab.path}</span>
              {tab.dirty ? <span className="tab-dirty">*</span> : null}
              <span
                className="tab-close"
                role="button"
                tabIndex={0}
                onClick={(event) => {
                  event.stopPropagation();
                  onCloseTab(tab.path);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    event.stopPropagation();
                    onCloseTab(tab.path);
                  }
                }}
              >
                x
              </span>
            </button>
          ))}
        </div>
        <button className="save-button" onClick={onSave} disabled={!activeTab.dirty}>
          Save
        </button>
      </div>

      <Editor
        height="100%"
        language={guessLanguage(activeTab.path)}
        value={activeTab.content}
        onChange={(value) => onChange(value ?? "")}
        theme="vs-dark"
        options={{
          minimap: { enabled: false },
          fontSize: 14,
          smoothScrolling: true,
          automaticLayout: true,
          padding: { top: 12, bottom: 12 },
        }}
      />
    </section>
  );
}
