// カレンダー軸表示モード（UI・UX仕様書 4.2.4）の軸情報を組み立てる純粋関数。
// グローバル営業日番号（layout/ が出力する NodePosition.x）を、共通時間軸の原点日付を起点にした
// 実カレンダー日インデックスへ写像する。土日祝の分だけ列間隔が空く。
import { addBusinessDays, isBusinessDay } from "../calendar/businessDays";
import { addDays, toDateKey } from "../calendar/parseDate";

export interface CalendarAxisTick {
  businessDay: number; // グローバル営業日番号（グリッド線を引く位置）
  calendarDay: number; // 左端(minBusinessDay)を0とした暦日インデックス
  label: string | null; // 週初の営業日にのみ日付文字列。それ以外は null（グリッド線のみ）
}

export interface CalendarAxis {
  /** グローバル営業日番号 → 左端を0とした暦日インデックス。 */
  calendarDayOf(businessDay: number): number;
  /** 全体の暦日数（図幅の算出用）。 */
  span: number;
  /** 範囲内の全営業日ぶんの目盛り（グリッド線1本ずつ、週初のみラベルあり）。 */
  ticks: CalendarAxisTick[];
}

/** その日付が属する週（月曜始まり）の月曜の日付キー。週の識別に用いる。 */
function weekKey(date: Date): string {
  const daysSinceMonday = (date.getUTCDay() + 6) % 7; // Mon=0 .. Sun=6
  return toDateKey(addDays(date, -daysSinceMonday));
}

function labelFor(date: Date, prev: Date | null): string {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  const d = date.getUTCDate();
  if (prev === null || prev.getUTCFullYear() !== y) return `${y}年${m}月${d}日`;
  if (prev.getUTCMonth() !== date.getUTCMonth()) return `${m}月${d}日`;
  return `${m}/${d}`;
}

/**
 * minBusinessDay..maxBusinessDay（いずれも整数のグローバル営業日番号）の軸情報を組み立てる。
 * originDate は共通時間軸の原点（営業日0の実日付、必ず営業日）。
 */
export function buildCalendarAxis(
  minBusinessDay: number,
  maxBusinessDay: number,
  originDate: Date,
  holidayKeys: ReadonlySet<string>,
): CalendarAxis {
  const lo = Math.min(minBusinessDay, maxBusinessDay);
  const hi = Math.max(minBusinessDay, maxBusinessDay);

  const leftDate = addBusinessDays(originDate, lo, holidayKeys);
  const DAY_MS = 86_400_000;
  const calDayOf = (date: Date): number =>
    Math.round((date.getTime() - leftDate.getTime()) / DAY_MS);

  const calendarDayByBusinessDay = new Map<number, number>();
  const ticks: CalendarAxisTick[] = [];
  let lastLabelledWeek: string | null = null;
  let lastLabelledDate: Date | null = null;

  let cursor = leftDate;
  for (let bd = lo; bd <= hi; bd++) {
    if (bd > lo) {
      // 直前の営業日から次の営業日まで、非営業日を飛ばして前進する。
      do {
        cursor = addDays(cursor, 1);
      } while (!isBusinessDay(cursor, holidayKeys));
    }
    const calendarDay = calDayOf(cursor);
    calendarDayByBusinessDay.set(bd, calendarDay);

    const wk = weekKey(cursor);
    let label: string | null = null;
    if (wk !== lastLabelledWeek) {
      label = labelFor(cursor, lastLabelledDate);
      lastLabelledWeek = wk;
      lastLabelledDate = cursor;
    }
    ticks.push({ businessDay: bd, calendarDay, label });
  }

  return {
    calendarDayOf: (businessDay: number) =>
      calendarDayByBusinessDay.get(Math.round(businessDay)) ??
      calDayOf(addBusinessDays(originDate, Math.round(businessDay), holidayKeys)),
    span: ticks.length > 0 ? ticks[ticks.length - 1]!.calendarDay : 0,
    ticks,
  };
}
