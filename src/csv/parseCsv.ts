// 機能仕様書 3.1/3.4 に準拠した RFC 4180 CSV パーサー。
// - BOM 有無どちらも許容
// - CRLF / LF どちらも許容
// - ダブルクォートによる引用、"" エスケープ、引用符内の改行・カンマを正しく解釈する

const BOM = "﻿";

/** CSV テキストをレコード（行 × 列の文字列配列）に変換する。 */
export function parseCsv(text: string): string[][] {
  const src = text.startsWith(BOM) ? text.slice(BOM.length) : text;

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const len = src.length;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  while (i < len) {
    const ch = src[i]!;

    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      pushField();
      i += 1;
      continue;
    }
    if (ch === "\r") {
      // CRLF・単独CR いずれも改行として扱う
      pushRow();
      i += src[i + 1] === "\n" ? 2 : 1;
      continue;
    }
    if (ch === "\n") {
      pushRow();
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }

  // 末尾に未確定のフィールド・行が残っていれば確定する（末尾改行がない場合）
  if (field.length > 0 || row.length > 0) {
    pushRow();
  }

  // 末尾の完全な空行（改行のみで終わるファイル）を除去する
  while (rows.length > 0) {
    const last = rows[rows.length - 1]!;
    if (last.length === 1 && last[0] === "") {
      rows.pop();
    } else {
      break;
    }
  }

  return rows;
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
