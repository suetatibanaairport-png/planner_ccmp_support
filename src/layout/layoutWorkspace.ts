// 詳細設計書 6章の実装。X座標は機能仕様書 4.1.5 のグローバル営業日番号（相対ES＋プロジェクトオフセット）に
// 比例、Y座標はバリセンター法の簡易ヒューリスティックで確定する。ここでは営業日数単位のX・行番号単位のYと
// いう抽象座標のみを算出し、実ピクセルへの変換・ズーム倍率の適用は render/ 側の責務とする。
import type { Arrow, Event, EventId, Project } from "../types";

export interface NodePosition {
  x: number; // グローバル営業日番号（実数）
  row: number; // プロジェクト内の縦方向スロット（0起点）
}

export interface ProjectLayout {
  projectKey: string;
  fileName: string;
  isolated: boolean;
  topRow: number; // 全体を通した縦方向の開始行（0起点、プロジェクト間の境界線描画に用いる）
  rowCount: number; // このプロジェクトが占める行数
  positions: Map<EventId, NodePosition>;
}

export interface WorkspaceLayout {
  projects: ProjectLayout[]; // 表示順（基準日＝オフセット昇順。3.5.4/3.5.5参照）
}

/** 全読み込み済みプロジェクトのレイアウトを算出する。 */
export function layoutWorkspace(projects: readonly Project[]): WorkspaceLayout {
  const displayOrder = [...projects].sort((a, b) => {
    if (a.offsetBusinessDays !== b.offsetBusinessDays) {
      return a.offsetBusinessDays - b.offsetBusinessDays;
    }
    return a.key.localeCompare(b.key, "en");
  });

  const result: ProjectLayout[] = [];
  let nextTopRow = 0;

  for (const project of displayOrder) {
    const esByEventId = new Map(project.eventTimings.map((t) => [t.eventId, t.es]));
    const rows = layoutProjectRows(
      project.events,
      project.arrows,
      project.criticalPaths,
      esByEventId,
    );
    const rowCount = rows.size === 0 ? 0 : Math.max(...rows.values()) + 1;

    const positions = new Map<EventId, NodePosition>();
    for (const event of project.events) {
      const es = esByEventId.get(event.id) ?? 0;
      positions.set(event.id, {
        x: es + project.offsetBusinessDays,
        row: rows.get(event.id) ?? 0,
      });
    }

    result.push({
      projectKey: project.key,
      fileName: project.fileName,
      isolated: project.isolated,
      topRow: nextTopRow,
      rowCount,
      positions,
    });
    nextTopRow += rowCount;
  }

  return { projects: result };
}

/**
 * 代表クリティカルパスが通る全イベントIDを集める。複数存在する場合は、登場する担当者数
 * （重複除く）が最小のパスを代表として選ぶ（同数の場合はcriticalPaths内の出現順で先勝ち）。
 */
function criticalBackboneEventIds(criticalPaths: Project["criticalPaths"]): Set<EventId> {
  const backbone = selectBackbonePath(criticalPaths);
  if (!backbone) return new Set();

  const ids = new Set<EventId>();
  for (const arrow of backbone) {
    ids.add(arrow.from);
    ids.add(arrow.to);
  }
  return ids;
}

/** 複数のクリティカルパスから、登場する担当者数（重複除く）が最小の1本を選ぶ。 */
function selectBackbonePath(
  criticalPaths: Project["criticalPaths"],
): Project["criticalPaths"][number] | undefined {
  let best: Project["criticalPaths"][number] | undefined;
  let bestAssigneeCount = Infinity;
  for (const path of criticalPaths) {
    const assignees = new Set(
      path.map((a) => a.assignee).filter((a): a is string => a !== undefined),
    );
    if (assignees.size < bestAssigneeCount) {
      best = path;
      bestAssigneeCount = assignees.size;
    }
  }
  return best;
}

// ponytail: render/renderDiagram.ts の DIAGONAL_RUN(24px) / DEFAULT_DIAGRAM_CONFIG.pixelsPerDay(24) = 1。
// エルボーの斜め区間を営業日単位で表したもの。pixelsPerDay を変えるなら両方合わせること。
const RUN_DAYS = 1;

/** アローの「実際に水平に描かれる区間」を占有主体つきで表す（衝突判定用）。 */
interface OwnedSeg {
  row: number;
  xStart: number;
  xEnd: number;
  owner: string;
}

/** 同一タスクの分割エッジをまとめて扱うための占有主体キー。 */
function ownerOf(a: Arrow): string {
  return a.taskId ?? `${a.from}»${a.to}`;
}

/**
 * `render/renderDiagram.ts` の `elbowPoints` が実際に水平に引く区間だけを返す（斜めは無視）。
 * 通常の矢線は終点行 r2 に `[x1+run, x2]`、ダミーは先行行 r1 に `[x1, x2-run]`、同一行なら `[min,max]`。
 */
function horizontalRun(
  x1: number,
  r1: number,
  x2: number,
  r2: number,
  isDummy: boolean,
): { row: number; xStart: number; xEnd: number } {
  if (r1 === r2) {
    return { row: r1, xStart: Math.min(x1, x2), xEnd: Math.max(x1, x2) };
  }
  const run = Math.min(RUN_DAYS, Math.abs(x2 - x1) / 2);
  if (isDummy) {
    const a = x1;
    const b = x2 - run;
    return { row: r1, xStart: Math.min(a, b), xEnd: Math.max(a, b) };
  }
  const a = x1 + run;
  const b = x2;
  return { row: r2, xStart: Math.min(a, b), xEnd: Math.max(a, b) };
}

/** 別タスク同士が同一行でX方向に（端点接触を除き）重なるか。 */
function segCollide(a: OwnedSeg, b: OwnedSeg): boolean {
  return a.row === b.row && a.owner !== b.owner && a.xStart < b.xEnd && b.xStart < a.xEnd;
}

/**
 * ある分岐を rowStart で配置したときに描かれる水平区間を集める。分岐内アローに加え、
 * backbone へ繋ぐ接続ダミーも含める（接続アローが実作業なら終点レーンを共有するのは正当なので除外）。
 * backbone 行（< minRowStart）を走る区間は押し出しで解消できないので除外する。
 */
function branchSegments(
  branchIdSet: ReadonlySet<EventId>,
  arrows: Project["arrows"],
  esByEventId: ReadonlyMap<EventId, number>,
  rowOf: (id: EventId) => number,
  minRowStart: number,
): OwnedSeg[] {
  const out: OwnedSeg[] = [];
  for (const a of arrows) {
    const inFrom = branchIdSet.has(a.from);
    const inTo = branchIdSet.has(a.to);
    if (!inFrom && !inTo) continue;
    if (inFrom !== inTo && a.kind !== "dummy") continue;
    const h = horizontalRun(
      esByEventId.get(a.from) ?? 0,
      rowOf(a.from),
      esByEventId.get(a.to) ?? 0,
      rowOf(a.to),
      a.kind === "dummy",
    );
    if (h.row < minRowStart) continue;
    out.push({ ...h, owner: ownerOf(a) });
  }
  return out;
}

/**
 * プロジェクト内イベントの縦方向スロットを求める（詳細設計書6章）。
 * 代表クリティカルパス（selectBackbonePathで選んだbackbone）は行0に固定して一直線に配置する。
 * backbone以外のイベントは、backboneを経由しない矢線でつながった連結成分＝「分岐」ごとに
 * 1つの行帯を専有する。分岐は、短いものから順にbackboneに最も近い空き行へ詰めるが、
 * バンド矩形（行×層）が重ならないだけでなく、**実際に描かれるアローの水平区間**が別タスクの
 * 区間と同一行で重ならない行を選ぶ（接続ダミー含む。修正2/3）。分岐内部は最長パスをローカル行0に
 * 固定し残りをバリセンター法で配置する（computeRowsForSubgraph）。最後に、複数の入辺ダミーを持つ
 * 合流イベントを最も上のレーンの先行に揃える（realignMergeEvents。修正4）。
 */
function layoutProjectRows(
  events: readonly Event[],
  arrows: Project["arrows"],
  criticalPaths: Project["criticalPaths"],
  esByEventId: ReadonlyMap<EventId, number>,
): Map<EventId, number> {
  if (events.length === 0) return new Map();

  const backboneIds = criticalBackboneEventIds(criticalPaths);
  const numberOf = new Map(events.map((e) => [e.id, e.number]));
  const layerOf = computeLayerOf(events, arrows);
  const eventById = new Map(events.map((e) => [e.id, e]));

  const order = new Map<EventId, number>();
  for (const id of backboneIds) order.set(id, 0);

  const branches = groupNonBackboneBranches(events, arrows, backboneIds).map((branchIds) => {
    const branchIdSet = new Set(branchIds);
    const branchEvents = branchIds.map((id) => eventById.get(id)!);
    const branchArrows = arrows.filter((a) => branchIdSet.has(a.from) && branchIdSet.has(a.to));
    const localRows = computeRowsForSubgraph(branchEvents, branchArrows);
    const width = localRows.size === 0 ? 0 : Math.max(...localRows.values()) + 1;
    const layers = branchIds.map((id) => layerOf.get(id) ?? 0);
    const minLayer = Math.min(...layers);
    const maxLayer = Math.max(...layers);
    return {
      branchIds,
      branchIdSet,
      localRows,
      width,
      length: maxLayer - minLayer,
      minLayer,
      maxLayer,
      minNumber: Math.min(...branchIds.map((id) => numberOf.get(id) ?? 0)),
    };
  });

  // 短い分岐（backboneから分離して合流するまでが短いもの）から順にbackboneの近くへ詰める。
  branches.sort((a, b) => {
    if (a.length !== b.length) return a.length - b.length;
    if (a.minLayer !== b.minLayer) return a.minLayer - b.minLayer;
    return a.minNumber - b.minNumber;
  });

  const minRowStart = backboneIds.size > 0 ? 1 : 0;
  const placedBands: PlacedBand[] = [];

  // ponytail: minRowStart>=1 の間は backbone 区間が occ に入っても分岐と同一行になり得ず実質不発。
  // 仕様整合と対称性のため保持する。
  const occ: OwnedSeg[] = [];
  for (const a of arrows) {
    if (a.kind !== "activity") continue;
    if ((order.get(a.from) ?? -1) !== 0 || (order.get(a.to) ?? -1) !== 0) continue;
    const h = horizontalRun(esByEventId.get(a.from) ?? 0, 0, esByEventId.get(a.to) ?? 0, 0, false);
    occ.push({ ...h, owner: ownerOf(a) });
  }

  for (const branch of branches) {
    const outerEdge = placedBands.reduce((max, band) => Math.max(max, band.rowEnd), minRowStart);
    let chosen = outerEdge;
    let chosenSegs: OwnedSeg[] = [];
    for (let rowStart = minRowStart; rowStart <= outerEdge; rowStart++) {
      const rowEnd = rowStart + branch.width;
      if (
        rowStart < outerEdge &&
        placedBands.some((band) =>
          overlaps(band, rowStart, rowEnd, branch.minLayer, branch.maxLayer),
        )
      ) {
        continue;
      }
      const rowOf = (id: EventId): number =>
        branch.branchIdSet.has(id)
          ? rowStart + (branch.localRows.get(id) ?? 0)
          : (order.get(id) ?? 0);
      const segs = branchSegments(branch.branchIdSet, arrows, esByEventId, rowOf, minRowStart);
      const collides = segs.some((s) => occ.some((o) => segCollide(s, o)));
      chosenSegs = segs;
      if (!collides) {
        chosen = rowStart;
        break;
      }
    }
    for (const id of branch.branchIds) {
      order.set(id, chosen + (branch.localRows.get(id) ?? 0));
    }
    placedBands.push({
      rowStart: chosen,
      rowEnd: chosen + branch.width,
      minLayer: branch.minLayer,
      maxLayer: branch.maxLayer,
    });
    occ.push(...chosenSegs);
  }

  realignMergeEvents(events, arrows, order, backboneIds);
  bumpCollidingArrows(arrows, order, esByEventId, backboneIds, minRowStart);

  return order;
}

/**
 * 修正2: 分岐配置後もダミー矢線と別タスクの実作業矢線が同一行で重なる箇所を、
 * 「後続タスクを1つ下のレーンへ移す」で解消する。実作業の終点イベント（backbone でない）と、
 * その終点と同じ行にある下流イベントの部分木を +1 する。行は単調増加なので有限回で停止する
 * （MAX_ITER で打ち切り。row0＝backbone を走るダミーは押し出し不能なので対象外）。
 */
function bumpCollidingArrows(
  arrows: Project["arrows"],
  order: Map<EventId, number>,
  esByEventId: ReadonlyMap<EventId, number>,
  backboneIds: ReadonlySet<EventId>,
  minRowStart: number,
): void {
  // 行は毎回 +1 しか動かないので有限回で必ず停止する。安全弁として辺数の数倍で打ち切る。
  const MAX_ITER = Math.max(64, arrows.length * 4);
  const successorsOf = new Map<EventId, EventId[]>();
  for (const a of arrows) {
    const list = successorsOf.get(a.from) ?? [];
    list.push(a.to);
    successorsOf.set(a.from, list);
  }
  const segOf = (a: Arrow): OwnedSeg => ({
    ...horizontalRun(
      esByEventId.get(a.from) ?? 0,
      order.get(a.from) ?? 0,
      esByEventId.get(a.to) ?? 0,
      order.get(a.to) ?? 0,
      a.kind === "dummy",
    ),
    owner: ownerOf(a),
  });

  for (let iter = 0; iter < MAX_ITER; iter++) {
    const segs = arrows.map((a) => ({ a, seg: segOf(a) }));
    let target: EventId | null = null;
    outer: for (const { a: da, seg: ds } of segs) {
      if (da.kind !== "dummy" || ds.row < minRowStart) continue;
      for (const { a: aa, seg: as } of segs) {
        if (aa.kind !== "activity") continue;
        if (as.row !== ds.row || as.owner === ds.owner) continue;
        if (!(ds.xStart < as.xEnd && as.xStart < ds.xEnd)) continue;
        if (as.xEnd - Math.max(ds.xStart, as.xStart) <= 0.5) continue; // 端点接触は無視
        if (!backboneIds.has(aa.to)) {
          target = aa.to;
          break outer;
        }
        // 実作業の終点が backbone なら、ダミー側の非 backbone 端点を下げる（修正3の補助）。
        for (const cand of [da.to, da.from]) {
          if (!backboneIds.has(cand) && (order.get(cand) ?? 0) === ds.row) {
            target = cand;
            break outer;
          }
        }
      }
    }
    if (target === null) break;

    const oldRow = order.get(target) ?? 0;
    const stack: EventId[] = [target];
    const seen = new Set<EventId>();
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (seen.has(id) || backboneIds.has(id)) continue;
      if ((order.get(id) ?? 0) !== oldRow) continue;
      seen.add(id);
      order.set(id, oldRow + 1);
      for (const nx of successorsOf.get(id) ?? []) stack.push(nx);
    }
    if (seen.size === 0) break; // 何も動かせなければ打ち切り（残りは既知の限界）
  }
}

/**
 * 複数の先行タスクから合流するタスク（入辺2本以上が全てダミー・出辺1本以上、backbone でない）は、
 * 最も上のレーンにある先行の行に揃える（修正4）。下流イベントの行は据え置き＝斜め線がタスクに
 * 重なることは許容。ponytail: 合流の連鎖は events 順の1パス（不動点反復しない）。多段合流の実例が出たら見直す。
 */
function realignMergeEvents(
  events: readonly Event[],
  arrows: Project["arrows"],
  order: Map<EventId, number>,
  backboneIds: ReadonlySet<EventId>,
): void {
  const incoming = new Map<EventId, Arrow[]>();
  const outDegree = new Map<EventId, number>();
  for (const a of arrows) {
    const list = incoming.get(a.to) ?? [];
    list.push(a);
    incoming.set(a.to, list);
    outDegree.set(a.from, (outDegree.get(a.from) ?? 0) + 1);
  }
  for (const e of events) {
    if (backboneIds.has(e.id)) continue;
    const ins = incoming.get(e.id) ?? [];
    if (ins.length < 2 || (outDegree.get(e.id) ?? 0) === 0) continue;
    if (!ins.every((a) => a.kind === "dummy")) continue;
    order.set(e.id, Math.min(...ins.map((a) => order.get(a.from) ?? 0)));
  }
}

interface PlacedBand {
  rowStart: number;
  rowEnd: number; // 排他的境界
  minLayer: number;
  maxLayer: number;
}

/** 行範囲・層範囲がともに重なっているかを判定する。 */
function overlaps(
  band: PlacedBand,
  rowStart: number,
  rowEnd: number,
  minLayer: number,
  maxLayer: number,
): boolean {
  const rowsOverlap = rowStart < band.rowEnd && band.rowStart < rowEnd;
  const layersOverlap = minLayer <= band.maxLayer && band.minLayer <= maxLayer;
  return rowsOverlap && layersOverlap;
}

/** backboneに属さないイベントを、backboneを経由しない矢線でつながったグループ（分岐）に分ける。 */
function groupNonBackboneBranches(
  events: readonly Event[],
  arrows: Project["arrows"],
  backboneIds: ReadonlySet<EventId>,
): EventId[][] {
  const nonBackbone = events.filter((e) => !backboneIds.has(e.id));
  const parent = new Map<EventId, EventId>();
  for (const e of nonBackbone) parent.set(e.id, e.id);

  const find = (id: EventId): EventId => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    return root;
  };
  const union = (a: EventId, b: EventId): void => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootA, rootB);
  };

  for (const a of arrows) {
    if (!backboneIds.has(a.from) && !backboneIds.has(a.to)) union(a.from, a.to);
  }

  const groups = new Map<EventId, EventId[]>();
  for (const e of nonBackbone) {
    const root = find(e.id);
    const arr = groups.get(root) ?? [];
    arr.push(e.id);
    groups.set(root, arr);
  }
  return [...groups.values()];
}

/**
 * イベント集合の縦方向スロットを求める。まず分岐内の「最長パス」（経路上のタスク数＝辺数が
 * 最多の1本。project 単位の selectBackbonePath の分岐版）をローカル行0に固定し、残りのイベントは
 * バリセンター法で周囲に配置する。ESが等しいイベント同士（同じX位置）を「層」とみなし、隣接層の
 * 平均位置に基づいて前進・後進を交互に繰り返し並べ替える。層内での位置がそのままスロット番号になる。
 * 最長パスを固定することで、分岐した複数タスクの鎖が行をまたいで折れ曲がるのを防ぐ。
 */
function computeRowsForSubgraph(
  events: readonly Event[],
  arrows: Project["arrows"],
): Map<EventId, number> {
  if (events.length === 0) return new Map();

  const numberOf = new Map<EventId, number>();
  for (const e of events) numberOf.set(e.id, e.number);

  const predecessors = new Map<EventId, EventId[]>();
  const successors = new Map<EventId, EventId[]>();
  for (const e of events) {
    predecessors.set(e.id, []);
    successors.set(e.id, []);
  }
  for (const a of arrows) {
    predecessors.get(a.to)?.push(a.from);
    successors.get(a.from)?.push(a.to);
  }

  // 層分け: 実際のES（所要日数の重み付き最早時刻）は呼び出し元でX座標として別途用いるため、
  // ここでの層は依存関係の到達可能性（最長経路長、重みなし）で近似する。
  const layers = groupByLayer(events, arrows);
  const spine = longestPathEventIds(events, arrows);

  const order = new Map<EventId, number>();
  for (const layer of layers) {
    assignRowsByOrder(layer, (id) => numberOf.get(id)!, order, spine);
  }

  const PASSES = 4;
  for (let pass = 0; pass < PASSES; pass++) {
    const forward = pass % 2 === 0;
    const iterLayers = forward ? layers : [...layers].reverse();
    const neighborsOf = forward ? predecessors : successors;
    for (const layer of iterLayers) {
      const barycenter = new Map<EventId, number>();
      for (const id of layer) {
        const neighbors = neighborsOf.get(id) ?? [];
        if (neighbors.length === 0) {
          barycenter.set(id, order.get(id) ?? 0);
        } else {
          const sum = neighbors.reduce((acc, n) => acc + (order.get(n) ?? 0), 0);
          barycenter.set(id, sum / neighbors.length);
        }
      }
      assignRowsByOrder(layer, (id) => barycenter.get(id) ?? 0, order, spine);
    }
  }

  return order;
}

/**
 * 層内を keyOf 昇順に並べ、その順番をそのまま行番号として確定する。spine に含まれるイベントは
 * 常にローカル行0へ固定し、並べ替え対象から外す（層に spine 要素があれば残りは行1から採番）。
 */
function assignRowsByOrder(
  layer: EventId[],
  keyOf: (id: EventId) => number,
  order: Map<EventId, number>,
  spine?: ReadonlySet<EventId>,
): void {
  const pinned = spine ? layer.filter((id) => spine.has(id)) : [];
  const rest = spine ? layer.filter((id) => !spine.has(id)) : layer;
  for (const id of pinned) order.set(id, 0);
  rest.sort((a, b) => keyOf(a) - keyOf(b));
  const base = pinned.length > 0 ? 1 : 0;
  rest.forEach((id, idx) => order.set(id, base + idx));
}

/**
 * サブグラフ（DAG）の最長パス上のイベント集合を返す。「最長」＝経路上の辺数（タスク数）が最多。
 * 同数は経路上の実作業所要日数合計が大きい方 → 直前イベントのID順で決定的に選ぶ。
 */
function longestPathEventIds(events: readonly Event[], arrows: Project["arrows"]): Set<EventId> {
  const byNumber = [...events].sort((a, b) => a.number - b.number);
  const incoming = new Map<EventId, Arrow[]>();
  for (const e of events) incoming.set(e.id, []);
  for (const a of arrows) incoming.get(a.to)?.push(a);

  const dist = new Map<EventId, number>(); // そのイベントで終わる最長パスの辺数
  const dur = new Map<EventId, number>(); // 同パス上の実作業所要日数の合計
  const parent = new Map<EventId, EventId | null>();
  for (const e of byNumber) {
    let bestDist = 0;
    let bestDur = 0;
    let bestParent: EventId | null = null;
    for (const a of incoming.get(e.id) ?? []) {
      const d = (dist.get(a.from) ?? 0) + 1;
      const w = (dur.get(a.from) ?? 0) + a.durationBusinessDays;
      const better =
        d > bestDist ||
        (d === bestDist && w > bestDur) ||
        (d === bestDist && w === bestDur && (bestParent === null || a.from < bestParent));
      if (better) {
        bestDist = d;
        bestDur = w;
        bestParent = a.from;
      }
    }
    dist.set(e.id, bestDist);
    dur.set(e.id, bestDur);
    parent.set(e.id, bestParent);
  }

  let end = byNumber[0]?.id;
  if (end === undefined) return new Set();
  for (const e of byNumber) {
    const d = dist.get(e.id) ?? 0;
    const de = dist.get(end) ?? 0;
    if (d > de || (d === de && (dur.get(e.id) ?? 0) > (dur.get(end) ?? 0))) end = e.id;
  }

  const path = new Set<EventId>();
  let cur: EventId | null | undefined = end;
  while (cur !== null && cur !== undefined) {
    path.add(cur);
    cur = parent.get(cur);
  }
  return path;
}

/** イベントごとの層番号（トポロジカル順の最長経路長による近似）を求める。 */
function computeLayerOf(events: readonly Event[], arrows: Project["arrows"]): Map<EventId, number> {
  const byNumber = [...events].sort((a, b) => a.number - b.number);
  const incoming = new Map<EventId, EventId[]>();
  for (const e of events) incoming.set(e.id, []);
  for (const a of arrows) incoming.get(a.to)?.push(a.from);

  const layerOf = new Map<EventId, number>();
  for (const e of byNumber) {
    const ins = incoming.get(e.id) ?? [];
    if (ins.length === 0) {
      layerOf.set(e.id, 0);
      continue;
    }
    let max = 0;
    for (const p of ins) {
      const candidate = (layerOf.get(p) ?? 0) + 1;
      if (candidate > max) max = candidate;
    }
    layerOf.set(e.id, max);
  }
  return layerOf;
}

/** イベントを層（同一ES相当のグループ）に分ける。層番号はトポロジカル順の最長経路長で近似する。 */
function groupByLayer(events: readonly Event[], arrows: Project["arrows"]): EventId[][] {
  const byNumber = [...events].sort((a, b) => a.number - b.number);
  const layerOf = computeLayerOf(events, arrows);

  const byLayer = new Map<number, EventId[]>();
  for (const e of byNumber) {
    const layer = layerOf.get(e.id) ?? 0;
    const arr = byLayer.get(layer) ?? [];
    arr.push(e.id);
    byLayer.set(layer, arr);
  }
  return [...byLayer.keys()].sort((a, b) => a - b).map((k) => byLayer.get(k)!);
}
