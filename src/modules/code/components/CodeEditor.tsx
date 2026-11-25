import CodeMirror from "@uiw/react-codemirror";
import { vscodeDark } from "@uiw/codemirror-theme-vscode";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { useMemo } from "react";
import { fileType } from "../file-types";

function langFor(path: string) {
  switch (fileType(path).lang) {
    case "js": return [javascript()];
    case "jsx": return [javascript({ jsx: true })];
    case "ts": return [javascript({ typescript: true })];
    case "tsx": return [javascript({ jsx: true, typescript: true })];
    case "py": return [python()];
    case "html": return [html()];
    case "css": return [css()];
    case "json": return [json()];
    case "md": return [markdown()];
    default: return [];
  }
}

export default function CodeEditor({ path, value, onChange }: { path: string; value: string; onChange: (v: string) => void }) {
  const extensions = useMemo(() => langFor(path), [path]);
  return <CodeMirror value={value} onChange={onChange} theme={vscodeDark} extensions={extensions} height="100%" className="h-full text-[13px]"
    basicSetup={{ foldGutter: true, highlightActiveLine: true, bracketMatching: true, autocompletion: true, tabSize: 2 }} />;
}
