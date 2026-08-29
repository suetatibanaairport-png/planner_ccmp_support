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

describe("Workspace 手動編集（機能仕様書 4.3）", () => {
  const load = (name: string, fixture: string): Workspace => {
    const ws = new Workspace(new Set());
    ws.addFiles([{ name, text: read(fixture) }]);
    return ws;
  };

  it("getModel は前半出力（タスクと依存辺）を返す", () => {
    const ws = load("serial.csv", "minimal/serial_ja.csv");
    const model = ws.getModel("serial.csv")!;
    expect(model.tasks.map((t) => t.id)).toEqual(["A001", "A002", "A003"]);
    expect(model.edges).toEqual([
      { from: "A001", to: "A002" },
      { from: "A002", to: "A003" },
    ]);
    expect(ws.getModel("missing.csv")).toBeUndefined();
  });

  it("getLoadedFileNames はファイル名昇順", () => {
    const ws = new Workspace(new Set());
    ws.addFiles([
      { name: "b.csv", text: read("minimal/serial_ja.csv") },
      { name: "a.csv", text: read("minimal/branch_merge_ja.csv") },
    ]);
    expect(ws.getLoadedFileNames()).toEqual(["a.csv", "b.csv"]);
  });

  it("applyManualEdits で辺を削ると arrowTimings が変化し、切り離されたタスクが孤立プロジェクト化する", () => {
    const ws = load("serial.csv", "minimal/serial_ja.csv");
    const before = ws.getProjects().find((p) => p.key === "serial")!;
    const beforeActivities = before.arrowTimings.filter((t) => t.arrow.kind === "activity").length;

    ws.applyManualEdits("serial.csv", [{ from: "A001", to: "A002" }]);

    const after = ws.getProjects().find((p) => p.key === "serial")!;
    const afterActivities = after.arrowTimings.filter((t) => t.arrow.kind === "activity").length;
    expect(afterActivities).toBeLessThan(beforeActivities);
    expect(ws.getProjects().some((p) => p.key === "serial#isolated")).toBe(true);
  });

  it("孤立タスクに辺を追加すると #isolated プロジェクトが消える", () => {
    const ws = load("iso.csv", "minimal/isolated_task_ja.csv");
    expect(ws.getProjects().some((p) => p.key === "iso#isolated")).toBe(true);

    const edges = [...ws.getModel("iso.csv")!.edges, { from: "I002", to: "I003" }];
    ws.applyManualEdits("iso.csv", edges);

    expect(ws.getProjects().some((p) => p.key === "iso#isolated")).toBe(false);
  });

  it("applyManualEdits を繰り返しても警告が累積しない", () => {
    const ws = load("warn.csv", "errors/warnings_ja.csv");
    const model = ws.getModel("warn.csv")!;
    const first = ws.applyManualEdits("warn.csv", model.edges);
    const second = ws.applyManualEdits("warn.csv", model.edges);
    expect(second.length).toBe(first.length);
  });
});
