// 機能仕様書 3.7: 休日・祝日設定ファイルの読み込み。
// 形式: CSV、ヘッダー行なし、1行1件「日付,名称」の2列。名称列は使用しない（3.7）。
import { parseCsv } from "../csv/parseCsv";
import { parseHolidayDate, toDateKey } from "./parseDate";

export interface HolidayFileParseResult {
  dateKeys: Set<string>;
  invalidRowCount: number; // W313
}

/** 休日設定ファイルの CSV テキストを解釈する。不正な行はスキップして継続する（W313）。 */
export function parseHolidayFile(text: string): HolidayFileParseResult {
  const rows = parseCsv(text);
  const dateKeys = new Set<string>();
  let invalidRowCount = 0;

  for (const row of rows) {
    const dateField = row[0] ?? "";
    const date = parseHolidayDate(dateField);
    if (date === null) {
      invalidRowCount += 1;
      continue;
    }
    dateKeys.add(toDateKey(date));
  }

  return { dateKeys, invalidRowCount };
}
