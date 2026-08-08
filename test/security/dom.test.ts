// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  createHtmlElement,
  createSvgElement,
  setSafeAttribute,
  setSwatchColor,
} from "../../src/security/dom";

const XSS_PAYLOADS = [
  "<script>alert(1)</script>",
  "<img src=x onerror=alert(1)>",
  '"><svg onload=alert(1)>',
  "javascript:alert(1)",
];

describe("createHtmlElement: CSV由来文字列はテキストとしてのみ描画される", () => {
  it.each(XSS_PAYLOADS)("payload %s はDOM要素を生成せず文字として表示される", (payload) => {
    const el = createHtmlElement("div", {}, payload);
    // 子要素・スクリプトは一切生成されない
    expect(el.children.length).toBe(0);
    expect(el.querySelector("script")).toBeNull();
    // テキストとしてそのまま保持される（エスケープ後に再解釈されない）
    expect(el.textContent).toBe(payload);
  });

  it('" を含めても属性値からエスケープできない', () => {
    const el = createHtmlElement("div", {}, '"><img src=x onerror=alert(1)>');
    expect(el.outerHTML).not.toContain("<img");
    expect(el.querySelector("img")).toBeNull();
  });
});

describe("setSafeAttribute: 危険な属性名を拒否する", () => {
  it.each(["href", "xlink:href", "style", "onclick", "onerror", "ONCLICK"])(
    "%s は例外を投げる",
    (name) => {
      const el = createHtmlElement("div");
      expect(() => setSafeAttribute(el, name, "x")).toThrow();
    },
  );

  it("class 等の通常属性は許可する", () => {
    const el = createHtmlElement("div");
    expect(() => setSafeAttribute(el, "class", "foo")).not.toThrow();
    expect(el.getAttribute("class")).toBe("foo");
  });
});

describe("createSvgElement: SVG名前空間で生成され、XSS文字列はテキストのみ扱う", () => {
  it("SVG名前空間の要素を生成する", () => {
    const el = createSvgElement("text", {}, "タスクA");
    expect(el.namespaceURI).toBe("http://www.w3.org/2000/svg");
    expect(el.textContent).toBe("タスクA");
  });

  it.each(XSS_PAYLOADS)("payload %s はDOM要素を生成せず文字として表示される", (payload) => {
    const el = createSvgElement("text", {}, payload);
    expect(el.children.length).toBe(0);
    expect(el.textContent).toBe(payload);
  });
});

describe("setSwatchColor: 背景色のみを設定する", () => {
  it("style.backgroundColor に反映される", () => {
    const el = createHtmlElement("span");
    setSwatchColor(el, "rgb(1, 2, 3)");
    expect(el.style.backgroundColor).toBe("rgb(1, 2, 3)");
  });
});
