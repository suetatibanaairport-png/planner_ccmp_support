import { describe, expect, it } from "vitest";
import { selectFilesWithinLimits } from "../../src/validate/selectFilesWithinLimits";
import { LIMITS } from "../../src/validate/limits";

interface FakeFile {
  name: string;
  size: number;
}

function buildFiles(count: number, sizeBytes = 0): FakeFile[] {
  return Array.from({ length: count }, (_, i) => ({ name: `f${i}.csv`, size: sizeBytes }));
}

describe("selectFilesWithinLimits", () => {
  it("ファイル数が上限以内なら全件受理する", () => {
    const files = buildFiles(LIMITS.maxFiles);
    const result = selectFilesWithinLimits(0, files);
    expect(result.accepted).toHaveLength(LIMITS.maxFiles);
    expect(result.rejected).toEqual([]);
  });

  it("境界値: 既存件数＋今回選択分がちょうど上限の場合は拒否されない", () => {
    const files = buildFiles(3);
    const result = selectFilesWithinLimits(LIMITS.maxFiles - 3, files);
    expect(result.accepted).toHaveLength(3);
    expect(result.rejected).toEqual([]);
  });

  it("既存件数＋今回選択分が上限を1件超える場合、超過分のみE402で拒否される", () => {
    const files = buildFiles(3);
    const result = selectFilesWithinLimits(LIMITS.maxFiles - 2, files);
    expect(result.accepted.map((f) => f.name)).toEqual(["f0.csv", "f1.csv"]);
    expect(result.rejected).toEqual([
      {
        code: "E402",
        fileName: "f2.csv",
        message: `読み込み可能なファイル数の上限（${LIMITS.maxFiles}件）を超えています。`,
      },
    ]);
  });

  it("ファイルサイズが上限を超える場合、E404で拒否される", () => {
    const files = [{ name: "big.csv", size: LIMITS.maxFileSizeBytes + 1 }];
    const result = selectFilesWithinLimits(0, files);
    expect(result.accepted).toEqual([]);
    expect(result.rejected).toEqual([
      {
        code: "E404",
        fileName: "big.csv",
        message: `ファイルサイズが上限（${Math.floor(LIMITS.maxFileSizeBytes / (1024 * 1024))}MB）を超えています。`,
      },
    ]);
  });

  it("境界値: ファイルサイズがちょうど上限の場合は拒否されない", () => {
    const files = [{ name: "ok.csv", size: LIMITS.maxFileSizeBytes }];
    const result = selectFilesWithinLimits(0, files);
    expect(result.accepted).toEqual(files);
    expect(result.rejected).toEqual([]);
  });

  it("空配列を渡した場合は何も受理・拒否しない", () => {
    const result = selectFilesWithinLimits(0, []);
    expect(result.accepted).toEqual([]);
    expect(result.rejected).toEqual([]);
  });

  it("ファイル数上限を超えた以降は、サイズ超過より先にE402が優先される", () => {
    const files = [{ name: "toolate.csv", size: LIMITS.maxFileSizeBytes + 1 }];
    const result = selectFilesWithinLimits(LIMITS.maxFiles, files);
    expect(result.rejected).toEqual([
      {
        code: "E402",
        fileName: "toolate.csv",
        message: `読み込み可能なファイル数の上限（${LIMITS.maxFiles}件）を超えています。`,
      },
    ]);
  });
});
