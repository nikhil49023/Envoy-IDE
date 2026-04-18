import type { FileNode } from "@core-types/index";

type FileExplorerProps = {
  nodes: FileNode[];
  onOpenFile: (path: string) => void;
  activePath: string | null;
};

function TreeNode({
  node,
  onOpenFile,
  activePath,
}: {
  node: FileNode;
  onOpenFile: (path: string) => void;
  activePath: string | null;
}) {
  if (node.type === "file") {
    return (
      <li>
        <button
          className={`tree-file ${activePath === node.path ? "active" : ""}`.trim()}
          onClick={() => onOpenFile(node.path)}
        >
          {node.name}
        </button>
      </li>
    );
  }

  return (
    <li>
      <details open>
        <summary>{node.name}</summary>
        <ul className="tree-list">
          {(node.children ?? []).map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              onOpenFile={onOpenFile}
              activePath={activePath}
            />
          ))}
        </ul>
      </details>
    </li>
  );
}

export function FileExplorer({ nodes, onOpenFile, activePath }: FileExplorerProps) {
  return (
    <section className="panel explorer-panel glass-panel">
      <h3 className="panel-title">Explorer</h3>
      <ul className="tree-list">
        {nodes.map((node) => (
          <TreeNode key={node.path} node={node} onOpenFile={onOpenFile} activePath={activePath} />
        ))}
      </ul>
    </section>
  );
}
