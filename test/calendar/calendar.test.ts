import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { computeDuration } from "../../src/calendar/businessDays";
import { parseHolidayFile } from "../../src/calendar/holidayFile";
import { parseHolidayDate, parseTaskDate } from "../../src/calendar/parseDate";

const NO_HOLIDAYS = new Set<string>();
const d = (s: string) => parseTaskDate(s)!;

describe("parseTaskDate / parseHolidayDate", () => {
  it("タスクCSVは YYYY/MM/DD のみ受理する", () => {
    expect(parseTaskDate("2026/01/05")).not.toBeNull();
    expect(parseTaskDate("2026-01-05")).toBeNull();
    expect(parseTaskDate("2026/1/5")).toBeNull();
  });

  it("休日ファイルは YYYY-MM-DD のみ受理する", () => {
    expect(parseHolidayDate("2026-01-05")).not.toBeNull();
    expect(parseHolidayDate("2026/01/05")).toBeNull();
  });

  it("存在しない日付（2026/02/30）はnull", () => {
    expect(parseTaskDate("2026/02/30")).toBeNull();
  });

  it("空文字はnull", () => {
    expect(parseTaskDate("")).toBeNull();
  });
});

describe("computeDuration", () => {
  it("月〜金は5営業日", () => {
    expect(computeDuration(d("2026/01/05"), d("2026/01/09"), NO_HOLIDAYS)).toEqual({
      businessDays: 5,
      placeholder: false,
    });
  });

  it("土〜日は0営業日", () => {
    expect(computeDuration(d("2026/01/10"), d("2026/01/11"), NO_HOLIDAYS)).toEqual({
      businessDays: 0,
      placeholder: false,
    });
  });

  it("同一日は1営業日", () => {
    expect(computeDuration(d("2026/01/05"), d("2026/01/05"), NO_HOLIDAYS).businessDays).toBe(1);
  });

  it("金〜月は2営業日（土日をまたぐ）", () => {
    expect(computeDuration(d("2026/01/09"), d("2026/01/12"), NO_HOLIDAYS).businessDays).toBe(2);
  });

  it("月をまたぐ期間", () => {
    // 2026/01/29(木)〜02/02(月): 木金月の3営業日（土日を除く）
    expect(computeDuration(d("2026/01/29"), d("2026/02/02"), NO_HOLIDAYS).businessDays).toBe(3);
  });

  it("年をまたぐ期間", () => {
    // 2025/12/29(月)〜2026/01/02(金): 平日5日連続
    expect(computeDuration(d("2025/12/29"), d("2026/01/02"), NO_HOLIDAYS).businessDays).toBe(5);
  });

  it("開始日・期限日いずれかがnullなら3日仮置き", () => {
    expect(computeDuration(null, d("2026/01/05"), NO_HOLIDAYS)).toEqual({
      businessDays: 3,
      placeholder: true,
    });
    expect(computeDuration(d("2026/01/05"), null, NO_HOLIDAYS)).toEqual({
      businessDays: 3,
      placeholder: true,
    });
  });

  it("開始日・期限日ともにnullでも3日仮置き（片方nullと同じ結果）", () => {
    expect(computeDuration(null, null, NO_HOLIDAYS)).toEqual({
      businessDays: 3,
      placeholder: true,
    });
  });

  it("開始日 > 期限日は3日仮置き", () => {
    expect(computeDuration(d("2026/02/10"), d("2026/02/05"), NO_HOLIDAYS)).toEqual({
      businessDays: 3,
      placeholder: true,
    });
  });

  it("祝日は非営業日として扱う", () => {
    const holidays = new Set(["2026-01-06", "2026-01-07"]);
    // 月(1/5)〜金(1/9) のうち火水が祝日 → 3営業日
    expect(computeDuration(d("2026/01/05"), d("2026/01/09"), holidays).businessDays).toBe(3);
  });
});

describe("parseHolidayFile", () => {
  it("正常行3件・不正行4件で W313 相当（unreadable=false）", () => {
    const text = readFileSync("test/data/holidays_invalid_rows_ja.csv", "utf-8");
    const parsed = parseHolidayFile(text);
    expect(parsed.unreadable).toBe(false);
    expect(parsed.invalidRowCount).toBe(4);
    expect(parsed.dateKeys.size).toBe(3);
  });

  it("全行不正なら unreadable=true（W314相当）", () => {
    const parsed = parseHolidayFile("not-a-date,x\nalso-bad,y");
    expect(parsed.unreadable).toBe(true);
  });

  it("空文字は unreadable=true", () => {
    expect(parseHolidayFile("").unreadable).toBe(true);
  });
});
