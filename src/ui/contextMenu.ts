// 機能仕様書 4.3: 依存関係の手動編集ペインの右クリックメニュー。
// DOM 書き込みは security/dom.ts のヘルパーのみを使う。座標は style 属性ではなく el.style.* で設定する
// （setSwatchColor と同じ方針。style 属性文字列は禁止）。
import { appendChildren, createHtmlElement } from "../security/dom";

export interface ContextMenuItem {
  label: string;
  onSelect: () => void;
}

let activeMenu: HTMLElement | null = null;
let dispose: (() => void) | null = null;

/** 既に開いているメニューを閉じる。 */
export function closeContextMenu(): void {
  if (dispose) dispose();
  dispose = null;
  if (activeMenu && activeMenu.parentNode) {
    activeMenu.parentNode.removeChild(activeMenu);
  }
  activeMenu = null;
}

/** 画面座標 (x, y) にコンテキストメニューを開く。項目選択・外側クリック・Escape で閉じる。 */
export function openContextMenu(x: number, y: number, items: readonly ContextMenuItem[]): void {
  closeContextMenu();

  const menu = createHtmlElement("div", { class: "context-menu", role: "menu" });
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  const buttons = items.map((item) => {
    const button = createHtmlElement("button", { type: "button" }, item.label);
    button.addEventListener("click", () => {
      closeContextMenu();
      item.onSelect();
    });
    return button;
  });
  appendChildren(menu, buttons);

  document.body.appendChild(menu);
  activeMenu = menu;

  const onPointerDown = (event: Event): void => {
    if (event.target instanceof Node && menu.contains(event.target)) return;
    closeContextMenu();
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") closeContextMenu();
  };
  // メニューを開いた同じクリックイベントで閉じないよう、次のタスクで購読する。
  setTimeout(() => {
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
  }, 0);
  dispose = () => {
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("keydown", onKeyDown, true);
  };
}
