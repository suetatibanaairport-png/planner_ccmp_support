// 機能仕様書 5.1「方針」のエラー表示パネルの実装。
// パネル形式: 1件につき「<ファイル名> - <ステージ名>」の行 + エラーコード・メッセージの行。
import { appendChildren, clearChildren, createHtmlElement, setSafeAttribute } from "../security/dom";
import type { FatalErrorInfo, WarningInfo } from "../types";

/** 5.1: E1xx=ファイル・パース、E2xx=データ整合性、E4xx=処理。 */
function stageNameFor(code: string): string {
  if (code.startsWith("E1")) return "ファイル・パース";
  if (code.startsWith("E2")) return "データ整合性";
  if (code.startsWith("E4")) return "処理";
  return "エラー";
}

/** 見出し行・詳細行の2行構成のエントリー一覧を描画する共通処理。 */
function renderEntryList<T>(
  container: HTMLElement,
  items: readonly T[],
  entryClassPrefix: string,
  headingFor: (item: T) => string,
  detailFor: (item: T) => string,
): void {
  clearChildren(container);

  const entries = items.map((item) => {
    const headingLine = createHtmlElement(
      "div",
      { class: `${entryClassPrefix}-entry-heading` },
      headingFor(item),
    );
    const detailLine = createHtmlElement(
      "div",
      { class: `${entryClassPrefix}-entry-detail` },
      detailFor(item),
    );
    const entry = createHtmlElement("div", { class: `${entryClassPrefix}-entry` });
    appendChildren(entry, [headingLine, detailLine]);
    return entry;
  });

  appendChildren(container, entries);
}

export function renderErrorPanel(container: HTMLElement, errors: readonly FatalErrorInfo[]): void {
  renderEntryList(
    container,
    errors,
    "error",
    (error) => `${error.fileName ?? "(ファイル不明)"} - ${stageNameFor(error.code)}`,
    (error) => `${error.code}: ${error.message}`,
  );
}

/** 5.1: 警告は処理を継続したうえで一覧表示する。致命的エラーと同じパネル内に併記する。 */
export function renderWarningList(container: HTMLElement, warnings: readonly WarningInfo[]): void {
  renderEntryList(
    container,
    warnings,
    "warning",
    (warning) => warning.fileName,
    (warning) => {
      const taskPart = warning.taskId !== undefined ? `（タスク ID: ${warning.taskId}）` : "";
      return `${warning.code}: ${warning.message}${taskPart}`;
    },
  );
}

/** フッターのエラーボタン右側に表示する丸バッジの件数を更新する（0件ならバッジ非表示）。 */
export function updateErrorBadge(badge: HTMLElement, count: number): void {
  if (count === 0) {
    setSafeAttribute(badge, "hidden", "hidden");
    badge.textContent = "";
    return;
  }
  badge.removeAttribute("hidden");
  badge.textContent = String(count);
}
