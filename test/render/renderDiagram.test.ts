// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { layoutWorkspace } from "../../src/layout/layoutWorkspace";
import { DEFAULT_DIAGRAM_CONFIG, renderDiagram } from "../../src/render/renderDiagram";
import type { Arrow, Event, EventTiming, Project, Task } from "../../src/types";

function task(id: string, name: string): Task {
  return {
    id,
    name,
    bucketName: "",
    assignees: [],
    startDate: null,
    dueDate: null,
    isRecurring: false,
    isCompleted: false,
    description: "",
  };
}

function project(overrides: Partial<Project> & { key: string }): Project {
  return {
    fileName: `${overrides.key}.csv`,
    tasks: [],
    edges: [],
    isolated: false,
    events: [],
    arrows: [],
    eventTimings: [],
    arrowTimings: [],
    criticalPaths: [],
    mergeBufferCandidates: [],
    baseDate: null,
    offsetBusinessDays: 0,
    ...overrides,
  };
}

function renderProject(p: Project): SVGSVGElement {
  const layout = layoutWorkspace([p]);
  return renderDiagram(layout, [p], new Map());
}

/** 日数軸の目盛りラベル（数字のみのtext）を除いた、タスク名ラベルのtext要素一覧。 */
function taskNameLabels(svg: SVGSVGElement): SVGTextElement[] {
  return [...svg.querySelectorAll("text")].filter((t) => !/^-?\d+$/.test(t.textContent ?? ""));
}

describe("renderDiagram: タスク名ラベル", () => {
  it("実作業の矢線には矢線より上にタスク名のtext要素が描画される", () => {
    const events: Event[] = [
      { id: "N0", number: 0 },
      { id: "N1", number: 1 },
    ];
    const arrow: Arrow = {
      from: "N0",
      to: "N1",
      kind: "activity",
      taskId: "T1",
      durationBusinessDays: 3,
      placeholder: false,
    };
    const eventTimings: EventTiming[] = [
      { eventId: "N0", es: 0, ls: 0 },
      { eventId: "N1", es: 3, ls: 3 },
    ];
    const p = project({
      key: "p1",
      tasks: [task("T1", "要件定義")],
      events,
      arrows: [arrow],
      eventTimings,
      arrowTimings: [{ arrow, es: 0, ef: 3, ls: 0, lf: 3, totalFloat: 0, isCritical: true }],
    });

    const svg = renderProject(p);
    // 日数軸の目盛りラベル（数字のみのtext）はタスク名ラベルとは無関係なので除外して数える。
    const taskLabels = taskNameLabels(svg);
    expect(taskLabels).toHaveLength(1);
    expect(taskLabels[0]!.textContent).toBe("要件定義");

    const circles = [...svg.querySelectorAll("circle")];
    const minCy = Math.min(...circles.map((c) => Number(c.getAttribute("cy"))));
    expect(Number(taskLabels[0]!.getAttribute("y"))).toBeLessThan(minCy);
  });

  it("ダミー矢線にはタスク名を表示しない", () => {
    const events: Event[] = [
      { id: "N0", number: 0 },
      { id: "N1", number: 1 },
    ];
    const arrow: Arrow = {
      from: "N0",
      to: "N1",
      kind: "dummy",
      durationBusinessDays: 0,
      placeholder: false,
    };
    const eventTimings: EventTiming[] = [
      { eventId: "N0", es: 0, ls: 0 },
      { eventId: "N1", es: 0, ls: 0 },
    ];
    const p = project({
      key: "p1",
      events,
      arrows: [arrow],
      eventTimings,
      arrowTimings: [{ arrow, es: 0, ef: 0, ls: 0, lf: 0, totalFloat: 0, isCritical: false }],
    });

    const svg = renderProject(p);
    expect(taskNameLabels(svg)).toHaveLength(0);
  });
});

describe("DEFAULT_DIAGRAM_CONFIG", () => {
  it("時間軸は0.5倍（24px/営業日）、行間隔は1.5倍（84px）になっている", () => {
    expect(DEFAULT_DIAGRAM_CONFIG.pixelsPerDay).toBe(24);
    expect(DEFAULT_DIAGRAM_CONFIG.rowHeight).toBe(84);
  });
});
