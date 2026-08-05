// 機能仕様書 3.2「列定義」に基づく Task モデルへの正規化。
import type { CsvRecord } from "../csv/parseCsv";
import type { Task } from "../types";

const COLUMNS = {
  taskId: "タスク ID",
  taskName: "タスク名",
  bucketName: "バケット名",
  progress: "進捗状況",
  assignees: "割り当て先",
  startDate: "開始日",
  dueDate: "期限日",
  recurring: "定期的",
  description: "説明",
} as const;

const REQUIRED_COLUMNS = [COLUMNS.taskId, COLUMNS.taskName, COLUMNS.description];

export function hasRequiredColumns(header: string[]): boolean {
  return REQUIRED_COLUMNS.every((col) => header.includes(col));
}

function splitSemicolon(value: string): string[] {
  return value
    .split(";")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
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
    assignees: splitSemicolon(record[COLUMNS.assignees] ?? ""),
    startDate: normalizeDateField(record[COLUMNS.startDate]),
    dueDate: normalizeDateField(record[COLUMNS.dueDate]),
    isRecurring: (record[COLUMNS.recurring] ?? "").trim() === "はい",
    isCompleted: (record[COLUMNS.progress] ?? "").trim() === "完了",
    description: record[COLUMNS.description] ?? "",
  };
}
