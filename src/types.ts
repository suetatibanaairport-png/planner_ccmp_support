// 詳細設計書 4章「データ構造」に対応する共有型定義。

export type TaskId = string;
export type EventId = string;
export type ProjectKey = string;

/** 機能仕様書 3.2 の列定義から正規化したタスク。 */
export interface Task {
  id: TaskId;
  name: string;
  bucketName: string;
  assignees: string[];
  startDate: string | null; // YYYY/MM/DD のまま保持（無効・欠落時は null）
  dueDate: string | null;
  isRecurring: boolean;
  isCompleted: boolean;
  description: string;
}

export interface Edge {
  from: TaskId; // 先行タスク
  to: TaskId; // 後続タスク
}

/** 機能仕様書 4.3 / 詳細設計書 10 章: 依存関係の手動編集の1操作。 */
export interface EditOp {
  kind: "add" | "remove";
  from: TaskId;
  to: TaskId;
}

/** ステージ7（4.1.1）で算出した所要日数。仮置きの場合は placeholder = true。 */
export interface Duration {
  taskId: TaskId;
  businessDays: number;
  placeholder: boolean; // 3.6: 開始日・期限日欠落 or 開始日>期限日 による3日仮置き
}

export interface Event {
  id: EventId;
  number: number; // トポロジカル順の連番（4.2.3 手順7）
}

export type ArrowKind = "activity" | "dummy";

export interface Arrow {
  from: EventId;
  to: EventId;
  kind: ArrowKind;
  taskId?: TaskId;
  assignee?: string; // 3.6 複数担当タスク分割後の担当者
  durationBusinessDays: number; // ダミーは常に0
  placeholder: boolean; // 4.2.4: ジグザグ表示要否
}

/** 4.1.2 の ES/LS/TF（プロジェクト内相対値）。 */
export interface EventTiming {
  eventId: EventId;
  es: number;
  ls: number;
}

export interface ArrowTiming {
  arrow: Arrow;
  es: number;
  ef: number;
  ls: number;
  lf: number;
  totalFloat: number;
  isCritical: boolean;
}

export interface MergeBufferCandidate {
  eventId: EventId;
  feedingArrows: Arrow[]; // クリティカルチェーンに属さない合流辺
}

/** 3.5.6 のデータ不整合検出結果。 */
export interface CrossFileTaskIdCollision {
  taskId: TaskId;
  fileNames: string[];
}

/** 1 CSV ファイル = 1 プロジェクト（3.5）。 */
export interface Project {
  key: ProjectKey; // ファイル名（拡張子除く）
  fileName: string;
  tasks: Task[];
  edges: Edge[];
  isolated: boolean; // 3.5.5: 孤立タスクのみからなる独立プロジェクトか
  events: Event[];
  arrows: Arrow[];
  eventTimings: EventTiming[];
  arrowTimings: ArrowTiming[];
  criticalPaths: Arrow[][]; // 4.1.3: 複数存在しうる
  mergeBufferCandidates: MergeBufferCandidate[];
  baseDate: string | null; // 4.1.5: プロジェクトの基準日（YYYY-MM-DD, 内部正規化済み）
  offsetBusinessDays: number; // 4.1.5: 全体原点からのオフセット
}

export interface FatalErrorInfo {
  code: string; // E1xx / E2xx / E4xx
  fileName: string | null;
  message: string;
}

export interface WarningInfo {
  code: string; // W3xx
  fileName: string;
  taskId?: TaskId;
  message: string;
}
