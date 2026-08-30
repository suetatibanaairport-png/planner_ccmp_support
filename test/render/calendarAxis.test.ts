import { describe, expect, it } from "vitest";
import { buildCalendarAxis } from "../../src/render/calendarAxis";
import { parseTaskDate } from "../../src/calendar/parseDate";

const NO_HOLIDAYS = new Set<string>();
const d = (s: string) => parseTaskDate(s)!;

describe("buildCalendarAxis", () => {
  it("同一週内はギャップなし・先頭ticのみラベル（年月日入り）", () => {
    const origin = d("2026/01/05"); // 月曜
    expect(origin.getUTCDay()).toBe(1);
    const axis = buildCalendarAxis(0, 4, origin, NO_HOLIDAYS); // 月〜金
    expect(axis.ticks.map((t) => t.calendarDay)).toEqual([0, 1, 2, 3, 4]);
    expect(axis.span).toBe(4);
    expect(axis.ticks.map((t) => t.label)).toEqual(["2026年1月5日", null, null, null, null]);
    expect(axis.calendarDayOf(3)).toBe(3);
  });

  it("週をまたぐと土日ぶんの暦日ギャップが空き、週初にラベルが付く", () => {
    const origin = d("2026/01/05");
    const axis = buildCalendarAxis(0, 6, origin, NO_HOLIDAYS); // 月〜金 + 翌週 月・火
    // bd4=金(calDay4)、bd5=翌週月。土日で暦日が2つ飛ぶ → calDay 7
    expect(axis.calendarDayOf(5)).toBe(7);
    expect(axis.calendarDayOf(6)).toBe(8);
    expect(axis.span).toBe(8);
    // 週初(bd5)にラベル、同月なので M/D 形式
    expect(axis.ticks.find((t) => t.businessDay === 5)!.label).toBe("1/12");
    expect(axis.ticks.find((t) => t.businessDay === 6)!.label).toBeNull();
  });

  it("祝日も暦日ギャップになる", () => {
    const origin = d("2026/01/05");
    const holidays = new Set(["2026-01-07"]); // 水曜が祝日
    const axis = buildCalendarAxis(0, 3, origin, holidays); // 月,火,(水休),木,金 → bd0..3
    // bd2 は木曜（暦日3）。bd1(火,calDay1) との差が2 → 祝日ギャップ
    expect(axis.calendarDayOf(2)).toBe(3);
  });

  it("月が変わる週初ラベルは「M月D日」形式", () => {
    const origin = d("2026/01/26"); // 月曜
    expect(origin.getUTCDay()).toBe(1);
    const axis = buildCalendarAxis(0, 6, origin, NO_HOLIDAYS); // 1/26〜1/30 + 2/2,2/3
    expect(axis.ticks.find((t) => t.businessDay === 5)!.label).toBe("2月2日");
  });

  it("年が変わる週初ラベルは「YYYY年M月D日」形式", () => {
    const origin = d("2026/12/28"); // 月曜
    expect(origin.getUTCDay()).toBe(1);
    // bd0..4 = 12/28〜1/1（金, 2027）、bd5 = 翌週月曜 = 2027/01/04
    const axis = buildCalendarAxis(0, 6, origin, NO_HOLIDAYS);
    expect(axis.ticks[0]!.label).toBe("2026年12月28日");
    expect(axis.ticks.find((t) => t.businessDay === 5)!.label).toBe("2027年1月4日");
  });
});
