import { describe, expect, it } from "vitest";
import { layoutWorkspace } from "../../src/layout/layoutWorkspace";
import type { Arrow, Event, EventTiming, Project } from "../../src/types";

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

describe("layoutWorkspace", () => {
  it("X座標はES＋プロジェクトオフセットになる", () => {
    const events: Event[] = [
      { id: "N0", number: 0 },
      { id: "Nz", number: 1 },
    ];
    const arrows: Arrow[] = [
      {
        from: "N0",
        to: "Nz",
        kind: "activity",
        taskId: "A",
        durationBusinessDays: 3,
        placeholder: false,
      },
    ];
    const eventTimings: EventTiming[] = [
      { eventId: "N0", es: 0, ls: 0 },
      { eventId: "Nz", es: 3, ls: 3 },
    ];
    const p = project({ key: "p1", events, arrows, eventTimings, offsetBusinessDays: 10 });

    const layout = layoutWorkspace([p]);
    expect(layout.projects).toHaveLength(1);
    const positions = layout.projects[0]!.positions;
    expect(positions.get("N0")).toEqual({ x: 10, row: 0 });
    expect(positions.get("Nz")).toEqual({ x: 13, row: 0 });
  });

  it("複数プロジェクトはオフセット昇順に縦へ積まれ、行数が累積する", () => {
    const single: Event[] = [{ id: "N0", number: 0 }];
    const singleTiming: EventTiming[] = [{ eventId: "N0", es: 0, ls: 0 }];

    const branching: Event[] = [
      { id: "N0", number: 0 },
      { id: "B", number: 1 },
      { id: "C", number: 2 },
    ];
    const branchingArrows: Arrow[] = [
      {
        from: "N0",
        to: "B",
        kind: "activity",
        taskId: "B",
        durationBusinessDays: 1,
        placeholder: false,
      },
      {
        from: "N0",
        to: "C",
        kind: "activity",
        taskId: "C",
        durationBusinessDays: 1,
        placeholder: false,
      },
    ];
    const branchingTiming: EventTiming[] = [
      { eventId: "N0", es: 0, ls: 0 },
      { eventId: "B", es: 1, ls: 1 },
      { eventId: "C", es: 1, ls: 1 },
    ];

    const later = project({
      key: "later",
      events: single,
      eventTimings: singleTiming,
      offsetBusinessDays: 20,
    });
    const earlier = project({
      key: "earlier",
      events: branching,
      arrows: branchingArrows,
      eventTimings: branchingTiming,
      offsetBusinessDays: 0,
    });

    const layout = layoutWorkspace([later, earlier]); // 読み込み順を意図的に逆にする

    expect(layout.projects.map((p) => p.projectKey)).toEqual(["earlier", "later"]); // offset昇順
    const earlierLayout = layout.projects[0]!;
    const laterLayout = layout.projects[1]!;
    expect(earlierLayout.topRow).toBe(0);
    expect(earlierLayout.rowCount).toBe(2); // B, Cが同一層で2行に分かれる
    expect(laterLayout.topRow).toBe(earlierLayout.rowCount); // 前のプロジェクトの行数分だけ下にずれる
  });

  it("イベント0件のプロジェクトはrowCount=0", () => {
    const p = project({ key: "empty" });
    const layout = layoutWorkspace([p]);
    expect(layout.projects[0]!.rowCount).toBe(0);
    expect(layout.projects[0]!.positions.size).toBe(0);
  });
});
