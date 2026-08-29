// 機能仕様書 4.1「全体ロジック」ステージ [1]〜[12] のオーケストレーション（ファイル単位）。
// 手動編集（機能仕様書 4.3 / 詳細設計書 10.1）に対応するため、処理を2段に分ける:
//   parseFileToModel  … CSVテキスト → { tasks, edges, warnings }（ステージ [2]〜[5]。休日非依存）
//   computeProject     … { tasks, edges } → AOA/スケジュール/CCPM（ステージ [6]〜[12]。休日依存）
// processFile は両者の合成（読み込み時の既存経路）。
import { computeDuration } from "../calendar/businessDays";
import { parseTaskDate } from "../calendar/parseDate";
import { detectMergeBufferCandidates } from "../ccpm/detectMergeBuffers";
import { buildGraph, topologicalSort } from "../graph/buildGraph";
import { computeSchedule } from "../schedule/computeSchedule";
import type { Duration, Edge, FatalErrorInfo, Task, WarningInfo } from "../types";
import { buildAoa } from "../aoa/buildAoa";
import { validateFile } from "../validate/validateFile";

export interface FileModel {
  tasks: Task[];
  edges: Edge[]; // validateFile が後続タスクを解決した直後の依存辺（定期的タスク宛ての辺も含む）
  warnings: WarningInfo[]; // パース系の警告（W301〜W303, W309, W310, W312 等）
}

export type ParseModelResult = ({ ok: true } & FileModel) | { ok: false; error: FatalErrorInfo };

export interface ProcessedProject {
  fileName: string;
  tasks: Task[];
  modelEdges: Edge[]; // 手動編集の基準となる依存辺（parseFileToModel の edges）
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
  { ok: true; project: ProcessedProject } | { ok: false; error: FatalErrorInfo };

export type ComputeProjectResult =
  { ok: true; project: ProcessedProject } | { ok: false; error: FatalErrorInfo };

/** ステージ[2]〜[5]: CSVパース・正規化・後続タスク抽出・妥当性検証（休日設定に依存しない）。 */
export function parseFileToModel(fileName: string, text: string): ParseModelResult {
  const validation = validateFile(fileName, text);
  if (!validation.ok) {
    return { ok: false, error: validation.error };
  }
  return {
    ok: true,
    tasks: validation.tasks,
    edges: validation.edges,
    warnings: validation.warnings,
  };
}

/**
 * ステージ[6]〜[12]: 所要日数算出・AOA変換・時刻計算・CCPMまで（休日設定に依存する純粋処理）。
 * baseWarnings にはパース系の警告（parseFileToModel の warnings）を渡す。手動編集による再実行では
 * 保持しておいたパース系警告を渡し、ここで所要日数系・孤立タスク系の警告のみ再生成する。
 */
export function computeProject(
  fileName: string,
  tasks: readonly Task[],
  edges: readonly Edge[],
  holidayKeys: ReadonlySet<string>,
  baseWarnings: readonly WarningInfo[] = [],
): ComputeProjectResult {
  const warnings: WarningInfo[] = [...baseWarnings];

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
  const {
    activeTasks: networkTasks,
    activeEdges,
    isolatedTasks,
  } = buildGraph([...tasks], [...edges]);

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
      tasks: [...tasks],
      modelEdges: [...edges],
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

/** ステージ[2]〜[12]: CSVパース以降、AOA変換・時刻計算・CCPMまでを実行する純粋処理。 */
export function processFile(
  fileName: string,
  text: string,
  holidayKeys: ReadonlySet<string>,
): ProcessFileResult {
  const model = parseFileToModel(fileName, text);
  if (!model.ok) {
    return { ok: false, error: model.error };
  }
  return computeProject(fileName, model.tasks, model.edges, holidayKeys, model.warnings);
}
