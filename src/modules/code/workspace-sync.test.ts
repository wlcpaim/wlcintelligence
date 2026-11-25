import { describe, expect, it } from "vitest";
import { mergeWorkspaceFiles, type WorkspaceFile } from "./workspace-sync";

const file: WorkspaceFile = { id: "a", path: "src/a.ts", content: "old", base_content: "old", deleted: false, updated_at: "2026-11-23T09:00:00Z" };

describe("workspace synchronization", () => {
  it("refreshes a file already open from database content", () => {
    const remote = { ...file, content: "copilot edit", updated_at: "2026-11-23T09:15:00Z" };
    expect(mergeWorkspaceFiles([remote], [file], [file], new Set())).toEqual([remote]);
  });
  it("preserves edits made while synchronization is reading", () => {
    const local = { ...file, content: "unsaved typing" };
    expect(mergeWorkspaceFiles([{ ...file, content: "remote" }], [local], [file], new Set())).toEqual([local]);
  });
  it("preserves queued and in-flight saves", () => {
    expect(mergeWorkspaceFiles([{ ...file, content: "remote" }], [file], [file], new Set(["a"]))).toEqual([file]);
  });
  it("adds database files and removes files deleted from the database", () => {
    const added = { ...file, id: "b", path: "src/b.ts" };
    expect(mergeWorkspaceFiles([added], [file], [file], new Set())).toEqual([added]);
  });
  it("does not resurrect a file deleted locally while reading", () => {
    expect(mergeWorkspaceFiles([file], [], [file], new Set())).toEqual([]);
  });
  it("retains files newly created locally while reading", () => {
    expect(mergeWorkspaceFiles([], [file], [], new Set())).toEqual([file]);
  });
});