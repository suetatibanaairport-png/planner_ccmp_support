// 機能仕様書 4.3 / 詳細設計書 10.4: プロジェクト1件分の手動編集状態（DOM 非依存）。
// Undo/Redo はプロジェクトごとに独立し、いずれも全履歴を遡れる（上限なし）。
import type { Edge, EditOp, TaskId } from "../types";
import { addSuccessorEdge, changedTaskIds, removeEdge } from "./editEdges";

export type AddResult = { ok: true } | { ok: false; reason: "self" | "duplicate" | "cycle" };

export class EditSession {
  private readonly originalEdges: Edge[];
  private currentEdges: Edge[];
  private readonly undoStack: EditOp[] = [];
  private readonly redoStack: EditOp[] = [];

  constructor(originalEdges: readonly Edge[]) {
    this.originalEdges = originalEdges.map((e) => ({ ...e }));
    this.currentEdges = originalEdges.map((e) => ({ ...e }));
  }

  get edges(): Edge[] {
    return this.currentEdges.map((e) => ({ ...e }));
  }

  /** 先行タスク from の後続タスクとして to を追加する。失敗時は理由を返す。 */
  add(from: TaskId, to: TaskId): AddResult {
    const result = addSuccessorEdge(this.currentEdges, from, to);
    if (!result.ok) return result;
    this.currentEdges = result.edges;
    this.undoStack.push({ kind: "add", from, to });
    this.redoStack.length = 0;
    return { ok: true };
  }

  /** from→to の依存辺を削除する。 */
  remove(from: TaskId, to: TaskId): void {
    if (!this.currentEdges.some((e) => e.from === from && e.to === to)) return;
    this.currentEdges = removeEdge(this.currentEdges, from, to);
    this.undoStack.push({ kind: "remove", from, to });
    this.redoStack.length = 0;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): void {
    const op = this.undoStack.pop();
    if (!op) return;
    this.currentEdges = invert(this.currentEdges, op);
    this.redoStack.push(op);
  }

  redo(): void {
    const op = this.redoStack.pop();
    if (!op) return;
    this.currentEdges = apply(this.currentEdges, op);
    this.undoStack.push(op);
  }

  /** 後続タスク一覧が読み込み時と異なるタスク ID の集合。 */
  changedIds(): Set<TaskId> {
    return changedTaskIds(this.originalEdges, this.currentEdges);
  }

  hasChanges(): boolean {
    return this.changedIds().size > 0;
  }
}

function apply(edges: readonly Edge[], op: EditOp): Edge[] {
  if (op.kind === "add") {
    if (edges.some((e) => e.from === op.from && e.to === op.to)) return [...edges];
    return [...edges, { from: op.from, to: op.to }];
  }
  return removeEdge(edges, op.from, op.to);
}

function invert(edges: readonly Edge[], op: EditOp): Edge[] {
  return apply(edges, {
    kind: op.kind === "add" ? "remove" : "add",
    from: op.from,
    to: op.to,
  });
}
