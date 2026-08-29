// 機能仕様書 6.2 / 詳細設計書 7.1「DOM API の使用ルール」を実装する唯一の窓口。innerHTML /
// outerHTML / insertAdjacentHTML / document.write はこのファイル以外で使用しない。CSV由来の
// 文字列は textContent 経由でのみ表示し、setAttribute には危険な属性名（href, xlink:href,
// style, on*, 属性名/要素名そのもの）を渡さない。

const SVG_NS = "http://www.w3.org/2000/svg";

const FORBIDDEN_ATTRIBUTE_PATTERN = /^(href|xlink:href|style)$/i;
const EVENT_ATTRIBUTE_PATTERN = /^on/i;

/** 危険な属性名を実行時にも弾く安全弁（一次防御はコードレビュー、これは二次防御）。 */
function assertSafeAttributeName(name: string): void {
  if (FORBIDDEN_ATTRIBUTE_PATTERN.test(name) || EVENT_ATTRIBUTE_PATTERN.test(name)) {
    throw new Error(
      `security/dom: 属性 "${name}" は setSafeAttribute 経由での設定を禁止しています（機能仕様書 6.2 参照）`,
    );
  }
}

/** 生成済み要素に属性・テキストを安全に適用する（createHtmlElement/createSvgElement共通処理）。 */
function applyAttrsAndText(
  el: Element,
  attrs?: Record<string, string | number>,
  textContent?: string,
): void {
  if (attrs) {
    for (const [name, value] of Object.entries(attrs)) {
      assertSafeAttributeName(name);
      el.setAttribute(name, String(value));
    }
  }
  if (textContent !== undefined) {
    el.textContent = textContent;
  }
}

/** HTML要素を生成する。CSV由来の文字列は第3引数の textContent としてのみ渡すこと。 */
export function createHtmlElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Record<string, string | number>,
  textContent?: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  applyAttrsAndText(el, attrs, textContent);
  return el;
}

/** SVG要素を生成する（名前空間付き）。 */
export function createSvgElement<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs?: Record<string, string | number>,
  textContent?: string,
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  applyAttrsAndText(el, attrs, textContent);
  return el;
}

/** 任意の文字列（CSV由来を含む）をテキストとして安全に設定する。 */
export function setText(el: Element, text: string): void {
  el.textContent = text;
}

/** 数値・固定列挙値など、アプリ自身が生成した値専用の属性設定。 */
export function setSafeAttribute(el: Element, name: string, value: string | number): void {
  assertSafeAttributeName(name);
  el.setAttribute(name, String(value));
}

/** 子要素を安全に追加するヘルパー（複数可）。 */
export function appendChildren(parent: Element, children: Iterable<Node>): void {
  for (const child of children) {
    parent.appendChild(child);
  }
}

/** 既存の子要素をすべて取り除く（innerHTML = '' を使わない）。 */
export function clearChildren(parent: Element): void {
  while (parent.firstChild) {
    parent.removeChild(parent.firstChild);
  }
}

/**
 * 凡例スウォッチ等の背景色を設定する。渡してよいのは配色パレット（workspace/colorPalette.ts）が
 * 生成した色コードなど、アプリ自身が生成した値に限る。CSV由来の文字列を渡してはならない。
 */
export function setSwatchColor(el: HTMLElement, color: string): void {
  el.style.backgroundColor = color;
}

/** アプリが生成したテキストの data: URI を組み立てる（機能仕様書 4.3 の CSV ダウンロード用）。 */
export function buildDataUri(mimeType: string, text: string): string {
  return `data:${mimeType};charset=utf-8,${encodeURIComponent(text)}`;
}

/**
 * アプリが生成したテキストを名前付きファイルとしてダウンロードさせる（機能仕様書 4.3）。
 * href/download の属性設定はこのモジュール（DOM書き込みの唯一の窓口）でのみ行う。値はいずれも
 * アプリ生成であり、CSV由来の文字列を href/download に渡すことはない。CSP 上、<a download> の
 * ダウンロードはフェッチ制御（connect-src / form-action）の対象外（セキュリティ仕様書 6.3）。
 */
export function downloadTextFile(fileName: string, mimeType: string, text: string): void {
  const anchor = document.createElement("a");
  anchor.setAttribute("href", buildDataUri(mimeType, text));
  anchor.setAttribute("download", fileName);
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}
