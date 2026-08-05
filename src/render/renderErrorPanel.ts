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

export function renderErrorPanel(container: HTMLElement, errors: readonly FatalErrorInfo[]): void {
  clearChildren(container);

  const entries = errors.map((error) => {
    const fileName = error.fileName ?? "(ファイル不明)";
    const headingLine = createHtmlElement(
      "div",
      { class: "error-entry-heading" },
      `${fileName} - ${stageNameFor(error.code)}`,
    );
    const detailLine = createHtmlElement(
      "div",
      { class: "error-entry-detail" },
      `${error.code}: ${error.message}`,
    );
    const entry = createHtmlElement("div", { class: "error-entry" });
    appendChildren(entry, [headingLine, detailLine]);
    return entry;
  });

  appendChildren(container, entries);
}

/** 5.1: 警告は処理を継続したうえで一覧表示する。致命的エラーと同じパネル内に併記する。 */
export function renderWarningList(container: HTMLElement, warnings: readonly WarningInfo[]): void {
  clearChildren(container);

  const entries = warnings.map((warning) => {
    const taskPart = warning.taskId !== undefined ? `（タスク ID: ${warning.taskId}）` : "";
    const headingLine = createHtmlElement(
      "div",
      { class: "warning-entry-heading" },
      warning.fileName,
    );
    const detailLine = createHtmlElement(
      "div",
      { class: "warning-entry-detail" },
      `${warning.code}: ${warning.message}${taskPart}`,
    );
    const entry = createHtmlElement("div", { class: "warning-entry" });
    appendChildren(entry, [headingLine, detailLine]);
    return entry;
  });

  appendChildren(container, entries);
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
