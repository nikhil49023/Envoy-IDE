import Editor from "@monaco-editor/react";

import type { OpenTab } from "@core-types/index";

type EditorPaneProps = {
  tab: OpenTab | null;
  onChange: (value: string) => void;
};

export function EditorPane({ tab, onChange }: EditorPaneProps) {
  if (!tab) {
    return (
      <section className="panel editor-panel">
        <h3>Editor</h3>
        <div className="empty-state">Open a file to start editing.</div>
      </section>
    );
  }

  return (
    <section className="panel editor-panel">
      <h3>{tab.path}</h3>
      <Editor
        height="100%"
        defaultLanguage="python"
        value={tab.content}
        onChange={(value) => onChange(value ?? "")}
        options={{
          minimap: { enabled: false },
          fontSize: 14,
          smoothScrolling: true,
          automaticLayout: true,
        }}
      />
    </section>
  );
}
