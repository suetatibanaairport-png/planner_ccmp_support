// 機能仕様書 5章「エラー処理」の判定（ファイル単位）。
// E205/E206（複数ファイルにまたがる判定）は workspace/ 側で行う。
import { parseCsv, toRecords } from "../csv/parseCsv";
import { hasRequiredColumns, normalizeTask } from "../model/normalizeTask";
import { extractSuccessors } from "../model/successors";
import type { Edge, FatalErrorInfo, Task, WarningInfo } from "../types";
import { LIMITS } from "./limits";

export interface FileValidationSuccess {
  ok: true;
  tasks: Task[];
  edges: Edge[];
  warnings: WarningInfo[];
}

export interface FileValidationFailure {
  ok: false;
  error: FatalErrorInfo;
}

export type FileValidationResult = FileValidationSuccess | FileValidationFailure;

function fatal(code: string, fileName: string, message: string): FileValidationFailure {
  return { ok: false, error: { code, fileName, message } };
}

export function validateFile(fileName: string, text: string): FileValidationResult {
  const rows = parseCsv(text);

  // E102: ヘッダー行が存在しない
  if (rows.length === 0) {
    return fatal("E102", fileName, "ヘッダー行が存在しません。");
  }

  const { header, records } = toRecords(rows);

  // E103: 必須列（タスクID／タスク名／メモ）が存在しない
  if (!hasRequiredColumns(header)) {
    return fatal("E103", fileName, "必須列（タスクID／タスク名／メモ）が見つかりません。");
  }

  // E105: データ行が0件
  if (records.length === 0) {
    return fatal("E105", fileName, "データ行がありません。");
  }

  const warnings: WarningInfo[] = [];
  const tasks: Task[] = [];
  const seenIds = new Set<string>();

  for (let i = 0; i < records.length; i++) {
    const record = records[i]!;
    const rowNumber = i + 2; // 1行目はヘッダー
    const task = normalizeTask(record);

    // E202: タスクIDが空欄の行がある
    if (task === null) {
      return fatal("E202", fileName, `${rowNumber} 行目のタスク ID が空欄です。`);
    }

    // E201: 同一ファイル内でタスクIDが重複している
    if (seenIds.has(task.id)) {
      return fatal("E201", fileName, `タスク ID "${task.id}" が重複しています。`);
    }
    seenIds.add(task.id);

    // E406: 1フィールドの文字数上限
    if (task.name.length > LIMITS.maxTaskNameLength) {
      return fatal(
        "E406",
        fileName,
        `タスク名がフィールド長の上限（${LIMITS.maxTaskNameLength}文字）を超えています（タスク ID: ${task.id}）。`,
      );
    }
    if (task.description.length > LIMITS.maxDescriptionLength) {
      return fatal(
        "E406",
        fileName,
        `説明欄がフィールド長の上限（${LIMITS.maxDescriptionLength}文字）を超えています（タスク ID: ${task.id}）。`,
      );
    }

    // E405: 1タスクあたりの担当者数上限
    if (task.assignees.length > LIMITS.maxAssigneesPerTask) {
      return fatal(
        "E405",
        fileName,
        `担当者数が上限（${LIMITS.maxAssigneesPerTask}名）を超えています（タスク ID: ${task.id}）。`,
      );
    }

    // W309: 担当者が空欄
    if (task.assignees.length === 0) {
      warnings.push({
        code: "W309",
        fileName,
        taskId: task.id,
        message: "担当者が空欄です。「未アサイン」として扱います。",
      });
    }

    tasks.push(task);
  }

  // E401 相当（合計上限）は workspace/ 側で他プロジェクトと合算して判定する。
  if (tasks.length > LIMITS.maxTotalTasks) {
    return fatal(
      "E401",
      fileName,
      `タスク件数が処理上限（${LIMITS.maxTotalTasks}件）を超えています。`,
    );
  }

  // 後続タスク抽出 → 依存辺の構築
  const taskIds = new Set(tasks.map((t) => t.id));
  const edges: Edge[] = [];
  let anySuccessorsDeclared = false;

  for (const task of tasks) {
    const { ids, occurrenceCount } = extractSuccessors(task.description);

    // E204: 説明欄に 後続タスク: が複数回出現している
    if (occurrenceCount >= 2) {
      return fatal(
        "E204",
        fileName,
        `タスク ID "${task.id}" の説明欄に 後続タスク: が複数回出現しています。`,
      );
    }

    if (occurrenceCount === 1) {
      anySuccessorsDeclared = true;
    }

    const seenSuccessorIds = new Set<string>();
    for (const successorId of ids) {
      // W302: 自己参照
      if (successorId === task.id) {
        warnings.push({
          code: "W302",
          fileName,
          taskId: task.id,
          message: "自分自身を後続タスクに指定しています。この依存辺は無視します。",
        });
        continue;
      }
      // W303: 同一の後続IDが重複記載されている
      if (seenSuccessorIds.has(successorId)) {
        warnings.push({
          code: "W303",
          fileName,
          taskId: task.id,
          message: `後続タスク ID "${successorId}" が重複して記載されています。`,
        });
        continue;
      }
      seenSuccessorIds.add(successorId);

      // W301: 後続タスクの参照先IDが存在しない
      if (!taskIds.has(successorId)) {
        warnings.push({
          code: "W301",
          fileName,
          taskId: task.id,
          message: `後続タスク ID "${successorId}" が見つかりません。この依存辺は無視します。`,
        });
        continue;
      }

      edges.push({ from: task.id, to: successorId });
    }

    // W312: 定期的＝はい のタスク（対応範囲外）
    if (task.isRecurring) {
      warnings.push({
        code: "W312",
        fileName,
        taskId: task.id,
        message: "定期的タスクは対応範囲外のため、ネットワークから除外します。",
      });
    }
  }

  // W310: 後続タスクの記載が1件もない
  if (!anySuccessorsDeclared) {
    warnings.push({
      code: "W310",
      fileName,
      message: "このファイルには 後続タスク: の記載が1件もありません。",
    });
  }

  return { ok: true, tasks, edges, warnings };
}
