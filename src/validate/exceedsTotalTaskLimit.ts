// 機能仕様書 3.5 / 5.2.5 E401：読み込み済み全プロジェクトの累計タスク件数が
// 上限を超えるかどうかを判定する純粋な判定ルール（CLAUDE.md「テスト容易性を確保する設計」参照）。
import { LIMITS } from "./limits";

export function exceedsTotalTaskLimit(
  cumulativeTaskCount: number,
  taskCountInFile: number,
): boolean {
  return cumulativeTaskCount + taskCountInFile > LIMITS.maxTotalTasks;
}
