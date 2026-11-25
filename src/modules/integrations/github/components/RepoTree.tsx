import { useMemo, useState } from "react";
import { ChevronRight, File, Folder, FolderOpen, Check } from "lucide-react";
import type { RepositoryPreview } from "../repository";

interface Node {
  name: string;
  path: string;
  children: Map<string, Node>;
  file?: RepositoryPreview["files"][number];
}

function build(files: RepositoryPreview["files"]): Node {
  const root: Node = { name: "", path: "", children: new Map() };
  for (const f of files) {
    let cur = root;
    const parts = f.path.split("/");
    parts.forEach((part, i) => {
      const path = parts.slice(0, i + 1).join("/");
      let next = cur.children.get(part);
      if (!next) {
        next = { name: part, path, children: new Map() };
        cur.children.set(part, next);
      }
      if (i === parts.length - 1) next.file = f;
      cur = next;
    });
  }
  return root;
}

function sorted(n: Node) {
  return [...n.children.values()].sort((a, b) => {
    const da = a.file ? 1 : 0;
    const db = b.file ? 1 : 0;
    return da - db || a.name.localeCompare(b.name);
  });
}

export function RepoTree({
  files,
  selected,
  onToggle,
}: {
  files: RepositoryPreview["files"];
  selected: string[];
  onToggle: (path: string) => void;
}) {
  const root = useMemo(() => build(files), [files]);
  return (
    <ul className="font-mono text-xs">
      {sorted(root).map((n) => (
        <TreeNode key={n.path} node={n} depth={0} selected={selected} onToggle={onToggle} />
      ))}
    </ul>
  );
}

function TreeNode({
  node,
  depth,
  selected,
  onToggle,
}: {
  node: Node;
  depth: number;
  selected: string[];
  onToggle: (path: string) => void;
}) {
  const [open, setOpen] = useState(depth === 0 && node.children.size < 15);
  const pad = { paddingLeft: `${depth * 12 + 4}px` };
  if (node.file) {
    const f = node.file;
    const excluded = f.status === "excluded";
    const on = selected.includes(f.path);
    return (
      <li>
        <button
          type="button"
          disabled={excluded}
          title={excluded ? f.reason : on ? "Remover do chat" : "Anexar ao chat"}
          onClick={() => onToggle(f.path)}
          style={pad}
          className={`flex w-full items-center gap-1.5 rounded py-1 pr-1 text-left hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40 ${on ? "bg-accent text-primary" : ""}`}
        >
          <span className="w-3" />
          {on ? <Check className="h-3.5 w-3.5 shrink-0" /> : <File className="h-3.5 w-3.5 shrink-0" />}
          <span className="truncate">{node.name}</span>
        </button>
      </li>
    );
  }
  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={pad}
        className="flex w-full items-center gap-1.5 rounded py-1 pr-1 text-left hover:bg-accent"
      >
        <ChevronRight className={`h-3 w-3 shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />
        {open ? <FolderOpen className="h-3.5 w-3.5 shrink-0 text-primary" /> : <Folder className="h-3.5 w-3.5 shrink-0 text-primary" />}
        <span className="truncate">{node.name}</span>
      </button>
      {open && (
        <ul>
          {sorted(node).map((c) => (
            <TreeNode key={c.path} node={c} depth={depth + 1} selected={selected} onToggle={onToggle} />
          ))}
        </ul>
      )}
    </li>
  );
}
