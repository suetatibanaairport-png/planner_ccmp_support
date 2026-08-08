import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Workspace } from "../../src/workspace/Workspace";
import { LIMITS } from "../../src/validate/limits";

const read = (path: string) => readFileSync(`test/data/${path}`, "utf-8");

// E401（合計タスク件数上限）は境界値そのものが大きいため、テスト仕様書.md 3章の方針に従い
// 固定フィクスチャではなくテストコード側で動的に生成する（依存関係を持たない最小構成のタスク）。
function buildTaskOnlyCsv(count: number, idPrefix: string): string {
  const header = "タスク ID,タスク名,割り当て先,開始日,期限日,定期的,説明";
  const rows = Array.from({ length: count }, (_, i) => `${idPrefix}${i},タスク${i},,,,いいえ,`);
  return [header, ...rows].join("\n");
}

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

describe("Workspace.addFiles: E401（合計タスク件数上限）", () => {
  it("境界値: 累計がちょうど上限に達する場合は拒否されない", () => {
    const ws = new Workspace(new Set());
    const text = buildTaskOnlyCsv(LIMITS.maxTotalTasks, "T");
    const result = ws.addFiles([{ name: "just_at_limit.csv", text }]);
    expect(result.rejectedFiles).toEqual([]);
  });

  it("累計が上限を超えるファイルのみE401で拒否され、それ以前のファイルは正常に追加される", () => {
    const ws = new Workspace(new Set());
    const underLimit = buildTaskOnlyCsv(LIMITS.maxTotalTasks - 1, "A");
    const overflow = buildTaskOnlyCsv(2, "B");

    const result = ws.addFiles([
      { name: "a_under_limit.csv", text: underLimit },
      { name: "b_overflow.csv", text: overflow },
    ]);

    expect(result.addedProjectKeys.length).toBeGreaterThan(0);
    expect(result.rejectedFiles).toEqual([
      {
        code: "E401",
        fileName: "b_overflow.csv",
        message: `タスク件数が読み込み済み全プロジェクト合計の上限（${LIMITS.maxTotalTasks}件）を超えています。`,
      },
    ]);
  });

  it("既読み込み分との累計で上限を超える場合、後から追加しようとしたファイルがE401で拒否される", () => {
    const ws = new Workspace(new Set());
    ws.addFiles([
      { name: "a_under_limit.csv", text: buildTaskOnlyCsv(LIMITS.maxTotalTasks - 1, "A") },
    ]);

    const result = ws.addFiles([{ name: "b_next.csv", text: buildTaskOnlyCsv(2, "B") }]);

    expect(result.rejectedFiles).toHaveLength(1);
    expect(result.rejectedFiles[0]!.code).toBe("E401");
    expect(result.rejectedFiles[0]!.fileName).toBe("b_next.csv");
  });
});
