import JSZip from "jszip";
import { normalizePath } from "@/modules/code/file-types";

export interface ZipFileEntry {
  path: string;
  content: string;
}

export interface ZipDiffResult {
  toCreate: ZipFileEntry[];
  toUpdate: Array<ZipFileEntry & { id: string }>;
  ignored: number;
  skippedJunk: number;
}

const JUNK_PATTERNS = [
  /^__MACOSX\//i,
  /(^|\/)\.DS_Store$/i,
  /(^|\/)Thumbs\.db$/i,
  /(^|\/)\.git\//i,
  /(^|\/)node_modules\//i,
  /(^|\/)\.env\.local$/i,
];

function isJunk(path: string): boolean {
  return JUNK_PATTERNS.some((re) => re.test(path));
}

/**
 * Extracts and normalizes text files from a ZIP.
 * Binary/non-text entries are skipped silently.
 * If every file lives under a single top-level folder, that prefix is stripped
 * (typical when the user zipped a project directory).
 */
export async function extractZipEntries(file: File): Promise<{ entries: ZipFileEntry[]; skippedJunk: number }> {
  const zip = await JSZip.loadAsync(file);
  const rawEntries: Array<{ candidate: string; content: string }> = [];
  let skippedJunk = 0;

  const names = Object.keys(zip.files).sort();
  for (const rawName of names) {
    const entry = zip.files[rawName];
    if (!entry || entry.dir) continue;

    const candidate = rawName.replace(/\\/g, "/");
    if (isJunk(candidate)) {
      skippedJunk++;
      continue;
    }

    try {
      const content = await entry.async("string");
      // Skip obviously binary content (null bytes)
      if (content.includes("\0")) continue;
      rawEntries.push({ candidate, content });
    } catch {
      // Non-text or corrupt entry — skip
    }
  }

  // Detect and strip a single common root directory
  let prefix = "";
  if (rawEntries.length > 0) {
    const firstSeg = (rawEntries[0]?.candidate ?? "").split("/")[0];
    if (
      firstSeg &&
      rawEntries.every((e) => e.candidate === firstSeg || e.candidate.startsWith(firstSeg + "/"))
    ) {
      // Only strip if it looks like a folder (more than one segment exists somewhere)
      const hasNested = rawEntries.some((e) => e.candidate.includes("/"));
      if (hasNested) prefix = firstSeg + "/";
    }
  }

  const entries: ZipFileEntry[] = [];
  for (const { candidate, content } of rawEntries) {
    const stripped = prefix && candidate.startsWith(prefix) ? candidate.slice(prefix.length) : candidate;
    const path = normalizePath(stripped);
    if (!path) continue;
    entries.push({ path, content });
  }

  return { entries, skippedJunk };
}

/**
 * Computes the minimal set of creates/updates needed to bring the project
 * in line with the ZIP contents. Local files absent from the ZIP are preserved.
 * Soft-deleted rows are restored via update when the path reappears in the ZIP.
 */
export function computeZipDiff(
  zipEntries: ZipFileEntry[],
  existing: Array<{ id: string; path: string; content: string; deleted: boolean }>,
): ZipDiffResult {
  const byPath = new Map(existing.map((f) => [f.path, f]));
  const toCreate: ZipFileEntry[] = [];
  const toUpdate: Array<ZipFileEntry & { id: string }> = [];
  let ignored = 0;

  for (const entry of zipEntries) {
    const current = byPath.get(entry.path);
    if (!current) {
      toCreate.push(entry);
      continue;
    }
    // Soft-deleted: restore + apply new content
    if (current.deleted) {
      toUpdate.push({ ...entry, id: current.id });
      continue;
    }
    if (current.content === entry.content) {
      ignored++;
      continue;
    }
    toUpdate.push({ ...entry, id: current.id });
  }

  return { toCreate, toUpdate, ignored, skippedJunk: 0 };
}
