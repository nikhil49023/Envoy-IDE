import type { FileNode } from "@core-types/index";

type FileExplorerProps = {
  nodes: FileNode[];
  onOpenFile: (path: string) => void;
};

function TreeNode({ node, onOpenFile }: { node: FileNode; onOpenFile: (path: string) => void }) {
  if (node.type === "file") {
    return (
      <li>
        <button className="tree-file" onClick={() => onOpenFile(node.path)}>
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
            <TreeNode key={child.path} node={child} onOpenFile={onOpenFile} />
          ))}
        </ul>
      </details>
    </li>
  );
}

export function FileExplorer({ nodes, onOpenFile }: FileExplorerProps) {
  return (
    <section className="panel explorer-panel">
      <h3>Explorer</h3>
      <ul className="tree-list">
        {nodes.map((node) => (
          <TreeNode key={node.path} node={node} onOpenFile={onOpenFile} />
        ))}
      </ul>
    </section>
  );
}
