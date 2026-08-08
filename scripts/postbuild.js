// vite build 後（dist/index.html 生成後）に実行する postbuild ステップ。
// 1. CSP の script-src ハッシュを算出し、<meta> タグのプレースホルダーを置き換える（機能仕様書 6.3 / 詳細設計書 7.3）
// 2. 配布物のファイル名を固定名にリネームする（vite 入力ファイルは dev サーバー既定エントリのため index.html のまま。要件定義書 5.2）
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const DIST_FILE_NAME = "Planner_ccmp_support.html";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, "..", "dist");
const distIndexPath = path.join(distDir, "index.html");
const distOutputPath = path.join(distDir, DIST_FILE_NAME);

const html = readFileSync(distIndexPath, "utf-8");

const scriptMatch = html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/);
if (!scriptMatch) {
  throw new Error("postbuild: ビルド後の index.html にインラインスクリプトが見つかりません。");
}
const scriptContent = scriptMatch[1];

const hash = createHash("sha256").update(scriptContent, "utf-8").digest("base64");
const scriptSrcValue = `'sha256-${hash}'`;

if (!html.includes("script-src 'sha256-PLACEHOLDER'")) {
  throw new Error(
    "postbuild: CSP meta タグのプレースホルダー（script-src 'sha256-PLACEHOLDER'）が見つかりません。",
  );
}
const updatedHtml = html.replace("script-src 'sha256-PLACEHOLDER'", `script-src ${scriptSrcValue}`);

const metaIndex = updatedHtml.indexOf("Content-Security-Policy");
const scriptIndex = updatedHtml.indexOf("<script", metaIndex);
if (metaIndex === -1 || scriptIndex === -1 || scriptIndex < metaIndex) {
  throw new Error(
    "postbuild: CSPのmetaタグはインラインスクリプトより前に出力されている必要があります（機能仕様書6.3参照）。",
  );
}

writeFileSync(distIndexPath, updatedHtml, "utf-8");
renameSync(distIndexPath, distOutputPath);
console.log(
  `postbuild: script-src を ${scriptSrcValue} に更新し、${DIST_FILE_NAME} を出力しました。`,
);
