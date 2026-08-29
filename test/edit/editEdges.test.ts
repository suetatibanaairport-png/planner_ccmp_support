import { describe, expect, it } from "vitest";
import {
  addSuccessorEdge,
  changedTaskIds,
  removeEdge,
  successorsCsvRows,
  successorsCsvText,
  wouldCreateCycle,
} from "../../src/edit/editEdges";
import type { Edge, Task } from "../../src/types";

const edge = (from: string, to: string): Edge => ({ from, to });

const task = (id: string, name: string): Task => ({
  id,
  name,
  bucketName: "",
  assignees: [],
  startDate: null,
  dueDate: null,
  isRecurring: false,
  isCompleted: false,
  description: "",
});

describe("wouldCreateCycle", () => {
  it("自己参照は循環扱い", () => {
    expect(wouldCreateCycle([], "A", "A")).toBe(true);
  });

  it("A→B→C があるとき C→A の追加は循環", () => {
    const edges = [edge("A", "B"), edge("B", "C")];
    expect(wouldCreateCycle(edges, "C", "A")).toBe(true);
  });

  it("到達不能なら循環しない", () => {
    const edges = [edge("A", "B"), edge("B", "C")];
    expect(wouldCreateCycle(edges, "A", "C")).toBe(false);
  });
});

describe("addSuccessorEdge", () => {
  const base = [edge("A", "B"), edge("B", "C")];

  it("新規の辺を末尾に追加する", () => {
    const r = addSuccessorEdge(base, "A", "C");
    expect(r).toEqual({ ok: true, edges: [...base, edge("A", "C")] });
    expect(base).toHaveLength(2); // 元配列は不変
  });

  it("自己参照は reason=self で拒否", () => {
    expect(addSuccessorEdge(base, "A", "A")).toEqual({ ok: false, reason: "self" });
  });

  it("既存の後続との重複は reason=duplicate で拒否", () => {
    expect(addSuccessorEdge(base, "A", "B")).toEqual({ ok: false, reason: "duplicate" });
  });

  it("循環を生じる追加は reason=cycle で拒否", () => {
    expect(addSuccessorEdge(base, "C", "A")).toEqual({ ok: false, reason: "cycle" });
  });
});

describe("removeEdge", () => {
  it("一致する1対のみ除く", () => {
    const edges = [edge("A", "B"), edge("A", "C"), edge("B", "C")];
    expect(removeEdge(edges, "A", "C")).toEqual([edge("A", "B"), edge("B", "C")]);
  });

  it("一致がなければ複製をそのまま返す", () => {
    const edges = [edge("A", "B")];
    expect(removeEdge(edges, "X", "Y")).toEqual(edges);
  });
});

describe("changedTaskIds", () => {
  it("後続集合が変わったタスクのみ返す（順序非依存）", () => {
    const original = [edge("A", "B"), edge("A", "C")];
    const current = [edge("A", "C"), edge("A", "B"), edge("B", "C")];
    expect([...changedTaskIds(original, current)]).toEqual(["B"]);
  });

  it("削除で後続が空になったタスクも変更扱い", () => {
    expect([...changedTaskIds([edge("A", "B")], [])]).toEqual(["A"]);
  });

  it("変更がなければ空", () => {
    const e = [edge("A", "B")];
    expect(changedTaskIds(e, [...e]).size).toBe(0);
  });
});

describe("successorsCsvRows / successorsCsvText", () => {
  const tasks = [task("A001", "タスクA"), task("A002", "タスクB"), task("A003", "タスクC")];

  it("変更タスクのみ、全角コロン・半角カンマで後続IDを列挙する", () => {
    const edges = [edge("A001", "A002"), edge("A001", "A003")];
    const changed = new Set(["A001"]);
    expect(successorsCsvRows(tasks, changed, edges)).toEqual([
      ["タスク名", "後続タスク"],
      ["タスクA", "後続タスク：A002,A003"],
    ]);
  });

  it("後続を全削除したタスクは値なし（後続タスク：）", () => {
    expect(successorsCsvRows(tasks, new Set(["A002"]), [])).toEqual([
      ["タスク名", "後続タスク"],
      ["タスクB", "後続タスク："],
    ]);
  });

  it("変更が無ければヘッダーのみ", () => {
    expect(successorsCsvRows(tasks, new Set(), [])).toEqual([["タスク名", "後続タスク"]]);
  });

  it("カンマを含む2列目はダブルクォートで囲まれる", () => {
    const text = successorsCsvText(tasks, new Set(["A001"]), [
      edge("A001", "A002"),
      edge("A001", "A003"),
    ]);
    expect(text).toContain('"後続タスク：A002,A003"');
  });
});
