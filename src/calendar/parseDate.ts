// 機能仕様書 3.4: タスク CSV の日付は YYYY/MM/DD 形式のみを許容する（他形式は不正 = W307）。
const TASK_DATE_PATTERN = /^(\d{4})\/(\d{2})\/(\d{2})$/;

// 機能仕様書 3.7: 休日設定ファイルの日付は YYYY-MM-DD 形式（タスクCSVとは異なる）。
const HOLIDAY_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function toUtcDate(year: number, month: number, day: number): Date | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  // 例: 2026/02/30 のような存在しない日付を弾く（Dateのロールオーバーを検出）
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

/** タスク CSV の日付文字列（YYYY/MM/DD）を UTC 日付に変換する。不正な場合は null（W307）。 */
export function parseTaskDate(value: string): Date | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const m = TASK_DATE_PATTERN.exec(trimmed);
  if (!m) return null;
  return toUtcDate(Number(m[1]), Number(m[2]), Number(m[3]));
}

/** 休日設定ファイルの日付文字列（YYYY-MM-DD）を UTC 日付に変換する。不正な場合は null。 */
export function parseHolidayDate(value: string): Date | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const m = HOLIDAY_DATE_PATTERN.exec(trimmed);
  if (!m) return null;
  return toUtcDate(Number(m[1]), Number(m[2]), Number(m[3]));
}

/** 内部での日付キー（YYYY-MM-DD）。祝日集合の Set キーとして用いる。 */
export function toDateKey(date: Date): string {
  const y = date.getUTCFullYear().toString().padStart(4, "0");
  const m = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const d = date.getUTCDate().toString().padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function isWeekend(date: Date): boolean {
  const day = date.getUTCDay(); // 0=日, 6=土
  return day === 0 || day === 6;
}
