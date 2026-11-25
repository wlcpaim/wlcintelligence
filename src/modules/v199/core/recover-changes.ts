/** Recover only fully closed JSON change objects; never fabricate missing source code. */
export function recoverCompleteChanges(raw: string): { path: string; content: string }[] {
  const changesStart = /"changes"\s*:\s*\[/.exec(raw);
  if (!changesStart) return [];
  const changes: { path: string; content: string }[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = changesStart.index + changesStart[0].length; i < raw.length; i++) {
    const char = raw[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') { inString = true; continue; }
    if (char === "]" && depth === 0) break;
    if (char === "{") { if (depth === 0) start = i; depth++; }
    if (char !== "}" || depth === 0) continue;
    depth--;
    if (depth !== 0 || start < 0) continue;
    try {
      const item: unknown = JSON.parse(raw.slice(start, i + 1));
      if (typeof item === "object" && item !== null && "path" in item && "content" in item &&
          typeof item.path === "string" && item.path.trim() && typeof item.content === "string") {
        changes.push({ path: item.path, content: item.content });
      }
    } catch { /* Invalid complete objects are not source files. */ }
    start = -1;
  }
  return changes;
}