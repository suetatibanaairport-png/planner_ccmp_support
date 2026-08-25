// 詳細設計書 6章の実装。X座標は機能仕様書 4.1.5 のグローバル営業日番号（相対ES＋プロジェクトオフセット）に
// 比例、Y座標はバリセンター法の簡易ヒューリスティックで確定する。ここでは営業日数単位のX・行番号単位のYと
// いう抽象座標のみを算出し、実ピクセルへの変換・ズーム倍率の適用は render/ 側の責務とする。
import type { Event, EventId, Project } from "../types";

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
    const rows = layoutProjectRows(project.events, project.arrows, project.criticalPaths);
    const rowCount = rows.size === 0 ? 0 : Math.max(...rows.values()) + 1;
    const esByEventId = new Map(project.eventTimings.map((t) => [t.eventId, t.es]));

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

/** 最初のクリティカルパス（criticalPaths[0]）が通る全イベントIDを集める。複数存在する場合は代表1本のみを扱う。 */
function criticalBackboneEventIds(criticalPaths: Project["criticalPaths"]): Set<EventId> {
  const backbone = criticalPaths[0];
  if (!backbone) return new Set();

  const ids = new Set<EventId>();
  for (const arrow of backbone) {
    ids.add(arrow.from);
    ids.add(arrow.to);
  }
  return ids;
}

/**
 * プロジェクト内イベントの縦方向スロットを求める（詳細設計書6章）。
 * 代表クリティカルパス（criticalPaths[0]、backbone）は行0に固定して一直線に配置する。
 * backbone以外のイベントは、backboneを経由しない矢線でつながった連結成分＝「分岐」ごとに
 * 1つの行帯を専有する。分岐が占める層の範囲（分離してから合流するまでの長さの近似）が
 * 短いものから順に、backboneに最も近い空き行（findInnerRowStart）へ詰める。層の範囲が
 * 重ならない分岐同士は同じ行を共有し、重なる場合のみ外側へ新しい帯を追加する。分岐内部の
 * 並びは通常のバリセンター法（computeRowsForSubgraph）で決める。
 */
function layoutProjectRows(
  events: readonly Event[],
  arrows: Project["arrows"],
  criticalPaths: Project["criticalPaths"],
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
  for (const branch of branches) {
    const rowStart = findInnerRowStart(
      placedBands,
      branch.width,
      branch.minLayer,
      branch.maxLayer,
      minRowStart,
    );
    for (const id of branch.branchIds) {
      order.set(id, rowStart + (branch.localRows.get(id) ?? 0));
    }
    placedBands.push({
      rowStart,
      rowEnd: rowStart + branch.width,
      minLayer: branch.minLayer,
      maxLayer: branch.maxLayer,
    });
  }

  return order;
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

/**
 * backboneに最も近い（＝最小の）行のうち、配置済みのどの分岐とも
 * （行範囲・層範囲の両方で）重ならない開始行を探す。層の範囲が重ならない分岐同士は
 * 同じ行を共有できるため、時間的に重ならない分岐が行を再利用できるようになる。
 * 空きがなければ、配置済み全体の外側（最大rowEnd）に新しい帯を追加する。
 */
function findInnerRowStart(
  placedBands: readonly PlacedBand[],
  width: number,
  minLayer: number,
  maxLayer: number,
  minRowStart: number,
): number {
  const outerEdge = placedBands.reduce((max, band) => Math.max(max, band.rowEnd), minRowStart);
  for (let rowStart = minRowStart; rowStart < outerEdge; rowStart++) {
    const rowEnd = rowStart + width;
    const conflict = placedBands.some((band) =>
      overlaps(band, rowStart, rowEnd, minLayer, maxLayer),
    );
    if (!conflict) return rowStart;
  }
  return outerEdge;
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
 * イベント集合の縦方向スロットをバリセンター法で求める。ESが等しいイベント同士（同じX位置）を
 * 「層」とみなし、隣接層の平均位置に基づいて前進・後進を交互に繰り返し並べ替える。
 * 層内での位置がそのままスロット番号になる。
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

  const order = new Map<EventId, number>();
  for (const layer of layers) {
    assignRowsByOrder(layer, (id) => numberOf.get(id)!, order);
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
      assignRowsByOrder(layer, (id) => barycenter.get(id) ?? 0, order);
    }
  }

  return order;
}

/** 層内をkeyOf昇順に並べ、その順番をそのまま行番号として確定する。 */
function assignRowsByOrder(
  layer: EventId[],
  keyOf: (id: EventId) => number,
  order: Map<EventId, number>,
): void {
  layer.sort((a, b) => keyOf(a) - keyOf(b));
  layer.forEach((id, idx) => order.set(id, idx));
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
