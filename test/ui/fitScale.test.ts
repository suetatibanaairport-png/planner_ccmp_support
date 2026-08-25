import { describe, expect, it } from "vitest";
import { computeFitScale } from "../../src/ui/fitScale";

describe("computeFitScale", () => {
  it("横に長い図はビューポート幅に合わせて縮小する", () => {
    expect(computeFitScale(4000, 400, 800, 600, 0.2)).toBeCloseTo(0.2, 5);
  });

  it("縦に長い図はビューポート高さに合わせて縮小する", () => {
    expect(computeFitScale(400, 4000, 800, 600, 0.05)).toBeCloseTo(0.15, 5);
  });

  it("ビューポートより小さい図は拡大せず等倍のままとする", () => {
    expect(computeFitScale(100, 100, 800, 600, 0.2)).toBe(1);
  });

  it("計算結果が最小倍率を下回る場合は最小倍率にクランプする", () => {
    expect(computeFitScale(100000, 100, 800, 600, 0.2)).toBe(0.2);
  });

  it("図の幅または高さが0の場合は等倍にフォールバックする", () => {
    expect(computeFitScale(0, 100, 800, 600, 0.2)).toBe(1);
    expect(computeFitScale(100, 0, 800, 600, 0.2)).toBe(1);
  });

  it("ビューポートの幅または高さが0の場合は等倍にフォールバックする", () => {
    expect(computeFitScale(400, 400, 0, 600, 0.2)).toBe(1);
    expect(computeFitScale(400, 400, 800, 0, 0.2)).toBe(1);
  });
});
