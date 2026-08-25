# CLAUDE.md

> キーワード：しなければならない/してはならない = 必須、すべきである/すべきでない =　実施しない明確な理由がない限り推奨、してもよい =　任意。

このファイルは、このリポジトリで作業する Claude Code (claude.ai/code) 向けのガイドです。

## 概要
Microsoft 365 Planner の CSV エクスポートからアローダイアグラム（AOA/PERT図）を作成し、CCPM 向けの合流バッファ候補・クリティカルチェーンを算出する、完全オフラインの単一 HTML ファイルツール。バックエンドなし、実行時のネットワーク通信なし — 既定の休日カレンダーを含め、すべてビルド時に1つの `dist/Planner_ccmp_support.html` にバンドルされる。

### コマンド

```bash
npm run dev              # vite開発サーバー
npm run build             # vite build + postbuild.js（dist/Planner_ccmp_support.html を生成）
npm test                  # vitest run（全テスト。--passWithNoTests は使わない）
npx vitest run test/aoa/buildAoa.test.ts   # 単一テストファイル
npx vitest run -t "循環依存"               # 単一テスト（名前指定）
npm run typecheck         # tsc --noEmit
npm run lint              # eslint .
npm run format             # prettier --write .
npm run format:check      # prettier --check .
```

`git commit` を実行すると、Husky の pre-commit フックが上記すべて（加えて `gitleaks protect --staged`）を実行し、`dist/` を再ビルドしてステージに含める。CI（`main` への push/PR）でも同じチェック（加えて `npm audit --omit=dev --audit-level=high`）が走る。gitleaks はローカルに導入していないとコミットが失敗する（`brew install gitleaks`）。

**`dist/Planner_ccmp_support.html` は `.gitignore` 対象外でリポジトリにコミットする。** 実際の配布物そのもの（利用者はビルドせずダウンロードしてそのまま開く）であるため。ソースとの乖離を作らないこと（pre-commit フックが自動で同期する）。ファイル名は固定名と定めている（リネームの仕組みは詳細設計書.md 1章参照）。

### パイプラインのステージ構成（機能仕様書 4.1）

すべての処理は番号付きステージ `[0]`〜`[14]` を流れる。このステージ分割がアーキテクチャ上の最重要な不変事項。

- **ステージ[0]** — `FileList.length`/`File.size` のみを用いたファイル数・サイズの事前検証。ファイル内容の読み込み**より前**に実行する（`ui/App.ts` の `handleFilesSelected`）。上限超過のファイル群を、内容を一切読み込まずに拒否できる。
- **ステージ[1]** — `FileReader` によるI/O（副作用あり、`ui/App.ts`）。
- **ステージ[2]〜[12]** — CSVパース → 検証 → 正規化 → 依存グラフ構築 → AOA変換 → スケジュール算出（ES/LS/クリティカルパス） → CCPMバッファ検出。**副作用を持たない純粋関数群。DOM・I/Oなし。** ファイルごとに独立して1回実行される（1ファイルの致命的エラーが他のファイルの処理を止めない）。単体テストの対象領域。
- **ステージ[13]〜[14]** — プロジェクト横断の集約、レイアウト、SVG描画（副作用あり、`workspace/`・`layout/`・`render/`・`ui/`）。

`workspace/pipeline.ts`（`processFile`）が1ファイル分のステージ2〜12を統括する。`workspace/Workspace.ts` は読み込み済み全ファイルを横断するステートフルなオーケストレータ（ファイルの追加・解除、ファイル間重複検出 E205/E206、共通時間軸）であり、`ui/` が唯一やり取りしてよいクラス。

### モジュール構成（`src/`）

| モジュール | 責務 |
| --- | --- |
| `csv/` | RFC 4180 準拠のCSVパース。[PapaParse](https://www.papaparse.com/)を`src/csv/parseCsv.ts`でラップする |
| `model/` | CSV行 → `Task` への正規化、`後続タスク:` の抽出 |
| `validate/` | ファイル単位のエラー・警告判定（エラー仕様書のエラーコード） |
| `calendar/` | 営業日計算、タスク/休日それぞれの日付パース（書式が異なる。下記参照） |
| `graph/` | AONグラフ構築、トポロジカルソート、循環検出（E203）、孤立タスク分離 |
| `aoa/` | AON → AOA変換：ダミー矢線の挿入・縮約、イベント番号付け |
| `schedule/` | ES/EF/LS/LF、フロート、クリティカルパス |
| `ccpm/` | 合流バッファ候補の検出 |
| `workspace/` | 複数ファイル・複数プロジェクトの状態管理、ファイル間重複排除、配色パレット、共通時間軸 |
| `layout/` | 複数プロジェクトを縦に積んだ座標計算 |
| `render/` | SVG生成 — テキストは必ず `textContent`、属性は必ず `setAttribute` のみで設定 |
| `ui/` | ファイル入力、ヘッダー・フッター、パネル、ズーム/パン。副作用を持つ唯一のエントリーポイント |
| `security/` | `dom.ts` — 詳細は下記 |

`csv/`〜`ccpm/` はDOMに依存しない純粋関数、`workspace/`・`layout/`・`render/`・`ui/` が副作用層。新しい純粋ロジックは対応するモジュールに置くこと（`ui/App.ts` に書かない）。

`csv/` は自前CSVパーサーから [PapaParse](https://www.papaparse.com/) に移行済み（オフライン要件はビルド時バンドルであれば満たせるため、「独自ユーティリティでなくライブラリを使う」ルールとの矛盾はこちらは解消した）。`layout/` の自前レイアウト計算は、汎用グラフレイアウトライブラリが AOA 座標（ES ベースの絶対値へのピン留め）に対応しないため**現状維持と決定済み**（同ルールの意図的な例外）。開発ガイド.md「技術構成」参照。

### 2種類の日付書式（混同注意）

タスクCSVの日付は `YYYY/MM/DD`（`calendar/parseDate.ts` の `parseTaskDate`）、休日CSVは `YYYY-MM-DD`（`parseHolidayDate`）。書式違反はクラッシュではなく警告（W307）— 日付の欠落・不正時は3営業日の仮置き所要日数にフォールバックし（W304/W305/W306）、ジグザグのエッジとして描画される。

### セキュリティ: DOM書き込みは `security/dom.ts` のみ

`innerHTML`/`outerHTML`/`insertAdjacentHTML`/`document.write` は `security/dom.ts` 以外のすべての箇所で禁止されており、ESLintの `no-restricted-syntax` ルール（`config/eslint.config.js` 参照）で機械的に強制している（慣習ではない）。CSV由来の文字列は必ず `textContent` 経由（`createHtmlElement` の第3引数、または `setText`）で扱う。`setSafeAttribute`／`createHtmlElement` の属性引数は `href`/`xlink:href`/`style`/`on*` を実行時にも拒否する（二次防御）。新規のDOM書き込みコードは必ずこのモジュールを経由すること。

### セキュリティ: 依存関係・シークレット・CIのサプライチェーン対策

- 依存関係の脆弱性対策には Dependabot（[.github/dependabot.yml](.github/dependabot.yml)）を使用し、npm・GitHub Actions の依存を自動チェックしなければならない。
- シークレット混入の検出には Gitleaks を使用しなければならない。pre-commit フック（`gitleaks protect --staged`）と CI（`gitleaks-action`）の両方で実行しなければならない。ローカルに未導入の場合はコミットが失敗するため、事前に導入すること（`brew install gitleaks`）。
- `eval`・`Function` コンストラクタ等による動的コード実行を行ってはならない。ESLint の `no-eval`／`no-new-func`（`config/eslint.config.js`）で機械的に強制する。
- GitHub Actions のサードパーティ Action はタグではなくコミット SHA で固定しなければならない（サプライチェーン攻撃対策）。
- CI ジョブの権限は必要最小限（例：`permissions: contents: read`）に限定しなければならない。

### ビルド: 単一ファイル・オフライン・ハッシュ付きCSP

`vite-plugin-singlefile` がJS/CSSをすべて1つのHTMLにインライン化する（`file://` での動作に必須 — このスキームではESモジュールと`fetch`がブロックされるため、CSV/休日ファイルの読み込みは`fetch`ではなく`FileReader`を使う）。`scripts/postbuild.js` がビルド後に実行され、実際にインライン化された `<script>` のSHA-256を計算してCSPの `<meta>` タグの `script-src` に埋め込み、CSPタグがscriptより前に配置されていなければ例外を投げる（あわせて配布物のファイル名リネームも行う。詳細設計書.md 1章参照）。既定の休日CSVは `main.ts` で `import ... from "...csv?raw"` により埋め込まれる（実行時に取得することはない）。

### テストコード・フィクスチャの配置（`test/`）

テストコード（`test/<module>/*.test.ts`、`src/` の構成を `test/` 配下にミラーする）とテストデータ（`test/data/`）はいずれもリポジトリルート直下の `test/` に置く（`src/` にはテストを置かない）。フィクスチャは静的なCSVで、テストコード内で動的生成はしない。`test/data/minimal/`（AOAパターン1件につき1ファイル — 直列、分岐/合流、交差依存、複数担当、孤立タスク、循環）、`test/data/errors/`（E1xx/E2xx/E4xxの各コードにつき1ファイル、および警告をまとめた1ファイル）、`test/data/planner_tasks_planA_ja.csv` / `planner_tasks_planB_ja.csv`（意図的にタスクIDを分離した、実データ相当の結合テスト用フィクスチャ）。各フィクスチャの用途は `docs/テスト仕様書.md` 3章に一覧がある。
