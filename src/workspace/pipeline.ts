// 機能仕様書 4.1「全体ロジック」ステージ [1]〜[12] のオーケストレーション（ファイル単位）。
import { computeDuration } from "../calendar/businessDays";
import { parseTaskDate } from "../calendar/parseDate";
import { detectMergeBufferCandidates } from "../ccpm/detectMergeBuffers";
import { buildGraph, topologicalSort } from "../graph/buildGraph";
import { computeSchedule } from "../schedule/computeSchedule";
import type { Duration, Edge, FatalErrorInfo, Task, WarningInfo } from "../types";
import { buildAoa } from "../aoa/buildAoa";
import { validateFile } from "../validate/validateFile";

export interface ProcessedProject {
  fileName: string;
  tasks: Task[];
  networkTasks: Task[];
  networkEdges: Edge[];
  isolatedTasks: Task[];
  warnings: WarningInfo[];
  durationsByTaskId: Map<string, Duration>;
  aoa: ReturnType<typeof buildAoa>;
  schedule: ReturnType<typeof computeSchedule>;
  mergeBufferCandidates: ReturnType<typeof detectMergeBufferCandidates>;
  isolatedAoa: ReturnType<typeof buildAoa> | null; // 3.5.5: 孤立タスクの独立プロジェクト
  isolatedSchedule: ReturnType<typeof computeSchedule> | null;
}

export type ProcessFileResult =
  | { ok: true; project: ProcessedProject }
  | { ok: false; error: FatalErrorInfo };

/** ステージ[2]〜[12]: CSVパース以降、AOA変換・時刻計算・CCPMまでを実行する純粋処理。 */
export function processFile(
  fileName: string,
  text: string,
  holidayKeys: ReadonlySet<string>,
): ProcessFileResult {
  const validation = validateFile(fileName, text);
  if (!validation.ok) {
    return { ok: false, error: validation.error };
  }
  const { tasks, edges, warnings } = validation;

  const durationsByTaskId = new Map<string, Duration>();
  for (const task of tasks) {
    const start = task.startDate ? parseTaskDate(task.startDate) : null;
    const due = task.dueDate ? parseTaskDate(task.dueDate) : null;
    if (task.startDate !== null && start === null) {
      warnings.push({
        code: "W307",
        fileName,
        taskId: task.id,
        message: "開始日の形式が不正です。日付欠落として扱います。",
      });
    }
    if (task.dueDate !== null && due === null) {
      warnings.push({
        code: "W307",
        fileName,
        taskId: task.id,
        message: "期限日の形式が不正です。日付欠落として扱います。",
      });
    }

    const result = computeDuration(start, due, holidayKeys);
    durationsByTaskId.set(task.id, {
      taskId: task.id,
      businessDays: result.businessDays,
      placeholder: result.placeholder,
    });

    if (result.placeholder) {
      if (start === null && due === null) {
        warnings.push({ code: "W304", fileName, taskId: task.id, message: "開始日が空欄です。" });
        warnings.push({ code: "W305", fileName, taskId: task.id, message: "期限日が空欄です。" });
      } else if (start === null) {
        warnings.push({ code: "W304", fileName, taskId: task.id, message: "開始日が空欄です。" });
      } else if (due === null) {
        warnings.push({ code: "W305", fileName, taskId: task.id, message: "期限日が空欄です。" });
      } else {
        warnings.push({
          code: "W306",
          fileName,
          taskId: task.id,
          message: "開始日が期限日より後です。",
        });
      }
    } else if (result.businessDays === 0) {
      warnings.push({
        code: "W308",
        fileName,
        taskId: task.id,
        message: "期間内がすべて非営業日のため、所要営業日数が0日です。",
      });
    }
  }

  // ステージ6・8: AONグラフ構築（定期的タスク除外・孤立タスク分離）
  const { activeTasks: networkTasks, activeEdges, isolatedTasks } = buildGraph(tasks, edges);

  if (isolatedTasks.length > 0) {
    for (const t of isolatedTasks) {
      warnings.push({
        code: "W311",
        fileName,
        taskId: t.id,
        message: "先行・後続を持たない孤立タスクです。独立したプロジェクトとして表示します。",
      });
    }
  }

  const order = topologicalSort(networkTasks, activeEdges);
  if ("cycle" in order) {
    return {
      ok: false,
      error: {
        code: "E203",
        fileName,
        message: `依存関係に循環があります: ${order.cycle.join(" → ")}`,
      },
    };
  }

  // ステージ9・10: AOA変換・時刻計算
  const aoa = buildAoa(networkTasks, activeEdges, order, durationsByTaskId);
  const schedule = computeSchedule(aoa.events, aoa.arrows);
  const mergeBufferCandidates = detectMergeBufferCandidates(schedule.arrowTimings);

  // 3.5.5: 孤立タスクをまとめて独立したプロジェクト（レーン）として扱う
  let isolatedAoa: ReturnType<typeof buildAoa> | null = null;
  let isolatedSchedule: ReturnType<typeof computeSchedule> | null = null;
  if (isolatedTasks.length > 0) {
    const isolatedOrder = isolatedTasks.map((t) => t.id);
    isolatedAoa = buildAoa(isolatedTasks, [], isolatedOrder, durationsByTaskId);
    isolatedSchedule = computeSchedule(isolatedAoa.events, isolatedAoa.arrows);
  }

  return {
    ok: true,
    project: {
      fileName,
      tasks,
      networkTasks,
      networkEdges: activeEdges,
      isolatedTasks,
      warnings,
      durationsByTaskId,
      aoa,
      schedule,
      mergeBufferCandidates,
      isolatedAoa,
      isolatedSchedule,
    },
  };
}
