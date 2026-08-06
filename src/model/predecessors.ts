// 機能仕様書 3.3「先行タスクの記法」の抽出処理。
import { splitAndTrim } from "./splitAndTrim";

const PREDECESSORS_LINE_PATTERN = /^先行タスク:(.*)$/gim;

export interface PredecessorsExtractionResult {
  ids: string[];
  occurrenceCount: number; // 2以上ならE204（複数回出現）
}

/** 説明欄から 先行タスク: の先行タスクID一覧を抽出する。大文字小文字は区別しない。 */
export function extractPredecessors(description: string): PredecessorsExtractionResult {
  const matches = [...description.matchAll(PREDECESSORS_LINE_PATTERN)];
  if (matches.length === 0) {
    return { ids: [], occurrenceCount: 0 };
  }

  const firstMatchValue = matches[0]![1] ?? "";
  const ids = splitAndTrim(firstMatchValue, ",");

  return { ids, occurrenceCount: matches.length };
}
