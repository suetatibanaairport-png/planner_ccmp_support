// 機能仕様書 4.2.4「凡例パネル」の実装。
import { appendChildren, clearChildren, createHtmlElement, setSwatchColor } from "../security/dom";
import { UNASSIGNED_COLOR } from "../workspace/colorPalette";

const UNASSIGNED_LABEL = "未アサイン";

/** 凡例パネルの内容を再構築する（担当者名と色の一覧。色相環の再生成のたびに呼び直す）。 */
export function renderLegend(container: HTMLElement, colorPalette: ReadonlyMap<string, string>): void {
  clearChildren(container);

  const entries: Array<[string, string]> = [...colorPalette.entries()];
  entries.push([UNASSIGNED_LABEL, UNASSIGNED_COLOR]);

  const items = entries.map(([name, color]) => {
    const swatch = createHtmlElement("span", { class: "legend-swatch" });
    setSwatchColor(swatch, color);
    const label = createHtmlElement("span", { class: "legend-label" }, name);
    const row = createHtmlElement("div", { class: "legend-row" });
    appendChildren(row, [swatch, label]);
    return row;
  });

  appendChildren(container, items);
}
