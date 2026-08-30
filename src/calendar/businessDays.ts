// 機能仕様書 4.1.1「所要営業日数の算出」/ 4.1.5「共通時間軸への変換」の計算ロジック。
import { addDays, isWeekend, toDateKey } from "./parseDate";

const PLACEHOLDER_BUSINESS_DAYS = 3;

export function isBusinessDay(date: Date, holidayKeys: ReadonlySet<string>): boolean {
  if (isWeekend(date)) return false;
  if (holidayKeys.has(toDateKey(date))) return false;
  return true;
}

/** 開始日・期限日の両端を含む営業日数を数える（4.1.1）。start > end の場合は 0 を返す。 */
export function countBusinessDaysInclusive(
  start: Date,
  end: Date,
  holidayKeys: ReadonlySet<string>,
): number {
  if (start.getTime() > end.getTime()) return 0;
  let count = 0;
  let cursor = start;
  while (cursor.getTime() <= end.getTime()) {
    if (isBusinessDay(cursor, holidayKeys)) count += 1;
    cursor = addDays(cursor, 1);
  }
  return count;
}

/** 4.1.5: 非営業日の場合は直後の最初の営業日に繰り下げる。 */
export function nextOrSameBusinessDay(date: Date, holidayKeys: ReadonlySet<string>): Date {
  let cursor = date;
  while (!isBusinessDay(cursor, holidayKeys)) {
    cursor = addDays(cursor, 1);
  }
  return cursor;
}

/**
 * start（営業日である前提。共通時間軸の原点）から n 営業日後の Date を返す。n=0 は start。
 * businessDayOffset の逆関数（4.1.5 のグローバル営業日番号 → 実日付）。負の n も対称に扱う。
 */
export function addBusinessDays(start: Date, n: number, holidayKeys: ReadonlySet<string>): Date {
  const step = n < 0 ? -1 : 1;
  let remaining = Math.abs(n);
  let cursor = start;
  while (remaining > 0) {
    cursor = addDays(cursor, step);
    if (isBusinessDay(cursor, holidayKeys)) remaining -= 1;
  }
  return cursor;
}

export interface DurationResult {
  businessDays: number;
  placeholder: boolean; // 3.6/4.1.1: 開始日・期限日の欠落、または開始日>期限日
}

/** タスクの所要営業日数を算出する（4.1.1）。 */
export function computeDuration(
  startDate: Date | null,
  dueDate: Date | null,
  holidayKeys: ReadonlySet<string>,
): DurationResult {
  if (startDate === null || dueDate === null || startDate.getTime() > dueDate.getTime()) {
    return { businessDays: PLACEHOLDER_BUSINESS_DAYS, placeholder: true };
  }
  const businessDays = countBusinessDaysInclusive(startDate, dueDate, holidayKeys);
  return { businessDays, placeholder: false };
}

/**
 * origin（営業日であること前提）から target（同前提）までの営業日オフセットを求める（4.1.5）。
 * target が origin と同じ営業日なら 0。
 */
export function businessDayOffset(
  origin: Date,
  target: Date,
  holidayKeys: ReadonlySet<string>,
): number {
  if (target.getTime() < origin.getTime()) {
    return -businessDayOffset(target, origin, holidayKeys);
  }
  return countBusinessDaysInclusive(origin, target, holidayKeys) - 1;
}
