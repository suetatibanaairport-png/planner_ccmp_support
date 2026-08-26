// 機能仕様書 3.2「列定義」に基づく Task モデルへの正規化。
import type { CsvRecord } from "../csv/parseCsv";
import type { Task } from "../types";
import { splitAndTrim } from "./splitAndTrim";

const COLUMNS = {
  taskId: "タスクID",
  taskName: "タスク名",
  bucketName: "バケット",
  progress: "状況",
  assignees: "担当者",
  startDate: "開始日",
  dueDate: "期限",
  recurring: "定期的",
  description: "メモ",
} as const;

const REQUIRED_COLUMNS = [COLUMNS.taskId, COLUMNS.taskName, COLUMNS.description];

/** 列名比較用に空白（半角・全角・タブ等）をすべて除去する。Plannerの出力は「タスク ID」「タスク名 」のように列名に不定の空白を含むことがあるため。 */
function stripSpaces(value: string): string {
  return value.replace(/\s+/g, "");
}

export function hasRequiredColumns(header: string[]): boolean {
  const normalizedHeader = header.map(stripSpaces);
  return REQUIRED_COLUMNS.every((col) => normalizedHeader.includes(stripSpaces(col)));
}

/** 列名の空白差異を許容して値を取得する（完全一致を優先し、無ければ空白除去後の一致を探す）。 */
function getField(record: CsvRecord, columnName: string): string | undefined {
  if (columnName in record) return record[columnName];
  const target = stripSpaces(columnName);
  const key = Object.keys(record).find((k) => stripSpaces(k) === target);
  return key === undefined ? undefined : record[key];
}

function normalizeDateField(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** CSV レコード 1 行を Task へ正規化する。タスクID・タスク名が空の場合は null を返す（E202相当は呼び出し側で判定）。 */
export function normalizeTask(record: CsvRecord): Task | null {
  const id = (getField(record, COLUMNS.taskId) ?? "").trim();
  if (id === "") return null;

  return {
    id,
    name: (getField(record, COLUMNS.taskName) ?? "").trim(),
    bucketName: (getField(record, COLUMNS.bucketName) ?? "").trim(),
    assignees: splitAndTrim(getField(record, COLUMNS.assignees) ?? "", ";"),
    startDate: normalizeDateField(getField(record, COLUMNS.startDate)),
    dueDate: normalizeDateField(getField(record, COLUMNS.dueDate)),
    isRecurring: (getField(record, COLUMNS.recurring) ?? "").trim() === "はい",
    isCompleted: (getField(record, COLUMNS.progress) ?? "").trim() === "完了",
    description: getField(record, COLUMNS.description) ?? "",
  };
}
