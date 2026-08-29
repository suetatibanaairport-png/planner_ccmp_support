import { describe, expect, it } from "vitest";
import { EditSession } from "../../src/edit/EditSession";
import type { Edge } from "../../src/types";

const edge = (from: string, to: string): Edge => ({ from, to });
const keys = (edges: Edge[]): string[] => edges.map((e) => `${e.from}->${e.to}`).sort();

describe("EditSession", () => {
  it("元の edges を複製して保持する（引数配列の変更に影響されない）", () => {
    const original = [edge("A", "B")];
    const session = new EditSession(original);
    original.push(edge("X", "Y"));
    expect(keys(session.edges)).toEqual(["A->B"]);
  });

  it("add→undo→redo で edges と changedIds が往復する", () => {
    const session = new EditSession([edge("A", "B")]);
    expect(session.add("A", "C")).toEqual({ ok: true });
    expect(keys(session.edges)).toEqual(["A->B", "A->C"]);
    expect([...session.changedIds()]).toEqual(["A"]);

    session.undo();
    expect(keys(session.edges)).toEqual(["A->B"]);
    expect(session.changedIds().size).toBe(0);
    expect(session.canRedo()).toBe(true);

    session.redo();
    expect(keys(session.edges)).toEqual(["A->B", "A->C"]);
    expect([...session.changedIds()]).toEqual(["A"]);
  });

  it("remove も undo/redo できる", () => {
    const session = new EditSession([edge("A", "B"), edge("A", "C")]);
    session.remove("A", "C");
    expect(keys(session.edges)).toEqual(["A->B"]);
    session.undo();
    expect(keys(session.edges)).toEqual(["A->B", "A->C"]);
  });

  it("新規操作で redo スタックが消える", () => {
    const session = new EditSession([]);
    session.add("A", "B");
    session.undo();
    expect(session.canRedo()).toBe(true);
    session.add("A", "C");
    expect(session.canRedo()).toBe(false);
  });

  it("全履歴を遡れる（複数操作 → 全部 undo）", () => {
    const session = new EditSession([]);
    session.add("A", "B");
    session.add("B", "C");
    session.add("C", "D");
    session.undo();
    session.undo();
    session.undo();
    expect(session.edges).toEqual([]);
    expect(session.canUndo()).toBe(false);
  });

  it("失敗した add は履歴に積まれない", () => {
    const session = new EditSession([edge("A", "B")]);
    expect(session.add("A", "B")).toEqual({ ok: false, reason: "duplicate" });
    expect(session.canUndo()).toBe(false);
  });

  it("2 つのセッションは独立している", () => {
    const s1 = new EditSession([]);
    const s2 = new EditSession([]);
    s1.add("A", "B");
    expect(s1.canUndo()).toBe(true);
    expect(s2.canUndo()).toBe(false);
  });
});
