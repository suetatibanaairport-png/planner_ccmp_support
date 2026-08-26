import { describe, expect, it } from "vitest";
import { extractSuccessors } from "../../src/model/successors";

describe("extractSuccessors", () => {
  it("後続タスク: の行からカンマ区切りのIDを抽出する", () => {
    const r = extractSuccessors("後続タスク:A001, A002 ,A003\n補足テキスト。");
    expect(r.ids).toEqual(["A001", "A002", "A003"]);
    expect(r.occurrenceCount).toBe(1);
  });

  it("大文字小文字を区別しない", () => {
    const r = extractSuccessors("後続タスク:A001");
    expect(r.ids).toEqual(["A001"]);
  });

  it("全角コロン（後続タスク：）も許容する", () => {
    const r = extractSuccessors("後続タスク：A001,A002");
    expect(r.ids).toEqual(["A001", "A002"]);
    expect(r.occurrenceCount).toBe(1);
  });

  it("半角・全角コロンが混在して複数回出現した場合もoccurrenceCountに数える（E204判定用）", () => {
    const r = extractSuccessors("後続タスク:A001\n後続タスク：A002");
    expect(r.occurrenceCount).toBe(2);
  });

  it("行が存在しない場合は空を返す", () => {
    const r = extractSuccessors("ただの説明文。");
    expect(r.ids).toEqual([]);
    expect(r.occurrenceCount).toBe(0);
  });

  it("複数回出現した場合はoccurrenceCountが2以上になる（E204判定用）", () => {
    const r = extractSuccessors("後続タスク:A001\n途中の補足。\n後続タスク:A002");
    expect(r.occurrenceCount).toBe(2);
    expect(r.ids).toEqual(["A001"]); // E204判定は呼び出し側、抽出自体は最初の行のみ採用
  });
});
