import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildAoa, type AoaBuildResult } from "../../src/aoa/buildAoa";
import { buildGraph, topologicalSort } from "../../src/graph/buildGraph";
import { validateFile } from "../../src/validate/validateFile";
import type { Duration, Edge, Task } from "../../src/types";

const read = (path: string) => readFileSync(`test/data/minimal/${path}`, "utf-8");

function task(id: string, assignees: string[] = []): Task {
  return {
    id,
    name: id,
    bucketName: "",
    assignees,
    startDate: null,
    dueDate: null,
    isRecurring: false,
    isCompleted: false,
    description: "",
  };
}

function durMap(entries: [string, number][]): Map<string, Duration> {
  return new Map(
    entries.map(([taskId, businessDays]) => [taskId, { taskId, businessDays, placeholder: false }]),
  );
}

/** 機能仕様書4.2/テスト仕様書2章の不変条件: 全矢線で from の番号 < to の番号。 */
function assertEventNumberInvariant(r: AoaBuildResult): void {
  const numberOf = new Map(r.events.map((e) => [e.id, e.number]));
  for (const a of r.arrows) {
    expect(numberOf.get(a.from)!).toBeLessThan(numberOf.get(a.to)!);
  }
}

describe("AOA変換の入力パターン（CSV→依存グラフレベルの検証。AOA自体は下のdescribeで検証）", () => {
  it("直列（A→B→C）", () => {
    const r = validateFile("f.csv", read("serial_ja.csv"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.edges).toEqual([
      { from: "A001", to: "A002" },
      { from: "A002", to: "A003" },
    ]);
  });

  it("分岐・合流", () => {
    const r = validateFile("f.csv", read("branch_merge_ja.csv"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const sorted = [...r.edges].sort((a, b) => (a.to + a.from).localeCompare(b.to + b.from));
    expect(sorted).toEqual(
      [
        { from: "B001", to: "B002" },
        { from: "B001", to: "B003" },
        { from: "B002", to: "B004" },
        { from: "B003", to: "B004" },
      ].sort((a, b) => (a.to + a.from).localeCompare(b.to + b.from)),
    );
  });

  it("交差依存（ダミー矢線が必要な典型ケース）", () => {
    const r = validateFile("f.csv", read("cross_dependency_ja.csv"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const sorted = [...r.edges].sort((a, b) => (a.to + a.from).localeCompare(b.to + b.from));
    expect(sorted).toEqual(
      [
        { from: "C001", to: "C003" },
        { from: "C001", to: "C004" },
        { from: "C002", to: "C004" },
      ].sort((a, b) => (a.to + a.from).localeCompare(b.to + b.from)),
    );
  });

  it("複数担当タスクは担当者数分の割り当てを持つ", () => {
    const r = validateFile("f.csv", read("multi_assignee_ja.csv"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const m002 = r.tasks.find((t) => t.id === "M002")!;
    expect(m002.assignees).toEqual(["田中 健太", "佐藤 美咲", "山本 拓也"]);
  });

  it("孤立タスクは buildGraph で isolatedTasks に分離される", () => {
    const r = validateFile("f.csv", read("isolated_task_ja.csv"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const { isolatedTasks } = buildGraph(r.tasks, r.edges);
    expect(isolatedTasks.map((t) => t.id)).toEqual(["I003"]);
  });

  it("循環依存は topologicalSort が cycle として検出する（E203）", () => {
    const r = validateFile("f.csv", read("cycle_ja.csv"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const { activeTasks, activeEdges } = buildGraph(r.tasks, r.edges);
    const order = topologicalSort(activeTasks, activeEdges);
    expect("cycle" in order).toBe(true);
  });
});

describe("buildAoa: AOA変換そのもの（ダミー矢線の縮約・合流・イベント番号）", () => {
  it("直列は縮約により全ダミー矢線が消える", () => {
    const tasks = [task("A"), task("B"), task("C")];
    const edges: Edge[] = [
      { from: "A", to: "B" },
      { from: "B", to: "C" },
    ];
    const r = buildAoa(
      tasks,
      edges,
      ["A", "B", "C"],
      durMap([
        ["A", 1],
        ["B", 1],
        ["C", 1],
      ]),
    );
    assertEventNumberInvariant(r);
    expect(r.events).toHaveLength(4); // N0, end:A, end:B, Nz（end:Cはダミー縮約でNzに統合される）
    expect(r.arrows).toHaveLength(3);
    expect(r.arrows.every((a) => a.kind === "activity")).toBe(true);
  });

  it("合流（2先行）は合流イベントを生成し、2本のダミー矢線が残る", () => {
    const tasks = [task("A"), task("B"), task("C"), task("D")];
    const edges: Edge[] = [
      { from: "A", to: "B" },
      { from: "A", to: "C" },
      { from: "B", to: "D" },
      { from: "C", to: "D" },
    ];
    const r = buildAoa(
      tasks,
      edges,
      ["A", "B", "C", "D"],
      durMap([
        ["A", 1],
        ["B", 2],
        ["C", 3],
        ["D", 1],
      ]),
    );
    assertEventNumberInvariant(r);
    const mergeEvent = r.events.find((e) => e.id === "merge:B,C");
    expect(mergeEvent).toBeDefined();
    const dummiesIntoMerge = r.arrows.filter((a) => a.to === "merge:B,C" && a.kind === "dummy");
    expect(dummiesIntoMerge).toHaveLength(2);
    // 合流イベントの番号は B・C の直後、D の直前
    const numberOf = new Map(r.events.map((e) => [e.id, e.number]));
    expect(numberOf.get("end:B")!).toBeLessThan(mergeEvent!.number);
    expect(numberOf.get("end:C")!).toBeLessThan(mergeEvent!.number);
  });

  it("複数担当タスクは担当者数分のactivity矢線と、合流用のdummy矢線を生成する", () => {
    const tasks = [task("M", ["x", "y"]), task("N")];
    const edges: Edge[] = [{ from: "M", to: "N" }];
    const r = buildAoa(
      tasks,
      edges,
      ["M", "N"],
      durMap([
        ["M", 2],
        ["N", 1],
      ]),
    );
    assertEventNumberInvariant(r);
    const mActivities = r.arrows.filter((a) => a.taskId === "M" && a.kind === "activity");
    expect(mActivities).toHaveLength(2);
    expect(mActivities.map((a) => a.assignee).sort()).toEqual(["x", "y"]);
    expect(mActivities.every((a) => a.durationBusinessDays === 2)).toBe(true);
    const dummiesIntoEndM = r.arrows.filter((a) => a.to === "end:M" && a.kind === "dummy");
    expect(dummiesIntoEndM).toHaveLength(2);
  });

  it("先行・後続を持たない孤立タスク1件は N0→Nz 直結になる", () => {
    const r = buildAoa([task("A")], [], ["A"], durMap([["A", 1]]));
    assertEventNumberInvariant(r);
    expect(r.events).toHaveLength(2);
    expect(r.arrows).toEqual([
      {
        from: "N0",
        to: "Nz",
        kind: "activity",
        taskId: "A",
        assignee: undefined,
        durationBusinessDays: 1,
        placeholder: false,
      },
    ]);
  });

  it("所要日数が仮置き（placeholder）のタスクはarrowにplaceholder:trueを引き継ぐ", () => {
    const r = buildAoa(
      [task("A")],
      [],
      ["A"],
      new Map([["A", { taskId: "A", businessDays: 3, placeholder: true }]]),
    );
    expect(r.arrows[0]!.placeholder).toBe(true);
  });
});
