import { describe, expect, it } from "vitest";
import { detectMergeBufferCandidates } from "../../src/ccpm/detectMergeBuffers";
import type { Arrow, ArrowTiming } from "../../src/types";

function arrow(from: string, to: string, taskId: string): Arrow {
  return { from, to, kind: "activity", taskId, durationBusinessDays: 1, placeholder: false };
}
function timing(a: Arrow, isCritical: boolean): ArrowTiming {
  return { arrow: a, es: 0, ef: 0, ls: 0, lf: 0, totalFloat: isCritical ? 0 : 1, isCritical };
}

describe("detectMergeBufferCandidates", () => {
  it("合流はあるが一方が非クリティカルなら候補として検出される", () => {
    const critical = arrow("B", "M", "B");
    const nonCritical = arrow("C", "M", "C");
    const candidates = detectMergeBufferCandidates([
      timing(critical, true),
      timing(nonCritical, false),
    ]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.eventId).toBe("M");
    expect(candidates[0]!.feedingArrows).toEqual([nonCritical]);
  });

  it("合流の入辺が全てクリティカルなら候補にしない", () => {
    const a = arrow("B", "M", "B");
    const b = arrow("C", "M", "C");
    const candidates = detectMergeBufferCandidates([timing(a, true), timing(b, true)]);
    expect(candidates).toEqual([]);
  });

  it("合流がない（入次数1）場合は候補0件", () => {
    const a = arrow("N0", "M", "A");
    const candidates = detectMergeBufferCandidates([timing(a, false)]);
    expect(candidates).toEqual([]);
  });

  it("3本合流のうち2本が非クリティカルなら、その2本がfeedingArrowsになる", () => {
    const a = arrow("A", "M", "A");
    const b = arrow("B", "M", "B");
    const c = arrow("C", "M", "C");
    const candidates = detectMergeBufferCandidates([
      timing(a, true),
      timing(b, false),
      timing(c, false),
    ]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.feedingArrows.sort((x, y) => x.taskId!.localeCompare(y.taskId!))).toEqual(
      [b, c].sort((x, y) => x.taskId!.localeCompare(y.taskId!)),
    );
  });
});
