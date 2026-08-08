import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// 単一 HTML 配布・file:// 動作を前提とするため、すべてのJS/CSSをHTMLにインライン化する。
// 詳細設計書 1章参照。
export default defineConfig({
  plugins: [viteSingleFile()],
  build: {
    target: "es2022",
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
  },
});
