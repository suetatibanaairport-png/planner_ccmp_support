// 機能仕様書 5.2.5「処理系（致命的）」に定めた処理上限値。
export const LIMITS = {
  maxFiles: 20, // E402
  maxFileSizeBytes: 10 * 1024 * 1024, // E404
  maxTotalTasks: 10_000, // E401（読み込み済み全プロジェクト合計）
  maxAssigneesPerTask: 20, // E405
  maxTaskNameLength: 200, // E406
  maxDescriptionLength: 5000, // E406
} as const;
