# Planner CCMP Support

Microsoft 365 Planner が出力する CSV からアローダイアグラム（PERT図）を作成し、CCPM 向けの合流バッファ候補・クリティカルチェーンを算出するオフラインツールです。読み込んだ依存関係はブラウザ上でつなぎ直すこともでき、変更内容は Planner のメモ欄形式の CSV として出力できます。

## 使い方

ビルド不要です。[dist/Planner_ccmp_support.html](dist/Planner_ccmp_support.html) をダウンロードし、ブラウザ（Edge / Chrome）で開いてください。完全オフラインで動作します。

## ドキュメント

背景・目的・要求事項は [docs/要件定義書.md](docs/要件定義書.md)、機能仕様は [docs/機能仕様書.md](docs/機能仕様書.md)、開発方針・コマンドは [docs/開発ガイド.md](docs/開発ガイド.md) を参照してください。

## ライセンス

MIT License。詳細は [LICENSE](LICENSE) を参照してください。