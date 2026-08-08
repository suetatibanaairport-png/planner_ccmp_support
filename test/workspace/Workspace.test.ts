import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Workspace } from "../../src/workspace/Workspace";

const read = (path: string) => readFileSync(`test/data/${path}`, "utf-8");

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

  it("選択順に依らずファイル名昇順で処理される（結果が選択順に依存しない）", () => {
    const files = [
      { name: "z_serial.csv", text: read("minimal/serial_ja.csv") },
      { name: "a_branch.csv", text: read("minimal/branch_merge_ja.csv") },
      { name: "m_cross.csv", text: read("minimal/cross_dependency_ja.csv") },
    ];

    const forward = new Workspace(new Set()).addFiles(files);
    const reversed = new Workspace(new Set()).addFiles([...files].reverse());

    expect(forward.rejectedFiles).toEqual([]);
    expect(reversed.rejectedFiles).toEqual([]);
    expect([...forward.addedProjectKeys].sort()).toEqual([...reversed.addedProjectKeys].sort());
  });
});
