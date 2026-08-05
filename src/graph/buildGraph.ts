// 機能仕様書 3.6（定期的タスクの除外）/ 3.5.5（孤立タスクの分離）/ 5.2.2 E203（循環依存）の実装。
import type { Edge, Task } from "../types";

export interface GraphBuildResult {
  activeTasks: Task[]; // ネットワークを構成するタスク（定期的タスク・孤立タスクを除く）
  activeEdges: Edge[];
  isolatedTasks: Task[]; // 3.5.5: 先行も後続も持たないタスク
}

export interface CycleError {
  cycle: string[]; // タスクIDの順序（例: ["A", "C", "B", "A"]）
}

/**
 * AON グラフを構築する。定期的タスクは除外し、それを参照していた辺は
 * W301 と同様に無視する（3.6）。孤立タスクは分離する（3.5.5）。
 */
export function buildGraph(tasks: Task[], edges: Edge[]): GraphBuildResult {
  const activeTasks = tasks.filter((t) => !t.isRecurring);
  const activeIds = new Set(activeTasks.map((t) => t.id));

  // 定期的タスクを参照していた辺（除外対象を先行・後続いずれかに持つ辺）を取り除く。
  const activeEdges = edges.filter((e) => activeIds.has(e.from) && activeIds.has(e.to));

  const hasIncoming = new Set(activeEdges.map((e) => e.to));
  const hasOutgoing = new Set(activeEdges.map((e) => e.from));

  const isolatedTasks: Task[] = [];
  const networkTasks: Task[] = [];
  for (const task of activeTasks) {
    if (!hasIncoming.has(task.id) && !hasOutgoing.has(task.id)) {
      isolatedTasks.push(task);
    } else {
      networkTasks.push(task);
    }
  }

  return { activeTasks: networkTasks, activeEdges, isolatedTasks };
}

/**
 * トポロジカルソートを試みる。循環がある場合はその経路を返す（E203）。
 * 戻り値が配列の場合は成功（タスクIDのトポロジカル順）、CycleError の場合は循環を検出。
 */
export function topologicalSort(tasks: Task[], edges: Edge[]): string[] | CycleError {
  const successors = new Map<string, string[]>();
  for (const task of tasks) successors.set(task.id, []);
  for (const edge of edges) {
    successors.get(edge.from)?.push(edge.to);
  }

  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const task of tasks) color.set(task.id, WHITE);

  const order: string[] = [];
  const stack: string[] = [];

  function visit(id: string): CycleError | null {
    color.set(id, GRAY);
    stack.push(id);

    for (const next of successors.get(id) ?? []) {
      const state = color.get(next);
      if (state === GRAY) {
        const cycleStart = stack.indexOf(next);
        return { cycle: [...stack.slice(cycleStart), next] };
      }
      if (state === WHITE) {
        const result = visit(next);
        if (result) return result;
      }
    }

    stack.pop();
    color.set(id, BLACK);
    order.push(id);
    return null;
  }

  for (const task of tasks) {
    if (color.get(task.id) === WHITE) {
      const result = visit(task.id);
      if (result) return result;
    }
  }

  return order.reverse();
}
