// 機能仕様書 3.3「後続タスクの記法」の抽出処理。
import { splitAndTrim } from "./splitAndTrim";

const SUCCESSORS_LINE_PATTERN = /^後続タスク[:：](.*)$/gim;

export interface SuccessorsExtractionResult {
  ids: string[];
  occurrenceCount: number; // 2以上ならE204（複数回出現）
}

/** 説明欄から 後続タスク: の後続タスクID一覧を抽出する。大文字小文字は区別しない。 */
export function extractSuccessors(description: string): SuccessorsExtractionResult {
  const matches = [...description.matchAll(SUCCESSORS_LINE_PATTERN)];
  if (matches.length === 0) {
    return { ids: [], occurrenceCount: 0 };
  }

  const firstMatchValue = matches[0]![1] ?? "";
  const ids = splitAndTrim(firstMatchValue, ",");

  return { ids, occurrenceCount: matches.length };
}
