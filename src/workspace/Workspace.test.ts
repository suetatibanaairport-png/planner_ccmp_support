import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Workspace } from "./Workspace";

const read = (path: string) => readFileSync(`test_data/${path}`, "utf-8");

describe("Workspace.addFiles", () => {
  it("planA/planBはタスクIDが独立しておりE206が発生しない", () => {
    const ws = new Workspace(new Set());
    const result = ws.addFiles([
      { name: "planner_tasks_planA_ja.csv", text: read("planner_tasks_planA_ja.csv") },
      { name: "planner_tasks_planB_ja.csv", text: read("planner_tasks_planB_ja.csv") },
    ]);
    expect(result.rejectedFiles).toEqual([]);
    expect(result.addedProjectKeys.length).toBeGreaterThanOrEqual(2);
  });

  it("同一タスクIDが複数ファイルに出現するとE206で拒否される", () => {
    const ws = new Workspace(new Set());
    const text = read("planner_tasks_planA_ja.csv");
    ws.addFiles([{ name: "a.csv", text }]);
    const result = ws.addFiles([{ name: "b.csv", text }]);
    expect(result.rejectedFiles).toHaveLength(1);
    expect(result.rejectedFiles[0]!.code).toBe("E206");
  });

  it("同名ファイルの重複読み込みはE205で拒否される", () => {
    const ws = new Workspace(new Set());
    const text = read("minimal/serial_ja.csv");
    ws.addFiles([{ name: "same.csv", text }]);
    const result = ws.addFiles([{ name: "same.csv", text }]);
    expect(result.rejectedFiles).toHaveLength(1);
    expect(result.rejectedFiles[0]!.code).toBe("E205");
    expect(result.rejectedFiles[0]!.fileName).toBe("same.csv");
  });

  it("removeFileで読み込み済みタスクIDが解放され、同一IDを再読み込みできる", () => {
    const ws = new Workspace(new Set());
    const text = read("planner_tasks_planA_ja.csv");
    ws.addFiles([{ name: "a.csv", text }]);
    ws.removeFile("a.csv");
    const result = ws.addFiles([{ name: "b.csv", text }]);
    expect(result.rejectedFiles).toEqual([]);
  });
});
