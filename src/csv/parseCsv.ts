// 機能仕様書 3.1/3.4 準拠の RFC 4180 CSV パース。実処理は PapaParse に委譲し、
// 本ファイルは入出力形を変換する薄いラッパー（開発ガイド.md「技術構成」参照）。
import Papa from "papaparse";

/** CSV テキストをレコード（行 × 列の文字列配列）に変換する。 */
export function parseCsv(text: string): string[][] {
  // skipEmptyLines: 完全な空行（末尾の空行を含む）を除去する。BOM・CRLF/LF・引用符の
  // エスケープ・引用符内の改行/カンマは PapaParse が標準で処理する。
  return Papa.parse<string[]>(text, { skipEmptyLines: true }).data;
}

/** 行 × 列の文字列配列を CSV テキストに変換する（機能仕様書 4.3「変更内容を出力」）。
 *  カンマ・改行・引用符を含むフィールドのダブルクォート囲みは PapaParse が標準で処理する。 */
export function unparseCsv(rows: readonly (readonly string[])[]): string {
  return Papa.unparse(rows as string[][]);
}

export interface CsvRecord {
  [column: string]: string;
}

/** 1行目をヘッダーとして、以降を列名キーのオブジェクト配列に変換する。 */
export function toRecords(rows: string[][]): { header: string[]; records: CsvRecord[] } {
  if (rows.length === 0) {
    return { header: [], records: [] };
  }
  const header = rows[0]!;
  const records: CsvRecord[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]!;
    const record: CsvRecord = {};
    for (let c = 0; c < header.length; c++) {
      record[header[c]!] = row[c] ?? "";
    }
    records.push(record);
  }
  return { header, records };
}
