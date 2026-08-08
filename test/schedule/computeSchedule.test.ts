import { describe, expect, it } from "vitest";
import { buildAoa } from "../../src/aoa/buildAoa";
import { computeSchedule } from "../../src/schedule/computeSchedule";
import type { Arrow, Duration, Edge, Event, Task } from "../../src/types";

function arrow(from: string, to: string, taskId: string, durationBusinessDays: number): Arrow {
  return { from, to, kind: "activity", taskId, durationBusinessDays, placeholder: false };
}

function task(id: string): Task {
  return {
    id,
    name: id,
    bucketName: "",
    assignees: [],
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

describe("computeSchedule: クリティカルパスが一意なケース", () => {
  const events: Event[] = [
    { id: "N0", number: 0 },
    { id: "M", number: 1 },
    { id: "Nz", number: 2 },
  ];
  const arrows: Arrow[] = [arrow("N0", "M", "A", 2), arrow("M", "Nz", "B", 3)];
  const r = computeSchedule(events, arrows);

  it("ES/LSが前進・後進計算どおりになる", () => {
    expect(r.eventTimings).toEqual(
      expect.arrayContaining([
        { eventId: "N0", es: 0, ls: 0 },
        { eventId: "M", es: 2, ls: 2 },
        { eventId: "Nz", es: 5, ls: 5 },
      ]),
    );
  });

  it("全矢線がクリティカル（TF=0）で、経路は1本のみ", () => {
    expect(r.arrowTimings.every((t) => t.isCritical && t.totalFloat === 0)).toBe(true);
    expect(r.criticalPaths).toHaveLength(1);
    expect(r.criticalPaths[0]).toHaveLength(2);
  });

  it("全タスクの TF ≥ 0（不変条件）", () => {
    expect(r.arrowTimings.every((t) => t.totalFloat >= 0)).toBe(true);
  });
});

describe("computeSchedule: クリティカルパスが複数存在するケース", () => {
  it("同一所要日数の並行2経路はどちらもクリティカルになる", () => {
    const events: Event[] = [
      { id: "N0", number: 0 },
      { id: "Nz", number: 1 },
    ];
    const arrows: Arrow[] = [arrow("N0", "Nz", "A", 2), arrow("N0", "Nz", "B", 2)];
    const r = computeSchedule(events, arrows);
    expect(r.arrowTimings.every((t) => t.isCritical)).toBe(true);
    expect(r.criticalPaths).toHaveLength(2);
  });

  it("所要日数が短い経路はクリティカルにならない（フロートを持つ）", () => {
    const events: Event[] = [
      { id: "N0", number: 0 },
      { id: "Nz", number: 1 },
    ];
    const arrows: Arrow[] = [arrow("N0", "Nz", "A", 5), arrow("N0", "Nz", "B", 2)];
    const r = computeSchedule(events, arrows);
    const a = r.arrowTimings.find((t) => t.arrow.taskId === "A")!;
    const b = r.arrowTimings.find((t) => t.arrow.taskId === "B")!;
    expect(a.isCritical).toBe(true);
    expect(b.isCritical).toBe(false);
    expect(b.totalFloat).toBe(3);
    expect(r.criticalPaths).toHaveLength(1);
  });
});

describe("computeSchedule: ダミーを含む経路でのES/LS（buildAoa経由）", () => {
  it("合流イベントを含む経路のクリティカルパスが所要日数の長い方を通る", () => {
    const tasks = [task("A"), task("B"), task("C"), task("D")];
    const edges: Edge[] = [
      { from: "A", to: "B" },
      { from: "A", to: "C" },
      { from: "B", to: "D" },
      { from: "C", to: "D" },
    ];
    const aoa = buildAoa(
      tasks,
      edges,
      ["A", "B", "C", "D"],
      durMap([
        ["A", 1],
        ["B", 5], // Cより長い → クリティカル経路はB側
        ["C", 1],
        ["D", 1],
      ]),
    );
    const r = computeSchedule(aoa.events, aoa.arrows);
    expect(r.arrowTimings.every((t) => t.totalFloat >= 0)).toBe(true);

    const bTiming = r.arrowTimings.find((t) => t.arrow.taskId === "B")!;
    const cTiming = r.arrowTimings.find((t) => t.arrow.taskId === "C")!;
    expect(bTiming.isCritical).toBe(true);
    expect(cTiming.isCritical).toBe(false);

    // クリティカル経路上の合流へのダミー矢線（B側）はクリティカル、C側は非クリティカル
    const dummies = r.arrowTimings.filter((t) => t.arrow.kind === "dummy");
    expect(dummies.some((t) => t.isCritical)).toBe(true);
    expect(dummies.some((t) => !t.isCritical)).toBe(true);
  });
});
