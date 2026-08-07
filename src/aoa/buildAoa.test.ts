import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildGraph, topologicalSort } from "../graph/buildGraph";
import { validateFile } from "../validate/validateFile";

const read = (path: string) => readFileSync(`test_data/minimal/${path}`, "utf-8");

describe("AOA変換の入力パターン（依存グラフレベルの検証）", () => {
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
