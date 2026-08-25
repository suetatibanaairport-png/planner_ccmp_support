import { describe, expect, it } from "vitest";
import { layoutWorkspace } from "../../src/layout/layoutWorkspace";
import type { Arrow, Event, EventId, EventTiming, Project } from "../../src/types";

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

  it("クリティカルパス上のイベントは行0に一直線で配置される", () => {
    const events: Event[] = [
      { id: "N0", number: 0 },
      { id: "C", number: 1 }, // 非クリティカル。番号がBより若いのでpinなしだと行0を取ってしまう
      { id: "B", number: 2 }, // クリティカル
      { id: "D", number: 3 },
    ];
    const arrowNC: Arrow = {
      from: "N0",
      to: "C",
      kind: "activity",
      taskId: "C",
      durationBusinessDays: 1,
      placeholder: false,
    };
    const arrowNB: Arrow = {
      from: "N0",
      to: "B",
      kind: "activity",
      taskId: "B",
      durationBusinessDays: 5,
      placeholder: false,
    };
    const arrowCD: Arrow = {
      from: "C",
      to: "D",
      kind: "activity",
      taskId: "CD",
      durationBusinessDays: 1,
      placeholder: false,
    };
    const arrowBD: Arrow = {
      from: "B",
      to: "D",
      kind: "activity",
      taskId: "BD",
      durationBusinessDays: 1,
      placeholder: false,
    };
    const eventTimings: EventTiming[] = [
      { eventId: "N0", es: 0, ls: 0 },
      { eventId: "C", es: 1, ls: 5 },
      { eventId: "B", es: 5, ls: 5 },
      { eventId: "D", es: 6, ls: 6 },
    ];
    const p = project({
      key: "p1",
      events,
      arrows: [arrowNC, arrowNB, arrowCD, arrowBD],
      eventTimings,
      criticalPaths: [[arrowNB, arrowBD]],
    });

    const layout = layoutWorkspace([p]);
    const positions = layout.projects[0]!.positions;
    expect(positions.get("N0")!.row).toBe(0);
    expect(positions.get("B")!.row).toBe(0);
    expect(positions.get("D")!.row).toBe(0);
    expect(positions.get("C")!.row).not.toBe(0);
  });

  it("ダミー矢線の分岐も、分離してから合流するまで同じ1行に配置される", () => {
    // backbone: N0→B1→B2→D（クリティカル）。分岐: N0→X1→X2→D（ダミー矢線のみ）。
    const events: Event[] = [
      { id: "N0", number: 0 },
      { id: "B1", number: 1 },
      { id: "X1", number: 2 },
      { id: "B2", number: 3 },
      { id: "X2", number: 4 },
      { id: "D", number: 5 },
    ];
    const arrowN0B1: Arrow = {
      from: "N0",
      to: "B1",
      kind: "activity",
      taskId: "B1",
      durationBusinessDays: 3,
      placeholder: false,
    };
    const arrowB1B2: Arrow = {
      from: "B1",
      to: "B2",
      kind: "activity",
      taskId: "B2",
      durationBusinessDays: 2,
      placeholder: false,
    };
    const arrowB2D: Arrow = {
      from: "B2",
      to: "D",
      kind: "activity",
      taskId: "B2D",
      durationBusinessDays: 1,
      placeholder: false,
    };
    const arrowN0X1: Arrow = {
      from: "N0",
      to: "X1",
      kind: "dummy",
      durationBusinessDays: 0,
      placeholder: false,
    };
    const arrowX1X2: Arrow = {
      from: "X1",
      to: "X2",
      kind: "dummy",
      durationBusinessDays: 0,
      placeholder: false,
    };
    const arrowX2D: Arrow = {
      from: "X2",
      to: "D",
      kind: "dummy",
      durationBusinessDays: 0,
      placeholder: false,
    };
    const p = project({
      key: "p1",
      events,
      arrows: [arrowN0B1, arrowB1B2, arrowB2D, arrowN0X1, arrowX1X2, arrowX2D],
      eventTimings: events.map((e) => ({ eventId: e.id, es: 0, ls: 0 })),
      criticalPaths: [[arrowN0B1, arrowB1B2, arrowB2D]],
    });

    const layout = layoutWorkspace([p]);
    const positions = layout.projects[0]!.positions;
    expect(positions.get("X1")!.row).toBe(positions.get("X2")!.row);
    expect(positions.get("X1")!.row).not.toBe(0);
  });

  it("backboneから分離して合流するまでが長い分岐ほど、backboneから遠い行に配置される", () => {
    // backbone: N0→B1→B2→B3→D（クリティカル）。
    // 短い分岐: N0→S→D（1イベント）。長い分岐: N0→L1→L2→L3→D（3イベントの連鎖）。
    // イベント定義順はあえて長い分岐（L1〜L3）を短い分岐（S）より前に置く。連結成分の発見順に
    // 依存する実装（＝長さでソートし忘れたバグ）だとこの並びではSの方が遠い行に置かれてしまうため、
    // 長さによる正しい並べ替えが行われていることをこの順序依存性で検証する。
    const events: Event[] = [
      { id: "N0", number: 0 },
      { id: "B1", number: 1 },
      { id: "L1", number: 2 },
      { id: "B2", number: 3 },
      { id: "L2", number: 4 },
      { id: "B3", number: 5 },
      { id: "L3", number: 6 },
      { id: "S", number: 7 },
      { id: "D", number: 8 },
    ];
    const critical = (from: EventId, to: EventId): Arrow => ({
      from,
      to,
      kind: "activity",
      taskId: `${from}-${to}`,
      durationBusinessDays: 1,
      placeholder: false,
    });
    const dummy = (from: EventId, to: EventId): Arrow => ({
      from,
      to,
      kind: "dummy",
      durationBusinessDays: 0,
      placeholder: false,
    });
    const arrowN0B1 = critical("N0", "B1");
    const arrowB1B2 = critical("B1", "B2");
    const arrowB2B3 = critical("B2", "B3");
    const arrowB3D = critical("B3", "D");
    const arrows: Arrow[] = [
      arrowN0B1,
      arrowB1B2,
      arrowB2B3,
      arrowB3D,
      dummy("N0", "S"),
      dummy("S", "D"),
      dummy("N0", "L1"),
      dummy("L1", "L2"),
      dummy("L2", "L3"),
      dummy("L3", "D"),
    ];
    const p = project({
      key: "p1",
      events,
      arrows,
      eventTimings: events.map((e) => ({ eventId: e.id, es: 0, ls: 0 })),
      criticalPaths: [[arrowN0B1, arrowB1B2, arrowB2B3, arrowB3D]],
    });

    const layout = layoutWorkspace([p]);
    const positions = layout.projects[0]!.positions;
    const sRow = positions.get("S")!.row;
    const lRow = positions.get("L1")!.row;
    expect(sRow).not.toBe(0);
    expect(lRow).not.toBe(0);
    expect(lRow).toBeGreaterThan(sRow);
    expect(positions.get("L2")!.row).toBe(lRow);
    expect(positions.get("L3")!.row).toBe(lRow);
  });

  it("backboneから見て時間的に重ならない2つの分岐は、同じ行を共有する", () => {
    // backbone: N0→B1→B2→B3→D。分岐P: N0→P→D（前半区間で分離・合流）。
    // 分岐Q: B2→Q→D（後半区間で分離・合流）。PとQは層の範囲が重ならないため、
    // 常に新しい帯を追加するだけの実装では別々の行に、行を再利用する実装では同じ行になる。
    const events: Event[] = [
      { id: "N0", number: 0 },
      { id: "B1", number: 1 },
      { id: "P", number: 2 },
      { id: "B2", number: 3 },
      { id: "Q", number: 4 },
      { id: "B3", number: 5 },
      { id: "D", number: 6 },
    ];
    const critical = (from: EventId, to: EventId): Arrow => ({
      from,
      to,
      kind: "activity",
      taskId: `${from}-${to}`,
      durationBusinessDays: 1,
      placeholder: false,
    });
    const dummy = (from: EventId, to: EventId): Arrow => ({
      from,
      to,
      kind: "dummy",
      durationBusinessDays: 0,
      placeholder: false,
    });
    const arrowN0B1 = critical("N0", "B1");
    const arrowB1B2 = critical("B1", "B2");
    const arrowB2B3 = critical("B2", "B3");
    const arrowB3D = critical("B3", "D");
    const arrows: Arrow[] = [
      arrowN0B1,
      arrowB1B2,
      arrowB2B3,
      arrowB3D,
      dummy("N0", "P"),
      dummy("P", "D"),
      dummy("B2", "Q"),
      dummy("Q", "D"),
    ];
    const p = project({
      key: "p1",
      events,
      arrows,
      eventTimings: events.map((e) => ({ eventId: e.id, es: 0, ls: 0 })),
      criticalPaths: [[arrowN0B1, arrowB1B2, arrowB2B3, arrowB3D]],
    });

    const layout = layoutWorkspace([p]);
    const positions = layout.projects[0]!.positions;
    const pRow = positions.get("P")!.row;
    const qRow = positions.get("Q")!.row;
    expect(pRow).not.toBe(0);
    expect(qRow).toBe(pRow);
  });
});
