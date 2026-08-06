// 機能仕様書 3.5.3「リソース競合」/ 4.1.3 補足の実装。
// クリティカルチェーンの算出には反映しない、情報提供のみの機能。
import type { ArrowTiming, ProjectKey, TaskId } from "../types";

export interface ResourceConflict {
  assignee: string;
  a: { projectKey: ProjectKey; taskId: TaskId };
  b: { projectKey: ProjectKey; taskId: TaskId };
  overlapStartGlobalDay: number;
  overlapEndGlobalDay: number;
}

export interface ProjectArrowTimings {
  projectKey: ProjectKey;
  offsetBusinessDays: number;
  arrowTimings: ArrowTiming[];
}

interface Interval {
  projectKey: ProjectKey;
  taskId: TaskId;
  start: number; // グローバル営業日番号（開始, 含む）
  end: number; // グローバル営業日番号（終了, 含まない）
}

/**
 * 全プロジェクトを横断して、同一担当者（氏名完全一致）が並行して割り当てられている
 * 実作業エッジ（ダミー矢線・未アサインを除く）を検出する（3.5.3）。
 * 比較はプロジェクトをまたぐ組み合わせのみを対象とする。
 */
export function detectResourceConflicts(
  projects: readonly ProjectArrowTimings[],
): ResourceConflict[] {
  const intervalsByAssignee = new Map<string, Interval[]>();

  for (const project of projects) {
    for (const timing of project.arrowTimings) {
      const { arrow } = timing;
      if (arrow.kind !== "activity" || arrow.assignee === undefined || arrow.taskId === undefined) {
        continue;
      }
      const interval: Interval = {
        projectKey: project.projectKey,
        taskId: arrow.taskId,
        start: project.offsetBusinessDays + timing.es,
        end: project.offsetBusinessDays + timing.ef,
      };
      const list = intervalsByAssignee.get(arrow.assignee) ?? [];
      list.push(interval);
      intervalsByAssignee.set(arrow.assignee, list);
    }
  }

  const conflicts: ResourceConflict[] = [];
  for (const [assignee, intervals] of intervalsByAssignee) {
    for (let i = 0; i < intervals.length; i++) {
      for (let j = i + 1; j < intervals.length; j++) {
        const a = intervals[i]!;
        const b = intervals[j]!;
        if (a.projectKey === b.projectKey) continue; // プロジェクト横断のみを対象とする
        const overlapStart = Math.max(a.start, b.start);
        const overlapEnd = Math.min(a.end, b.end);
        if (overlapStart < overlapEnd) {
          conflicts.push({
            assignee,
            a: { projectKey: a.projectKey, taskId: a.taskId },
            b: { projectKey: b.projectKey, taskId: b.taskId },
            overlapStartGlobalDay: overlapStart,
            overlapEndGlobalDay: overlapEnd,
          });
        }
      }
    }
  }

  return conflicts;
}
