import { useEffect, useMemo, useState } from "react";

import type { FileNode } from "@core-types/index";

type FileExplorerProps = {
  nodes: FileNode[];
  onOpenFile: (path: string) => void;
  activePath: string | null;
};

function compareNodes(a: FileNode, b: FileNode): number {
  if (a.type !== b.type) {
    return a.type === "directory" ? -1 : 1;
  }
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

function extensionOf(fileName: string): string {
  const value = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (!value || value === fileName.toLowerCase()) {
    return "txt";
  }
  return value;
}

function fileKind(extension: string): string {
  if (["ts", "tsx", "js", "jsx", "py", "java", "go", "rs", "c", "cpp", "h"].includes(extension)) {
    return "code";
  }
  if (["json", "yaml", "yml", "toml", "ini", "xml", "env"].includes(extension)) {
    return "config";
  }
  if (["md", "txt", "rst", "log"].includes(extension)) {
    return "doc";
  }
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "ico"].includes(extension)) {
    return "media";
  }
  return "other";
}

function collectDirectoryPaths(nodes: FileNode[]): string[] {
  const result: string[] = [];

  function visit(list: FileNode[]) {
    list.forEach((node) => {
      if (node.type === "directory") {
        result.push(node.path);
        visit(node.children ?? []);
      }
    });
  }

  visit(nodes);
  return result;
}

function countNodes(nodes: FileNode[]): { folders: number; files: number } {
  let folders = 0;
  let files = 0;

  function visit(list: FileNode[]) {
    list.forEach((node) => {
      if (node.type === "directory") {
        folders += 1;
        visit(node.children ?? []);
      } else {
        files += 1;
      }
    });
  }

  visit(nodes);
  return { folders, files };
}

function filterTree(nodes: FileNode[], query: string, showHidden: boolean): FileNode[] {
  const normalizedQuery = query.trim().toLowerCase();

  function matches(name: string): boolean {
    return normalizedQuery.length === 0 || name.toLowerCase().includes(normalizedQuery);
  }

  function transform(list: FileNode[]): FileNode[] {
    const next: FileNode[] = [];

    list.forEach((node) => {
      if (!showHidden && node.name.startsWith(".")) {
        return;
      }

      if (node.type === "file") {
        if (matches(node.name)) {
          next.push(node);
        }
        return;
      }

      const children = transform(node.children ?? []);
      if (matches(node.name) || children.length > 0 || normalizedQuery.length === 0) {
        next.push({ ...node, children });
      }
    });

    return next.sort(compareNodes);
  }

  return transform(nodes);
}

function TreeNode({
  node,
  onOpenFile,
  activePath,
  expanded,
  onToggle,
  query,
}: {
  node: FileNode;
  onOpenFile: (path: string) => void;
  activePath: string | null;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  query: string;
}) {
  if (node.type === "file") {
    const extension = extensionOf(node.name);
    const kind = fileKind(extension);

    return (
      <li>
        <button
          className={`tree-file ${activePath === node.path ? "active" : ""}`.trim()}
          onClick={() => onOpenFile(node.path)}
        >
          <span className={`node-icon file ${kind}`} aria-hidden>
            {extension.slice(0, 1).toUpperCase()}
          </span>
          <span className="node-label">{node.name}</span>
        </button>
      </li>
    );
  }

  const hasChildren = (node.children ?? []).length > 0;
  const isOpen = query.trim().length > 0 ? true : expanded.has(node.path);

  return (
    <li>
      <details open={isOpen}>
        <summary
          onClick={(event) => {
            event.preventDefault();
            onToggle(node.path);
          }}
        >
          <span className="node-icon folder" aria-hidden>
            <span className="folder-notch" />
          </span>
          <span className="node-label">{node.name}</span>
          {hasChildren ? <span className="node-count">{node.children?.length}</span> : null}
        </summary>
        <ul className="tree-list">
          {(node.children ?? []).map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              onOpenFile={onOpenFile}
              activePath={activePath}
              expanded={expanded}
              onToggle={onToggle}
              query={query}
            />
          ))}
        </ul>
      </details>
    </li>
  );
}

export function FileExplorer({ nodes, onOpenFile, activePath }: FileExplorerProps) {
  const [query, setQuery] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const sortedNodes = useMemo(() => [...nodes].sort(compareNodes), [nodes]);
  const visibleNodes = useMemo(
    () => filterTree(sortedNodes, query, showHidden),
    [sortedNodes, query, showHidden],
  );
  const counts = useMemo(() => countNodes(visibleNodes), [visibleNodes]);

  useEffect(() => {
    setExpanded(new Set(collectDirectoryPaths(sortedNodes).slice(0, 32)));
  }, [sortedNodes]);

  function toggleExpanded(path: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }

  function expandAll() {
    setExpanded(new Set(collectDirectoryPaths(visibleNodes)));
  }

  function collapseAll() {
    setExpanded(new Set());
  }

  return (
    <section className="panel explorer-panel glass-panel">
      <div className="panel-heading">
        <h3 className="panel-title">Explorer</h3>
        <span className="explorer-counts">
          {counts.folders}D / {counts.files}F
        </span>
      </div>

      <div className="explorer-toolbar">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter files"
          className="explorer-filter"
        />
        <div className="explorer-actions">
          <button onClick={expandAll}>Expand</button>
          <button onClick={collapseAll}>Collapse</button>
          <button
            className={showHidden ? "active" : ""}
            onClick={() => {
              setShowHidden((prev) => !prev);
            }}
          >
            Hidden
          </button>
        </div>
      </div>

      {visibleNodes.length === 0 ? (
        <div className="explorer-empty">No files match this filter.</div>
      ) : (
        <ul className="tree-list">
          {visibleNodes.map((node) => (
            <TreeNode
              key={node.path}
              node={node}
              onOpenFile={onOpenFile}
              activePath={activePath}
              expanded={expanded}
              onToggle={toggleExpanded}
              query={query}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
