// 機能仕様書 4.1 ステージ[0]：選択ファイル数（E402）・ファイルサイズ（E404）のみで事前検証する。
// ファイル内容を読む前に判定できるよう、名前とサイズだけを見る純粋な判定ルール（呼び出し元の
// FileReader によるI/Oとは分離する。CLAUDE.md「テスト容易性を確保する設計」参照）。
import type { FatalErrorInfo } from "../types";
import { LIMITS } from "./limits";

export interface FileSelectionResult<T> {
  accepted: T[];
  rejected: FatalErrorInfo[];
}

export function selectFilesWithinLimits<T extends { name: string; size: number }>(
  existingFileCount: number,
  files: readonly T[],
): FileSelectionResult<T> {
  const accepted: T[] = [];
  const rejected: FatalErrorInfo[] = [];

  files.forEach((file, index) => {
    if (existingFileCount + index + 1 > LIMITS.maxFiles) {
      rejected.push({
        code: "E402",
        fileName: file.name,
        message: `読み込み可能なファイル数の上限（${LIMITS.maxFiles}件）を超えています。`,
      });
      return;
    }
    if (file.size > LIMITS.maxFileSizeBytes) {
      rejected.push({
        code: "E404",
        fileName: file.name,
        message: `ファイルサイズが上限（${Math.floor(LIMITS.maxFileSizeBytes / (1024 * 1024))}MB）を超えています。`,
      });
      return;
    }
    accepted.push(file);
  });

  return { accepted, rejected };
}
