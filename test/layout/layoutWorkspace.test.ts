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

  it("クリティカルパスが複数ある場合、登場する担当者数が最小のパスが行0（最上段）になる", () => {
    // 経路1（N0→A→D）: 担当者2名。経路2（N0→B→D）: 担当者1名（最小のためbackboneに選ばれるべき）。
    const events: Event[] = [
      { id: "N0", number: 0 },
      { id: "A", number: 1 },
      { id: "B", number: 2 },
      { id: "D", number: 3 },
    ];
    const arrowN0A: Arrow = {
      from: "N0",
      to: "A",
      kind: "activity",
      taskId: "A",
      assignee: "Alice",
      durationBusinessDays: 1,
      placeholder: false,
    };
    const arrowAD: Arrow = {
      from: "A",
      to: "D",
      kind: "activity",
      taskId: "AD",
      assignee: "Bob",
      durationBusinessDays: 1,
      placeholder: false,
    };
    const arrowN0B: Arrow = {
      from: "N0",
      to: "B",
      kind: "activity",
      taskId: "B",
      assignee: "Carol",
      durationBusinessDays: 1,
      placeholder: false,
    };
    const arrowBD: Arrow = {
      from: "B",
      to: "D",
      kind: "activity",
      taskId: "BD",
      assignee: "Carol",
      durationBusinessDays: 1,
      placeholder: false,
    };
    const p = project({
      key: "p1",
      events,
      arrows: [arrowN0A, arrowAD, arrowN0B, arrowBD],
      eventTimings: events.map((e) => ({ eventId: e.id, es: 0, ls: 0 })),
      criticalPaths: [
        [arrowN0A, arrowAD], // 担当者2名（Alice, Bob）
        [arrowN0B, arrowBD], // 担当者1名（Carol）← こちらが最小
      ],
    });

    const layout = layoutWorkspace([p]);
    const positions = layout.projects[0]!.positions;
    expect(positions.get("B")!.row).toBe(0);
    expect(positions.get("D")!.row).toBe(0);
    expect(positions.get("A")!.row).not.toBe(0);
  });

  it("分岐内に内部フォークがあっても、最長パス（タスク数最多の鎖）は1行にまっすぐ通る", () => {
    // backbone: N0→B1→B2→D（クリティカル）。
    // 分岐: N0→L1→L2→L3→L4→D の4タスク鎖に、内部フォーク L1→F→L4 がぶら下がる。
    // 最長パス L1..L4 は同一行、フォーク F だけが別行になること。
    const events: Event[] = [
      { id: "N0", number: 0 },
      { id: "B1", number: 1 },
      { id: "L1", number: 2 },
      { id: "F", number: 3 },
      { id: "B2", number: 4 },
      { id: "L2", number: 5 },
      { id: "L3", number: 6 },
      { id: "L4", number: 7 },
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
    const arrowB2D = critical("B2", "D");
    const arrows: Arrow[] = [
      arrowN0B1,
      arrowB1B2,
      arrowB2D,
      dummy("N0", "L1"),
      dummy("L1", "L2"),
      dummy("L2", "L3"),
      dummy("L3", "L4"),
      dummy("L4", "D"),
      dummy("L1", "F"),
      dummy("F", "L4"),
    ];
    const p = project({
      key: "p1",
      events,
      arrows,
      eventTimings: events.map((e) => ({ eventId: e.id, es: 0, ls: 0 })),
      criticalPaths: [[arrowN0B1, arrowB1B2, arrowB2D]],
    });

    const layout = layoutWorkspace([p]);
    const positions = layout.projects[0]!.positions;
    const lRow = positions.get("L1")!.row;
    expect(lRow).not.toBe(0); // backbone ではない
    expect(positions.get("L2")!.row).toBe(lRow);
    expect(positions.get("L3")!.row).toBe(lRow);
    expect(positions.get("L4")!.row).toBe(lRow);
    expect(positions.get("F")!.row).not.toBe(lRow); // フォークだけ別行
  });

  it("接続ダミーが他タスクの実作業と同一行・X重複するとき、分岐が外側へ押し出される（修正2/3）", () => {
    // backbone: N0→B1→B2→B3→B4→Nz（クリティカル、各5営業日）。
    // 分岐P: N0⇢P1 →(TP,5)→ P2 ⇢Nz  … P2→Nz のダミーが行いっぱいに走る（X≈[5,24]）。
    // 分岐Q: B2⇢Q1 →(TQ,5)→ Q2 ⇢B4  … 層はPと重ならない（P:層1-2 / Q:層3-4）。
    // バンド判定だけなら Q は P と同じ行を共有できてしまうが、Qの TQ [10,15] が
    // Pの Nz行きダミー [5,24] と同一行で重なるので、Q は1つ外の行へ押し出される。
    const events: Event[] = [
      { id: "N0", number: 0 },
      { id: "B1", number: 1 },
      { id: "P1", number: 2 },
      { id: "B2", number: 3 },
      { id: "Q1", number: 4 },
      { id: "P2", number: 5 },
      { id: "B3", number: 6 },
      { id: "Q2", number: 7 },
      { id: "B4", number: 8 },
      { id: "Nz", number: 9 },
    ];
    const act = (from: EventId, to: EventId, taskId: string, d: number): Arrow => ({
      from,
      to,
      kind: "activity",
      taskId,
      durationBusinessDays: d,
      placeholder: false,
    });
    const dummy = (from: EventId, to: EventId): Arrow => ({
      from,
      to,
      kind: "dummy",
      durationBusinessDays: 0,
      placeholder: false,
    });
    const bk = [
      act("N0", "B1", "BK1", 5),
      act("B1", "B2", "BK2", 5),
      act("B2", "B3", "BK3", 5),
      act("B3", "B4", "BK4", 5),
      act("B4", "Nz", "BK5", 5),
    ];
    const arrows: Arrow[] = [
      ...bk,
      dummy("N0", "P1"),
      act("P1", "P2", "TP", 5),
      dummy("P2", "Nz"),
      dummy("B2", "Q1"),
      act("Q1", "Q2", "TQ", 5),
      dummy("Q2", "B4"),
    ];
    const es: Record<string, number> = {
      N0: 0,
      B1: 5,
      P1: 0,
      B2: 10,
      Q1: 10,
      P2: 5,
      B3: 15,
      Q2: 15,
      B4: 20,
      Nz: 25,
    };
    const p = project({
      key: "p1",
      events,
      arrows,
      eventTimings: events.map((e) => ({ eventId: e.id, es: es[e.id]!, ls: es[e.id]! })),
      criticalPaths: [bk],
    });

    const positions = layoutWorkspace([p]).projects[0]!.positions;
    const pRow = positions.get("P1")!.row;
    const qRow = positions.get("Q1")!.row;
    expect(pRow).toBe(1); // 最内の分岐行
    expect(qRow).toBe(pRow + 1); // 衝突を避けて1つ外へ（旧実装なら pRow と同じ）
    expect(positions.get("Q2")!.row).toBe(qRow);
  });

  it("複数の入辺ダミーを持つ合流イベントは、最も上のレーンの先行に揃う（修正4）", () => {
    // backbone: N0→BK→Nz（クリティカル）。
    // 分岐（1連結成分）: 長い鎖 fa⇢S1⇢S2⇢S3 がスパイン。fa/fb が mZ の先行（入辺は全てダミー）。
    // バリセンターだと mZ は fb と同じ行（rowStart+1）に落ちるが、
    // 最も上の先行 fa（rowStart+0）へ揃えるべき。
    const events: Event[] = [
      { id: "N0", number: 0 },
      { id: "fa", number: 1 },
      { id: "fb", number: 2 },
      { id: "BK", number: 3 },
      { id: "mZ", number: 4 },
      { id: "S1", number: 5 },
      { id: "ez", number: 6 },
      { id: "S2", number: 7 },
      { id: "S3", number: 8 },
      { id: "Nz", number: 9 },
    ];
    const act = (from: EventId, to: EventId, taskId: string): Arrow => ({
      from,
      to,
      kind: "activity",
      taskId,
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
    const bk = [act("N0", "BK", "BK1"), act("BK", "Nz", "BK2")];
    const arrows: Arrow[] = [
      ...bk,
      dummy("N0", "fa"),
      dummy("N0", "fb"),
      dummy("fa", "S1"),
      dummy("S1", "S2"),
      dummy("S2", "S3"),
      dummy("fa", "mZ"),
      dummy("fb", "mZ"),
      act("mZ", "ez", "TZ"),
      dummy("ez", "Nz"),
    ];
    const p = project({
      key: "p1",
      events,
      arrows,
      eventTimings: events.map((e) => ({ eventId: e.id, es: 0, ls: 0 })),
      criticalPaths: [bk],
    });

    const positions = layoutWorkspace([p]).projects[0]!.positions;
    const faRow = positions.get("fa")!.row;
    const fbRow = positions.get("fb")!.row;
    const mzRow = positions.get("mZ")!.row;
    expect(faRow).not.toBe(0); // 先行はbackboneではない
    expect(fbRow).toBe(faRow + 1); // fa が上、fb が下
    expect(mzRow).toBe(faRow); // 合流は最も上の先行（fa）に揃う
    expect(mzRow).toBeLessThan(fbRow);
  });
});
