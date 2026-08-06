// 詳細設計書 6章「レイアウトアルゴリズム」の実装。
// X座標: 機能仕様書 4.1.5 のグローバル営業日番号（プロジェクト内相対ES＋プロジェクトオフセット）に比例。
// Y座標: 【未定】とされた交差最小化を、バリセンター法の簡易ヒューリスティックで実装する。
// ここでは「営業日数単位のX」「行番号単位のY」という抽象座標のみを算出し、
// 実ピクセルへの変換・ズーム倍率の適用は render/ 側の責務とする。
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
    const rows = layoutProjectRows(project.events, project.arrows);
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

/**
 * プロジェクト内イベントの縦方向スロットをバリセンター法で求める（詳細設計書6章）。
 * ESが等しいイベント同士（同じX位置）を「層」とみなし、隣接層の平均位置に基づいて
 * 前進・後進を交互に繰り返し並べ替える。層内での位置がそのままスロット番号になる。
 */
function layoutProjectRows(
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
    layer.sort((a, b) => numberOf.get(a)! - numberOf.get(b)!);
    layer.forEach((id, idx) => order.set(id, idx));
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
      layer.sort((a, b) => (barycenter.get(a) ?? 0) - (barycenter.get(b) ?? 0));
      layer.forEach((id, idx) => order.set(id, idx));
    }
  }

  return order;
}

/** イベントを層（同一ES相当のグループ）に分ける。層番号はトポロジカル順の最長経路長で近似する。 */
function groupByLayer(events: readonly Event[], arrows: Project["arrows"]): EventId[][] {
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

  const byLayer = new Map<number, EventId[]>();
  for (const e of byNumber) {
    const layer = layerOf.get(e.id) ?? 0;
    const arr = byLayer.get(layer) ?? [];
    arr.push(e.id);
    byLayer.set(layer, arr);
  }
  return [...byLayer.keys()].sort((a, b) => a - b).map((k) => byLayer.get(k)!);
}
