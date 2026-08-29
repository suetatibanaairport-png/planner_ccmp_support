import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { computeProject, parseFileToModel, processFile } from "../../src/workspace/pipeline";

const read = (path: string): string => readFileSync(`test/data/${path}`, "utf-8");
const NO_HOLIDAYS = new Set<string>();

describe("pipeline の2段分割（詳細設計書 10.1）", () => {
  it("parseFileToModel + computeProject は processFile と同一の結果を返す", () => {
    for (const fixture of ["minimal/serial_ja.csv", "minimal/branch_merge_ja.csv"]) {
      const text = read(fixture);
      const model = parseFileToModel(fixture, text);
      expect(model.ok).toBe(true);
      if (!model.ok) return;

      const split = computeProject(fixture, model.tasks, model.edges, NO_HOLIDAYS, model.warnings);
      const whole = processFile(fixture, text, NO_HOLIDAYS);
      expect(split).toEqual(whole);
    }
  });

  it("modelEdges は parseFileToModel の edges（validateFile の依存辺）と一致する", () => {
    const text = read("minimal/serial_ja.csv");
    const model = parseFileToModel("serial.csv", text);
    const whole = processFile("serial.csv", text, NO_HOLIDAYS);
    expect(whole.ok && model.ok).toBe(true);
    if (whole.ok && model.ok) {
      expect(whole.project.modelEdges).toEqual(model.edges);
    }
  });

  it("循環は computeProject でも processFile でも E203", () => {
    const text = read("minimal/cycle_ja.csv");
    const model = parseFileToModel("cycle.csv", text);
    expect(model.ok).toBe(true);
    if (!model.ok) return;

    const split = computeProject(
      "cycle.csv",
      model.tasks,
      model.edges,
      NO_HOLIDAYS,
      model.warnings,
    );
    const whole = processFile("cycle.csv", text, NO_HOLIDAYS);
    expect(split.ok).toBe(false);
    expect(whole.ok).toBe(false);
    if (!split.ok) expect(split.error.code).toBe("E203");
  });

  it("編集後の依存辺を入力にした再計算は、同じ辺集合なら初回と同じ AOA を返す", () => {
    const text = read("minimal/branch_merge_ja.csv");
    const model = parseFileToModel("bm.csv", text);
    if (!model.ok) return;
    const a = computeProject("bm.csv", model.tasks, model.edges, NO_HOLIDAYS, model.warnings);
    const b = computeProject("bm.csv", model.tasks, [...model.edges], NO_HOLIDAYS, model.warnings);
    expect(a).toEqual(b);
  });
});
