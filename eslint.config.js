// ESLint フラット設定。
// src/ 配下と vite.config.ts は TypeScript（型情報付きルール）、scripts/ 配下は
// tsconfig 管理外の Node スクリプトのため型情報なしのJSルールのみを適用する。
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";
import eslintConfigPrettier from "eslint-config-prettier";

// 詳細設計書 7.1 / 機能仕様書 6.2: innerHTML 等の危険な DOM API は
// security/dom.ts 以外での使用を禁止する（唯一の窓口とする）。
const forbiddenDomApiRules = [
  {
    selector:
      "AssignmentExpression[left.type='MemberExpression'][left.property.name=/^(innerHTML|outerHTML)$/]",
    message:
      "innerHTML/outerHTML への直接代入は禁止です。security/dom.ts が提供する安全な API を使用してください（機能仕様書 6.2）。",
  },
  {
    selector:
      "CallExpression[callee.type='MemberExpression'][callee.property.name='insertAdjacentHTML']",
    message:
      "insertAdjacentHTML の使用は禁止です。security/dom.ts が提供する安全な API を使用してください（機能仕様書 6.2）。",
  },
  {
    selector: "CallExpression[callee.object.name='document'][callee.property.name='write']",
    message:
      "document.write の使用は禁止です。security/dom.ts が提供する安全な API を使用してください（機能仕様書 6.2）。",
  },
];

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**"],
  },
  {
    files: ["**/*.ts"],
    extends: [js.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      "no-undef": "off", // TypeScript コンパイラが検出するため無効化
      "no-restricted-syntax": ["error", ...forbiddenDomApiRules],
    },
  },
  {
    // security/dom.ts はルールの唯一の例外（危険な DOM API を扱う窓口そのもののため）。
    files: ["src/security/dom.ts"],
    rules: {
      "no-restricted-syntax": "off",
    },
  },
  {
    files: ["scripts/**/*.js"],
    extends: [js.configs.recommended],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  eslintConfigPrettier,
);
