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

export function hasRequiredColumns(header: string[]): boolean {
  return REQUIRED_COLUMNS.every((col) => header.includes(col));
}

function normalizeDateField(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** CSV レコード 1 行を Task へ正規化する。タスクID・タスク名が空の場合は null を返す（E202相当は呼び出し側で判定）。 */
export function normalizeTask(record: CsvRecord): Task | null {
  const id = (record[COLUMNS.taskId] ?? "").trim();
  if (id === "") return null;

  return {
    id,
    name: (record[COLUMNS.taskName] ?? "").trim(),
    bucketName: (record[COLUMNS.bucketName] ?? "").trim(),
    assignees: splitAndTrim(record[COLUMNS.assignees] ?? "", ";"),
    startDate: normalizeDateField(record[COLUMNS.startDate]),
    dueDate: normalizeDateField(record[COLUMNS.dueDate]),
    isRecurring: (record[COLUMNS.recurring] ?? "").trim() === "はい",
    isCompleted: (record[COLUMNS.progress] ?? "").trim() === "完了",
    description: record[COLUMNS.description] ?? "",
  };
}
