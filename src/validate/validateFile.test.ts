import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { processFile } from "../workspace/pipeline";
import { validateFile } from "./validateFile";

const read = (path: string) => readFileSync(`test_data/${path}`, "utf-8");

describe("validateFile: 致命的エラー", () => {
  it.each([
    ["errors/e102_no_header_ja.csv", "E102"],
    ["errors/e103_missing_required_column_ja.csv", "E103"],
    ["errors/e105_no_data_rows_ja.csv", "E105"],
    ["errors/e201_duplicate_task_id_ja.csv", "E201"],
    ["errors/e202_blank_task_id_ja.csv", "E202"],
    ["errors/e204_multiple_predecessor_lines_ja.csv", "E204"],
    ["errors/e405_too_many_assignees_ja.csv", "E405"],
    ["errors/e406_task_name_too_long_ja.csv", "E406"],
    ["errors/e406_description_too_long_ja.csv", "E406"],
  ])("%s → %s", (path, code) => {
    const r = validateFile("f.csv", read(path));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe(code);
  });

  it("列構成が異なっていてもファイル単独では正常処理される", () => {
    const r = validateFile("f.csv", read("different_columns_ja.csv"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.tasks.map((t) => t.id)).toEqual(["DC001", "DC002"]);
  });
});

describe("validateFile: 警告", () => {
  it("先行タスク記載なしファイルは W310", () => {
    const r = validateFile("f.csv", read("errors/w310_no_predecessors_ja.csv"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warnings.map((w) => w.code)).toEqual(["W310"]);
  });

  it("W301〜W303, W309, W312を検出する（W311はbuildGraph側なのでprocessFileで検証）", () => {
    const r = validateFile("f.csv", read("errors/warnings_ja.csv"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const codes = r.warnings.map((w) => w.code).sort();
    expect(codes).toEqual(["W301", "W302", "W303", "W309", "W312"].sort());
  });
});

describe("processFile: 所要日数由来の警告（W304〜W308）", () => {
  it("開始日/期限日空欄・逆転・不正形式・全非営業日を検出する", () => {
    const r = processFile("f.csv", read("errors/warnings_ja.csv"), new Set());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const codes = r.project.warnings.map((w) => w.code).sort();
    expect(codes).toEqual(
      [
        "W301",
        "W302",
        "W303",
        "W304", // W005: 開始日空欄
        "W304", // W008: W307行は日付欠落としてW304も併発する
        "W305",
        "W306",
        "W307",
        "W308",
        "W309",
        "W311",
        "W311",
        "W312",
      ].sort(),
    );
  });
});
