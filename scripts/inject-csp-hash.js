// 機能仕様書 6.3 / 詳細設計書 7.3: CSP の script-src は 'unsafe-inline' を使わず、
// ビルド後の実際のインラインスクリプトのハッシュ値のみを許可する。
// vite build 完了後（dist/index.html 生成後）に実行し、実際のインラインスクリプトの
// SHA-256ハッシュを算出して <meta> タグの script-src プレースホルダーを置き換える。
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distIndexPath = path.join(__dirname, "..", "dist", "index.html");

const html = readFileSync(distIndexPath, "utf-8");

const scriptMatch = html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/);
if (!scriptMatch) {
  throw new Error("inject-csp-hash: ビルド後の index.html にインラインスクリプトが見つかりません。");
}
const scriptContent = scriptMatch[1];

const hash = createHash("sha256").update(scriptContent, "utf-8").digest("base64");
const scriptSrcValue = `'sha256-${hash}'`;

if (!html.includes("script-src 'sha256-PLACEHOLDER'")) {
  throw new Error("inject-csp-hash: CSP meta タグのプレースホルダー（script-src 'sha256-PLACEHOLDER'）が見つかりません。");
}
const updatedHtml = html.replace("script-src 'sha256-PLACEHOLDER'", `script-src ${scriptSrcValue}`);

const metaIndex = updatedHtml.indexOf("Content-Security-Policy");
const scriptIndex = updatedHtml.indexOf("<script", metaIndex);
if (metaIndex === -1 || scriptIndex === -1 || scriptIndex < metaIndex) {
  throw new Error(
    "inject-csp-hash: CSPのmetaタグはインラインスクリプトより前に出力されている必要があります（機能仕様書6.3参照）。",
  );
}

writeFileSync(distIndexPath, updatedHtml, "utf-8");
console.log(`inject-csp-hash: script-src を ${scriptSrcValue} に更新しました。`);
