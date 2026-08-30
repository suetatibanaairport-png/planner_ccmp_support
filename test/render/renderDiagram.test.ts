// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { layoutWorkspace } from "../../src/layout/layoutWorkspace";
import type { ProjectLayout, WorkspaceLayout } from "../../src/layout/layoutWorkspace";
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
  return renderDiagram(layout, [p], new Map()).diagram;
}

/** 日数軸の目盛りラベル（数字のみのtext）とプロジェクト名ラベルを除いた、タスク名ラベルのtext要素一覧。 */
function taskNameLabels(svg: SVGSVGElement): SVGTextElement[] {
  return [...svg.querySelectorAll<SVGTextElement>("text:not(.project-label)")].filter(
    (t) => !/^-?\d+$/.test(t.textContent ?? ""),
  );
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

describe("renderDiagram: ダミー矢線の折れ線形状", () => {
  it("行が異なる場合、合流イベントの直前まで先行イベントと同じ行（水平線）を保ち、末尾だけ斜めになる", () => {
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
    const p: Project = {
      key: "p1",
      fileName: "p1.csv",
      tasks: [],
      edges: [],
      isolated: false,
      events,
      arrows: [arrow],
      eventTimings: [
        { eventId: "N0", es: 0, ls: 0 },
        { eventId: "N1", es: 3, ls: 3 },
      ],
      arrowTimings: [{ arrow, es: 0, ef: 0, ls: 0, lf: 0, totalFloat: 0, isCritical: false }],
      criticalPaths: [],
      mergeBufferCandidates: [],
      baseDate: null,
      offsetBusinessDays: 0,
    };
    const layout: ProjectLayout = {
      projectKey: "p1",
      fileName: "p1.csv",
      isolated: false,
      topRow: 0,
      rowCount: 2,
      positions: new Map([
        ["N0", { x: 0, row: 0 }],
        ["N1", { x: 3, row: 1 }],
      ]),
    };
    const workspace: WorkspaceLayout = { projects: [layout] };

    const svg = renderDiagram(workspace, [p], new Map()).diagram;
    const polyline = svg.querySelector("polyline[stroke-dasharray]");
    expect(polyline).not.toBeNull();
    const points = polyline!
      .getAttribute("points")!
      .split(" ")
      .map((pair) => pair.split(",").map(Number));
    expect(points).toHaveLength(3);
    const [[, y0], [x1, y1], [, y2]] = points as [
      [number, number],
      [number, number],
      [number, number],
    ];
    expect(y1).toBe(y0); // 折れ点までは先行イベント（N0）と同じ行（レーン）を水平に保つ
    expect(y2).not.toBe(y0); // 合流イベント（N1）の行には末尾でのみ切り替わる
    expect(x1).toBeLessThan(points[2]![0]!); // 折れ点は終点の手前
  });
});

describe("renderDiagram: プロジェクト名ラベル（機能仕様書 3.5.4）", () => {
  const withOneArrow = (over: Partial<Project> & { key: string }): Project => {
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
    return project({
      tasks: [task("T1", "作業")],
      events,
      arrows: [arrow],
      eventTimings: [
        { eventId: "N0", es: 0, ls: 0 },
        { eventId: "N1", es: 3, ls: 3 },
      ],
      arrowTimings: [{ arrow, es: 0, ef: 3, ls: 0, lf: 3, totalFloat: 0, isCritical: true }],
      ...over,
    });
  };

  it("非孤立プロジェクトは先頭ノードより上にファイル名の text.project-label を描画する", () => {
    const svg = renderProject(withOneArrow({ key: "planA" }));
    const label = svg.querySelector<SVGTextElement>("text.project-label");
    expect(label).not.toBeNull();
    expect(label!.textContent).toBe("planA.csv");

    const minCy = Math.min(
      ...[...svg.querySelectorAll("circle")].map((c) => Number(c.getAttribute("cy"))),
    );
    expect(Number(label!.getAttribute("y"))).toBeLessThan(minCy);
  });

  it("孤立タスクの独立プロジェクトにはプロジェクト名を描画しない", () => {
    const svg = renderProject(withOneArrow({ key: "planA", isolated: true }));
    expect(svg.querySelector("text.project-label")).toBeNull();
  });
});

describe("DEFAULT_DIAGRAM_CONFIG", () => {
  it("時間軸は0.5倍（24px/営業日）、行間隔は1.5倍（84px）になっている", () => {
    expect(DEFAULT_DIAGRAM_CONFIG.pixelsPerDay).toBe(24);
    expect(DEFAULT_DIAGRAM_CONFIG.rowHeight).toBe(84);
  });
});

describe("renderDiagram: カレンダー軸モード（UI・UX仕様書 4.2.4）", () => {
  const twoEventsFiveDaysApart = (): Project => {
    const events: Event[] = [
      { id: "N0", number: 0 },
      { id: "N1", number: 1 },
    ];
    const arrow: Arrow = {
      from: "N0",
      to: "N1",
      kind: "activity",
      taskId: "T1",
      durationBusinessDays: 5,
      placeholder: false,
    };
    return project({
      key: "p1",
      tasks: [task("T1", "作業")],
      events,
      arrows: [arrow],
      eventTimings: [
        { eventId: "N0", es: 0, ls: 0 },
        { eventId: "N1", es: 5, ls: 5 },
      ],
      arrowTimings: [{ arrow, es: 0, ef: 5, ls: 0, lf: 5, totalFloat: 0, isCritical: true }],
    });
  };

  it("週をまたぐノード間隔が土日ぶん広がり、非営業日の網掛け帯と週次の日付ラベルが出る", () => {
    const p = twoEventsFiveDaysApart();
    const layout = layoutWorkspace([p]);
    const origin = new Date(Date.UTC(2026, 0, 5)); // 月曜
    const { diagram, axis } = renderDiagram(layout, [p], new Map(), DEFAULT_DIAGRAM_CONFIG, {
      originDate: origin,
      holidayKeys: new Set<string>(),
    });

    const cxs = [...diagram.querySelectorAll("circle")]
      .map((c) => Number(c.getAttribute("cx")))
      .sort((a, b) => a - b);
    // 営業日5個ぶん = 暦日7個ぶん（土日で+2）→ 7 * pixelsPerCalendarDay(18) = 126（営業日軸なら 120）
    expect(cxs[1]! - cxs[0]!).toBe(7 * DEFAULT_DIAGRAM_CONFIG.pixelsPerCalendarDay);

    // 非営業日の網掛け <rect>（本体側・全高）
    expect(diagram.querySelector("rect")).not.toBeNull();

    // 週次の日付ラベルは軸SVG側。"1/12"（bd5 = 翌週月曜）が含まれ、営業日番号は出ない
    const axisTexts = [...axis.querySelectorAll("text")].map((t) => t.textContent);
    expect(axisTexts).toContain("1/12");
    expect(axisTexts.some((t) => t === "5")).toBe(false);
  });

  it("軸SVGは高さ axisHeight で本体と分離されている", () => {
    const p = twoEventsFiveDaysApart();
    const { diagram, axis } = renderDiagram(layoutWorkspace([p]), [p], new Map());
    expect(Number(axis.getAttribute("height"))).toBe(DEFAULT_DIAGRAM_CONFIG.axisHeight);
    expect(axis.getAttribute("width")).toBe(diagram.getAttribute("width"));
    // 目盛りラベルは軸側のみ・本体側には無い
    const bodyNumeric = [...diagram.querySelectorAll("text")].filter((t) =>
      /^-?\d+$/.test(t.textContent ?? ""),
    );
    expect(bodyNumeric).toHaveLength(0);
  });

  it("営業日軸（calendarAxisInput 省略）は最終タスク終了=0からの残営業日数を右端0で表示する", () => {
    const p = twoEventsFiveDaysApart();
    const { diagram, axis } = renderDiagram(layoutWorkspace([p]), [p], new Map());
    const cxs = [...diagram.querySelectorAll("circle")]
      .map((c) => Number(c.getAttribute("cx")))
      .sort((a, b) => a - b);
    expect(cxs[1]! - cxs[0]!).toBe(5 * DEFAULT_DIAGRAM_CONFIG.pixelsPerDay);
    expect(diagram.querySelector("rect")).toBeNull();

    // 目盛りは lastDay(=5) から 0 へ。右端（cx最大）のラベルが "0"
    const labels = [...axis.querySelectorAll("text")]
      .map((t) => ({ x: Number(t.getAttribute("x")), text: t.textContent }))
      .sort((a, b) => a.x - b.x);
    expect(labels.map((l) => l.text)).toEqual(["5", "4", "3", "2", "1", "0"]);
  });
});

describe("renderDiagram: レーン（行）並びは軸モードに依存しない（仕様）", () => {
  it("同じ WorkspaceLayout なら calendarAxisInput の有無でノードの cy（行）が完全一致する", () => {
    // N0→B（クリティカル, 5日）／ N0→C→D（非クリティカル）／ B→D。C は別レーンに入る。
    const events: Event[] = [
      { id: "N0", number: 0 },
      { id: "C", number: 1 },
      { id: "B", number: 2 },
      { id: "D", number: 3 },
    ];
    const mk = (from: string, to: string, dur: number): Arrow => ({
      from,
      to,
      kind: "activity",
      taskId: `${from}${to}`,
      durationBusinessDays: dur,
      placeholder: false,
    });
    const arrows = [mk("N0", "B", 5), mk("N0", "C", 1), mk("C", "D", 1), mk("B", "D", 1)];
    const p = project({
      key: "p1",
      events,
      arrows,
      eventTimings: [
        { eventId: "N0", es: 0, ls: 0 },
        { eventId: "C", es: 1, ls: 5 },
        { eventId: "B", es: 5, ls: 5 },
        { eventId: "D", es: 6, ls: 6 },
      ],
      arrowTimings: arrows.map((a) => ({
        arrow: a,
        es: 0,
        ef: 0,
        ls: 0,
        lf: 0,
        totalFloat: a.taskId === "N0B" || a.taskId === "BD" ? 0 : 4,
        isCritical: a.taskId === "N0B" || a.taskId === "BD",
      })),
      criticalPaths: [[arrows[0]!, arrows[3]!]],
    });
    const layout = layoutWorkspace([p]);

    const cyByEvent = (svg: SVGSVGElement) =>
      new Map([...svg.querySelectorAll("circle")].map((c, i) => [i, Number(c.getAttribute("cy"))]));

    const businessDay = renderDiagram(layout, [p], new Map()).diagram;
    const calendar = renderDiagram(layout, [p], new Map(), DEFAULT_DIAGRAM_CONFIG, {
      originDate: new Date(Date.UTC(2026, 0, 5)),
      holidayKeys: new Set<string>(),
    }).diagram;

    expect(cyByEvent(calendar)).toEqual(cyByEvent(businessDay));
    // 少なくとも2レーン使っている（テストが自明でないことの確認）
    expect(new Set(cyByEvent(businessDay).values()).size).toBeGreaterThan(1);
  });
});
