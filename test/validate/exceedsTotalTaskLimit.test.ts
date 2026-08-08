import { describe, expect, it } from "vitest";
import { exceedsTotalTaskLimit } from "../../src/validate/exceedsTotalTaskLimit";
import { LIMITS } from "../../src/validate/limits";

describe("exceedsTotalTaskLimit", () => {
  it("累計が上限を大きく下回る場合はfalse", () => {
    expect(exceedsTotalTaskLimit(0, 10)).toBe(false);
  });

  it("境界値: 累計がちょうど上限に達する場合はfalse", () => {
    expect(exceedsTotalTaskLimit(LIMITS.maxTotalTasks - 1, 1)).toBe(false);
  });

  it("境界値: 累計が上限を1件超える場合はtrue", () => {
    expect(exceedsTotalTaskLimit(LIMITS.maxTotalTasks - 1, 2)).toBe(true);
  });

  it("既存の累計がすでに上限を超えている場合、新規0件でもtrue", () => {
    expect(exceedsTotalTaskLimit(LIMITS.maxTotalTasks + 1, 0)).toBe(true);
  });

  it("emptyケース: 両方0の場合はfalse", () => {
    expect(exceedsTotalTaskLimit(0, 0)).toBe(false);
  });
});
