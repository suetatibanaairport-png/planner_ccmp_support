// 詳細設計書 5章「アローダイアグラム変換アルゴリズム」の実装。
// AON（タスクと依存関係）を AOA（イベントと矢線）へ変換する。
import type { Arrow, Duration, Edge, Event, EventId, Task, TaskId } from "../types";

const START_EVENT_ID: EventId = "N0";
const END_EVENT_ID: EventId = "Nz";

function endEventOf(taskId: TaskId): EventId {
  return `end:${taskId}`;
}

function mergeEventOf(sortedPredecessorIds: TaskId[]): EventId {
  return `merge:${sortedPredecessorIds.join(",")}`;
}

interface RawArrow {
  from: EventId;
  to: EventId;
  kind: "activity" | "dummy";
  taskId?: TaskId;
  assignee?: string;
  durationBusinessDays: number;
  placeholder: boolean;
}

export interface AoaBuildResult {
  events: Event[];
  arrows: Arrow[];
}

/**
 * タスク・依存辺・トポロジカル順・所要日数から AOA を構築する。
 * tasks は事前に graph/topologicalSort でトポロジカル順に並んでいる必要はないが、
 * order は buildGraph の孤立タスク分離後のトポロジカル順（タスクID配列）を渡すこと。
 */
export function buildAoa(
  tasks: Task[],
  edges: Edge[],
  order: TaskId[],
  durationsByTaskId: Map<TaskId, Duration>,
): AoaBuildResult {
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const predecessorsOf = new Map<TaskId, TaskId[]>();
  const successorsOf = new Map<TaskId, TaskId[]>();
  for (const task of tasks) {
    predecessorsOf.set(task.id, []);
    successorsOf.set(task.id, []);
  }
  for (const edge of edges) {
    predecessorsOf.get(edge.to)?.push(edge.from);
    successorsOf.get(edge.from)?.push(edge.to);
  }

  const mergeEventIds = new Map<string, EventId>(); // key: ソート済み先行ID結合文字列
  const rawArrows: RawArrow[] = [];

  // 手順3: 開始イベントの決定
  function startEventOf(taskId: TaskId): EventId {
    const preds = predecessorsOf.get(taskId) ?? [];
    if (preds.length === 0) return START_EVENT_ID;
    if (preds.length === 1) return endEventOf(preds[0]!);

    const sorted = [...preds].sort();
    const key = sorted.join(",");
    let mergeId = mergeEventIds.get(key);
    if (mergeId === undefined) {
      mergeId = mergeEventOf(sorted);
      mergeEventIds.set(key, mergeId);
      for (const p of sorted) {
        rawArrows.push({
          from: endEventOf(p),
          to: mergeId,
          kind: "dummy",
          durationBusinessDays: 0,
          placeholder: false,
        });
      }
    }
    return mergeId;
  }

  // 手順2・6a: 終了イベントの生成、複数担当タスクの分割
  for (const taskId of order) {
    const task = taskById.get(taskId);
    if (!task) continue;

    const end = endEventOf(task.id);
    const start = startEventOf(task.id);
    const duration = durationsByTaskId.get(task.id) ?? {
      taskId: task.id,
      businessDays: 0,
      placeholder: false,
    };

    const assignees = task.assignees.length > 0 ? task.assignees : [undefined];

    if (assignees.length === 1) {
      rawArrows.push({
        from: start,
        to: end,
        kind: "activity",
        taskId: task.id,
        assignee: assignees[0],
        durationBusinessDays: duration.businessDays,
        placeholder: duration.placeholder,
      });
    } else {
      // 手順6a: 担当者ごとに実作業エッジを作成し、0営業日のダミーで再合流させる
      assignees.forEach((assignee, index) => {
        const mid: EventId = `assignee:${task.id}:${index}`;
        rawArrows.push({
          from: start,
          to: mid,
          kind: "activity",
          taskId: task.id,
          assignee,
          durationBusinessDays: duration.businessDays,
          placeholder: duration.placeholder,
        });
        rawArrows.push({
          from: mid,
          to: end,
          kind: "dummy",
          durationBusinessDays: 0,
          placeholder: false,
        });
      });
    }

    // 手順4: 終端の接続（後続タスクを持たないタスク）
    if ((successorsOf.get(task.id) ?? []).length === 0) {
      rawArrows.push({
        from: end,
        to: END_EVENT_ID,
        kind: "dummy",
        durationBusinessDays: 0,
        placeholder: false,
      });
    }
  }

  // 手順5: ダミー矢線の削減（局所的な2規則。最小性は保証しない）
  const reduced = reduceDummyArrows(rawArrows);

  // 手順7: イベント番号付け（トポロジカル順、0起点、全矢線で i<j を保証）
  const numbered = numberEvents(reduced.events, reduced.arrows);

  return numbered;
}

function reduceDummyArrows(arrows: RawArrow[]): { events: EventId[]; arrows: RawArrow[] } {
  // イベントごとの入次数・出次数（種別別）を数える
  let current = arrows;
  let changed = true;

  while (changed) {
    changed = false;
    const incoming = new Map<EventId, RawArrow[]>();
    const outgoing = new Map<EventId, RawArrow[]>();
    for (const a of current) {
      incoming.set(a.to, [...(incoming.get(a.to) ?? []), a]);
      outgoing.set(a.from, [...(outgoing.get(a.from) ?? []), a]);
    }

    // 規則1: 合流イベントmの入辺がダミー1本のみ → mを上流イベントに統合
    for (const [eventId, ins] of incoming) {
      if (eventId === "N0" || eventId === "Nz") continue;
      if (ins.length === 1 && ins[0]!.kind === "dummy" && (outgoing.get(eventId)?.length ?? 0) > 0) {
        const dummy = ins[0]!;
        current = current
          .filter((a) => a !== dummy)
          .map((a) => (a.from === eventId ? { ...a, from: dummy.from } : a));
        changed = true;
        break;
      }
    }
    if (changed) continue;

    // 規則2: e(p)の出辺がダミー1本のみ、かつ先mの入辺も1本のみ → 両イベントを統合
    for (const [eventId, outs] of outgoing) {
      if (eventId === "N0" || eventId === "Nz") continue;
      if (outs.length === 1 && outs[0]!.kind === "dummy") {
        const dummy = outs[0]!;
        const targetIns = incoming.get(dummy.to) ?? [];
        if (targetIns.length === 1) {
          current = current
            .filter((a) => a !== dummy)
            .map((a) => (a.to === eventId ? { ...a, to: dummy.to } : a));
          changed = true;
          break;
        }
      }
    }
  }

  const remainingEventIds = new Set<EventId>();
  for (const a of current) {
    remainingEventIds.add(a.from);
    remainingEventIds.add(a.to);
  }

  return { events: [...remainingEventIds], arrows: current };
}

/** ソート済み配列を維持したまま二分探索で挿入する。 */
function insertSorted(sorted: EventId[], value: EventId): void {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid]! < value) lo = mid + 1;
    else hi = mid;
  }
  sorted.splice(lo, 0, value);
}

function numberEvents(
  eventIds: EventId[],
  arrows: RawArrow[],
): { events: Event[]; arrows: Arrow[] } {
  const successors = new Map<EventId, EventId[]>();
  const inDegree = new Map<EventId, number>();
  for (const id of eventIds) {
    successors.set(id, []);
    inDegree.set(id, 0);
  }
  for (const a of arrows) {
    successors.get(a.from)?.push(a.to);
    inDegree.set(a.to, (inDegree.get(a.to) ?? 0) + 1);
  }

  // 決定的な順序のため、同順位はイベントID文字列順とする（最早結合点時刻による並べ替えは呼び出し側で行う）
  const queue = eventIds.filter((id) => (inDegree.get(id) ?? 0) === 0).sort();
  const order: EventId[] = [];
  const remainingInDegree = new Map(inDegree);

  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);
    const nexts = [...(successors.get(id) ?? [])].sort();
    for (const next of nexts) {
      const d = (remainingInDegree.get(next) ?? 0) - 1;
      remainingInDegree.set(next, d);
      if (d === 0) {
        insertSorted(queue, next);
      }
    }
  }

  const numberOf = new Map<EventId, number>();
  order.forEach((id, index) => numberOf.set(id, index));

  const events: Event[] = order.map((id) => ({ id, number: numberOf.get(id)! }));

  return { events, arrows };
}
