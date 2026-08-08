// 機能仕様書 3.5「複数プロジェクトの扱い」/ 5.2.5「処理系（致命的）」/ 4.1.5「共通時間軸」を
// 統括するオーケストレータ。UI層はこのクラスのみを介して読み込み状態を操作する。
import { toDateKey } from "../calendar/parseDate";
import type { Edge, FatalErrorInfo, Project, Task, TaskId, WarningInfo } from "../types";
import { exceedsTotalTaskLimit } from "../validate/exceedsTotalTaskLimit";
import { LIMITS } from "../validate/limits";
import { generateColorPalette } from "./colorPalette";
import { processFile, type ProcessedProject } from "./pipeline";
import {
  detectResourceConflicts,
  type ProjectArrowTimings,
  type ResourceConflict,
} from "./resourceConflict";
import { computeBasisDate, computeTimeline } from "./timeline";

export interface AddFilesResult {
  addedProjectKeys: string[];
  rejectedFiles: FatalErrorInfo[];
  warnings: WarningInfo[];
}

const ISOLATED_KEY_SUFFIX = "#isolated"; // 内部識別用。画面には表示しない（3.5.4 プロジェクト名非表示）。

export class Workspace {
  private projects = new Map<string, Project>();
  private rawTextByFileName = new Map<string, string>(); // 休日設定ファイル変更時の再計算用
  private taskIdOwner = new Map<TaskId, string>(); // taskId -> fileName（E206判定用）
  private taskIdsByFileName = new Map<string, TaskId[]>(); // removeFile時の逆引き用
  private taskCountByFileName = new Map<string, number>(); // E401累計判定用（CSV上の生タスク件数）
  private holidayKeys: ReadonlySet<string>;

  constructor(initialHolidayKeys: ReadonlySet<string>) {
    this.holidayKeys = initialHolidayKeys;
  }

  getProjects(): Project[] {
    return [...this.projects.values()];
  }

  /** ステージ[0]（E402判定用、呼び出し元 ui/App.ts）: 読み込み済みファイル数。 */
  getLoadedFileCount(): number {
    return this.rawTextByFileName.size;
  }

  /**
   * 4.1.1/3.7: 休日設定ファイルの置き換え時に呼び出す。所要日数は休日設定に依存するため、
   * 読み込み済みの全ファイルを保持済みの生テキストから再処理する（新規の上限・重複判定は行わない）。
   */
  setHolidayKeys(keys: ReadonlySet<string>): WarningInfo[] {
    this.holidayKeys = keys;

    const fileNames = [...this.rawTextByFileName.keys()];
    this.projects.clear();

    const warnings: WarningInfo[] = [];
    for (const fileName of fileNames) {
      const text = this.rawTextByFileName.get(fileName)!;
      const result = processFile(fileName, text, this.holidayKeys);
      if (!result.ok) continue; // 既読込ファイルは形式的に妥当であることを確認済みのため通常発生しない
      warnings.push(...result.project.warnings);
      this.registerProject(fileName, result.project);
    }

    this.recomputeTimeline();
    warnings.push(...this.collectW315Warnings(fileNames));
    return warnings;
  }

  reset(): void {
    this.projects.clear();
    this.rawTextByFileName.clear();
    this.taskIdOwner.clear();
    this.taskIdsByFileName.clear();
    this.taskCountByFileName.clear();
  }

  removeFile(fileName: string): void {
    this.rawTextByFileName.delete(fileName);
    this.taskCountByFileName.delete(fileName);
    for (const id of this.taskIdsByFileName.get(fileName) ?? []) {
      this.taskIdOwner.delete(id);
    }
    this.taskIdsByFileName.delete(fileName);
    for (const [key, p] of [...this.projects]) {
      if (p.fileName === fileName) this.projects.delete(key);
    }
    this.recomputeTimeline();
  }

  private countAllTasks(): number {
    let total = 0;
    for (const count of this.taskCountByFileName.values()) total += count;
    return total;
  }

  private findCollidingTaskId(ids: readonly TaskId[]): TaskId | null {
    for (const id of ids) {
      if (this.taskIdOwner.has(id)) return id;
    }
    return null;
  }

  private projectKeyFor(fileName: string): string {
    return fileName.replace(/\.[^.]+$/, "");
  }

  /**
   * ステージ[1]〜[12]: ファイル名昇順で1件ずつ処理し、重複・上限違反ファイルのみ個別に拒否する（5.2.5）。
   * ファイル数上限（E402）・サイズ上限（E404）はステージ[0]として呼び出し元（ui/App.ts）で判定済みのため、
   * ここでは受け取った時点で既にステージ[0]を通過したファイルのみを扱う。
   */
  addFiles(files: readonly { name: string; text: string }[]): AddFilesResult {
    const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name, "en"));

    const rejectedFiles: FatalErrorInfo[] = [];
    const addedProjectKeys: string[] = [];
    const warnings: WarningInfo[] = [];

    let cumulativeTaskCount = this.countAllTasks();

    for (const file of sorted) {
      if (this.rawTextByFileName.has(file.name)) {
        rejectedFiles.push({
          code: "E205",
          fileName: file.name,
          message: `ファイル名 "${file.name}" は既に読み込まれています。`,
        });
        continue;
      }

      const result = processFile(file.name, file.text, this.holidayKeys);
      if (!result.ok) {
        rejectedFiles.push(result.error);
        continue;
      }
      const { project } = result;

      const collidingId = this.findCollidingTaskId(project.tasks.map((t) => t.id));
      if (collidingId !== null) {
        rejectedFiles.push({
          code: "E206",
          fileName: file.name,
          message: `タスク ID "${collidingId}" が既読み込みのファイルと重複しています。`,
        });
        continue;
      }

      const taskCountInFile = project.tasks.length;
      if (exceedsTotalTaskLimit(cumulativeTaskCount, taskCountInFile)) {
        rejectedFiles.push({
          code: "E401",
          fileName: file.name,
          message: `タスク件数が読み込み済み全プロジェクト合計の上限（${LIMITS.maxTotalTasks}件）を超えています。`,
        });
        continue;
      }

      this.rawTextByFileName.set(file.name, file.text);
      this.taskCountByFileName.set(file.name, taskCountInFile);
      this.taskIdsByFileName.set(
        file.name,
        project.tasks.map((t) => t.id),
      );
      for (const t of project.tasks) this.taskIdOwner.set(t.id, file.name);
      cumulativeTaskCount += taskCountInFile;
      warnings.push(...project.warnings);

      addedProjectKeys.push(...this.registerProject(file.name, project));
    }

    this.recomputeTimeline();
    warnings.push(...this.collectW315Warnings(addedProjectKeys));

    return { addedProjectKeys, rejectedFiles, warnings };
  }

  /** processFile の結果からプロジェクト（ネットワーク部・孤立タスク部）を登録し、追加したキー一覧を返す。 */
  private registerProject(fileName: string, project: ProcessedProject): string[] {
    const addedKeys: string[] = [];
    const key = this.projectKeyFor(fileName);
    this.projects.set(
      key,
      toProject(key, fileName, {
        tasks: project.networkTasks,
        edges: project.networkEdges,
        isolated: false,
        aoa: project.aoa,
        schedule: project.schedule,
        mergeBufferCandidates: project.mergeBufferCandidates,
      }),
    );
    addedKeys.push(key);

    if (project.isolatedTasks.length > 0 && project.isolatedAoa && project.isolatedSchedule) {
      const isolatedKey = `${key}${ISOLATED_KEY_SUFFIX}`;
      this.projects.set(
        isolatedKey,
        toProject(isolatedKey, fileName, {
          tasks: project.isolatedTasks,
          edges: [],
          isolated: true,
          aoa: project.isolatedAoa,
          schedule: project.isolatedSchedule,
          mergeBufferCandidates: [],
        }),
      );
      addedKeys.push(isolatedKey);
    }
    return addedKeys;
  }

  private collectW315Warnings(keys: readonly string[]): WarningInfo[] {
    const warnings: WarningInfo[] = [];
    for (const key of keys) {
      const p = this.projects.get(key);
      if (p && p.baseDate === null) {
        warnings.push({
          code: "W315",
          fileName: p.fileName,
          message:
            "有効な開始日を持つタスクが1件もないため、共通時間軸上の基準日を決定できません。",
        });
      }
    }
    return warnings;
  }

  /** 4.1.5: 全プロジェクトの基準日・全体原点・オフセットを再計算する。 */
  private recomputeTimeline(): void {
    const basisDates = new Map<string, Date | null>();
    for (const [key, p] of this.projects) {
      basisDates.set(key, computeBasisDate(p.tasks, p.edges).date);
    }
    const timeline = computeTimeline(basisDates, this.holidayKeys);
    for (const [key, p] of this.projects) {
      const offset = timeline.offsetsByProjectKey.get(key) ?? 0;
      const basis = basisDates.get(key) ?? null;
      this.projects.set(key, {
        ...p,
        offsetBusinessDays: offset,
        baseDate: basis === null ? null : toDateKey(basis),
      });
    }
  }

  /** 4.2.4: 全プロジェクト横断の担当者色パレットを再生成する。 */
  getColorPalette(): Map<string, string> {
    const names: string[] = [];
    for (const p of this.projects.values()) {
      for (const t of p.tasks) names.push(...t.assignees);
    }
    return generateColorPalette(names);
  }

  /** 3.5.3: プロジェクト横断のリソース競合を検出する（クリティカルチェーンには反映しない）。 */
  getResourceConflicts(): ResourceConflict[] {
    const input: ProjectArrowTimings[] = [...this.projects.values()].map((p) => ({
      projectKey: p.key,
      offsetBusinessDays: p.offsetBusinessDays,
      arrowTimings: p.arrowTimings,
    }));
    return detectResourceConflicts(input);
  }
}

function toProject(
  key: string,
  fileName: string,
  parts: {
    tasks: Task[];
    edges: Edge[];
    isolated: boolean;
    aoa: ProcessedProject["aoa"];
    schedule: ProcessedProject["schedule"];
    mergeBufferCandidates: ProcessedProject["mergeBufferCandidates"];
  },
): Project {
  return {
    key,
    fileName,
    tasks: parts.tasks,
    edges: parts.edges,
    isolated: parts.isolated,
    events: parts.aoa.events,
    arrows: parts.aoa.arrows,
    eventTimings: parts.schedule.eventTimings,
    arrowTimings: parts.schedule.arrowTimings,
    criticalPaths: parts.schedule.criticalPaths,
    mergeBufferCandidates: parts.mergeBufferCandidates,
    baseDate: null,
    offsetBusinessDays: 0,
  };
}
