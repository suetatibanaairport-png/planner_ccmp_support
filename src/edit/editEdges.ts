// 機能仕様書 4.3 / 詳細設計書 10.3: 依存関係の手動編集の純粋ロジック（DOM 非依存）。
import { unparseCsv } from "../csv/parseCsv";
import type { Edge, Task, TaskId } from "../types";

/** edges に from→to を加えると閉路になるか（= to から from へ既に到達可能か）を判定する。 */
export function wouldCreateCycle(edges: readonly Edge[], from: TaskId, to: TaskId): boolean {
  if (from === to) return true;
  const adjacency = new Map<TaskId, TaskId[]>();
  for (const e of edges) {
    const list = adjacency.get(e.from);
    if (list) list.push(e.to);
    else adjacency.set(e.from, [e.to]);
  }
  const queue: TaskId[] = [to];
  const visited = new Set<TaskId>([to]);
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === from) return true;
    for (const next of adjacency.get(current) ?? []) {
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }
  return false;
}

export type AddEdgeResult =
  { ok: true; edges: Edge[] } | { ok: false; reason: "self" | "duplicate" | "cycle" };

/** 先行タスク from の後続タスクとして to を追加する（機能仕様書 4.3「追加」）。 */
export function addSuccessorEdge(edges: readonly Edge[], from: TaskId, to: TaskId): AddEdgeResult {
  if (from === to) return { ok: false, reason: "self" };
  if (edges.some((e) => e.from === from && e.to === to)) {
    return { ok: false, reason: "duplicate" };
  }
  if (wouldCreateCycle(edges, from, to)) return { ok: false, reason: "cycle" };
  return { ok: true, edges: [...edges, { from, to }] };
}

/** from→to の依存辺を1本削除する（機能仕様書 4.3「削除」）。 */
export function removeEdge(edges: readonly Edge[], from: TaskId, to: TaskId): Edge[] {
  const index = edges.findIndex((e) => e.from === from && e.to === to);
  if (index === -1) return [...edges];
  return [...edges.slice(0, index), ...edges.slice(index + 1)];
}

/** タスクごとの後続 ID 集合をキー文字列にして返す（差分比較用）。 */
function successorKey(edges: readonly Edge[], taskId: TaskId): string {
  const ids = edges.filter((e) => e.from === taskId).map((e) => e.to);
  return [...new Set(ids)].sort().join(",");
}

/** 後続タスク一覧が originalEdges と currentEdges で異なるタスク ID の集合（機能仕様書 4.3「変更マーク」）。 */
export function changedTaskIds(
  originalEdges: readonly Edge[],
  currentEdges: readonly Edge[],
): Set<TaskId> {
  const taskIds = new Set<TaskId>();
  for (const e of originalEdges) taskIds.add(e.from);
  for (const e of currentEdges) taskIds.add(e.from);

  const changed = new Set<TaskId>();
  for (const id of taskIds) {
    if (successorKey(originalEdges, id) !== successorKey(currentEdges, id)) {
      changed.add(id);
    }
  }
  return changed;
}

/** 変更のあったタスクについて、出力 CSV の行配列を組み立てる（機能仕様書 4.3「変更内容の出力」）。
 *  1列目=タスク名、2列目=「後続タスク：<ID>,<ID>...」（コロンは全角、ID 区切りは半角カンマ）。 */
export function successorsCsvRows(
  tasks: readonly Task[],
  changedIds: ReadonlySet<TaskId>,
  edges: readonly Edge[],
): string[][] {
  const rows: string[][] = [["タスク名", "後続タスク"]];
  for (const task of tasks) {
    if (!changedIds.has(task.id)) continue;
    const successorIds = [...new Set(edges.filter((e) => e.from === task.id).map((e) => e.to))];
    rows.push([task.name, `後続タスク：${successorIds.join(",")}`]);
  }
  return rows;
}

/** 出力 CSV テキスト（機能仕様書 4.3）。 */
export function successorsCsvText(
  tasks: readonly Task[],
  changedIds: ReadonlySet<TaskId>,
  edges: readonly Edge[],
): string {
  return unparseCsv(successorsCsvRows(tasks, changedIds, edges));
}
