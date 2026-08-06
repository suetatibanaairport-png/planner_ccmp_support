// ESLint フラット設定。
// src/ 配下と vite.config.ts は TypeScript（型情報付きルール）、scripts/ 配下は
// tsconfig 管理外の Node スクリプトのため型情報なしのJSルールのみを適用する。
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

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
);
