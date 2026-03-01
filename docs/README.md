# BK P2P System — 開発ドキュメント INDEX

> **対象読者:** 開発チームエンジニア
> **最終更新:** 2026-03-01
> **システムバージョン:** v0.9 (MVP)

---

## このZIPの使い方

**最初に読むべき順番:**

```
① README.md          ← 今読んでいるファイル（全体マップ）
② 01_OVERVIEW.md      ← システムの全体像を掴む（10分）
③ 14_GLOSSARY.md      ← 用語を理解する（5分）
④ 04_SETUP.md         ← ローカルで動かす（15分）
⑤ 12_TEST_DATA.md     ← テストデータを入れる（5分）
```

ここまでで手元で動くシステムが立ち上がります。
以降は担当領域に応じて必要なファイルを参照してください。

---

## ファイル一覧

### 基本情報（全員必読）

| ファイル | 内容 | 読了目安 |
|---------|------|---------|
| **README.md** | 本ファイル。ドキュメント全体のマップと読む順番 | 3分 |
| **00_COMPLETED_TASKS.md** | 完了済みタスク一覧（55項目）。何が実装済みで何が未実装か | 5分 |
| **01_OVERVIEW.md** | システム概要、構成図、画面一覧、ディレクトリ構成、技術スタック | 10分 |
| **14_GLOSSARY.md** | 用語集。AUTO/SELF MODE、マーチャント、スプレッド等のビジネス・システム用語定義。**このシステムがなぜ必要か**の背景説明も含む | 5分 |

### 環境構築・運用

| ファイル | 内容 | 読む人 |
|---------|------|-------|
| **04_SETUP.md** | ローカル環境構築手順。`npm install` → 起動 → 動作確認まで。設定ファイル説明、ngrok設定、トラブルシューティング | 全員 |
| **12_TEST_DATA.md** | テスト用の銀行口座10件・電子決済・設定の投入コマンド。一括投入シェルスクリプト `setup-test-data.sh` の使い方 | 全員 |
| **13_DEPLOY_PRODUCTION.md** | 本番デプロイ手順。PM2プロセス管理、Nginx+SSL設定、DBバックアップ自動化、macOS launchd設定、本番チェックリスト | インフラ担当 |

### API・バックエンド

| ファイル | 内容 | 読む人 |
|---------|------|-------|
| **02_API_SPEC.md** | 全APIエンドポイントの仕様書。メソッド、パス、リクエスト/レスポンスのJSON例、認証区分（公開/保護）、注文ステータス遷移 | バックエンド |
| **03_DATABASE.md** | テーブル定義（7テーブル）、カラム型・制約、ER図、暗号化仕様、口座選定ロジック（SQL）、データライフサイクル | バックエンド |
| **07_EXTERNAL_API.md** | Bybit/Binance/OKX/HTXのP2P APIエンドポイント、リクエスト/レスポンス例、支払方法コード表、レート制限、**HTXが使えない理由の詳細調査結果** | バックエンド |
| **11_API_TEST_COMMANDS.md** | 全APIのcurlコマンド集。コピペで即実行可能。認証→レート→注文→口座→設定の順に整理。フルフローテストシナリオ、レート制限テスト手順 | バックエンド / QA |
| **api.test.ts** | Vitestによる自動テスト（24件）。認証・レート・注文・口座・設定・ウォレットの正常系+異常系。`npx vitest run` で実行 | バックエンド / QA |

### フロントエンド

| ファイル | 内容 | 読む人 |
|---------|------|-------|
| **05_FEATURES.md** | 全画面の機能仕様。ダッシュボードの6種フィルター、BK Payの4ステップウィザード、管理画面の6タブ、マッチングロジック（擬似コード付き） | フロントエンド |
| **06_FRONTEND.md** | CSS設計（テーマ変数/ブレークポイント）、i18nの仕組み、app.js/pay.html/admin.htmlの関数一覧とデータフロー、キャッシュバスティング方法 | フロントエンド |
| **15_SCREENSHOTS_GUIDE.md** | 全画面のASCII図（実際のUI構成を文字で再現）。スクリーンショット取得手順、BK Pay 4ステップの画面遷移図 | フロントエンド / デザイン |

### セキュリティ

| ファイル | 内容 | 読む人 |
|---------|------|-------|
| **08_SECURITY.md** | 認証フロー、AES-256暗号化仕様、公開/保護エンドポイントの境界図、暗号化対象フィールド一覧、既知のリスク6件と対策、**本番前チェックリスト** | 全員（特にインフラ） |

### 設計・計画

| ファイル | 内容 | 読む人 |
|---------|------|-------|
| **09_ROADMAP.md** | 未実装機能（優先度A/B/C）、技術的負債9件、推奨開発順序（Phase 1-4）、各タスクの工数目安 | PL / PM |
| **10_FLOW_DIAGRAMS.md** | Mermaid記法のフロー図6種。注文フロー（シーケンス図）、ステータス遷移、認証フロー、レート更新、USDT着金検知、口座ローテーション。GitHubやVSCodeでそのまま描画可能 | 全員 |
| **16_CHANGELOG_DECISIONS.md** | 設計判断10件の理由とトレードオフ（なぜSQLite？なぜVanilla JS？なぜ30秒間隔？等）。試みて失敗した5件の記録（HTX、Cloudflare tunnel等） | PL / 新規参加者 |

---

## よくある質問（エンジニア向け）

**Q: 開発サーバーの起動方法は？**
```bash
cd bk-p2p-aggregator
npm install
npx tsx src/index.ts
# → http://localhost:3003
```

**Q: テストの実行方法は？**
```bash
# サーバーが起動している状態で
npx vitest run
```

**Q: テストデータの投入方法は？**
```bash
./scripts/setup-test-data.sh http://localhost:3003
```

**Q: 管理画面のログイン情報は？**
```
初期: admin / bkpay2026
URL: http://localhost:3003/admin.html
```

**Q: コードにコメントはある？**
全17ソースファイル（`src/`配下）の冒頭にJSDocコメントで責務・仕様を記述済み。

**Q: Mermaid図を見るには？**
- GitHub: `10_FLOW_DIAGRAMS.md` をブラウザで開けば自動描画
- VSCode: Mermaid Preview拡張をインストール
- CLI: `npx @mermaid-js/mermaid-cli mmdc -i 10_FLOW_DIAGRAMS.md -o flow.png`

**Q: 外部公開（HTTPS）するには？**
```bash
ngrok http 3003
```
詳細は `04_SETUP.md` と `13_DEPLOY_PRODUCTION.md` を参照。

**Q: 何が未実装？何から手を付ける？**
`09_ROADMAP.md` に優先度付きで整理済み。Phase 1（本番必須）から順に。

---

## ファイルサイズ一覧

```
README.md                  ← 本ファイル
00_COMPLETED_TASKS.md       5KB    完了タスク一覧
01_OVERVIEW.md              7KB    システム概要
02_API_SPEC.md              8KB    API仕様書
03_DATABASE.md              6KB    DB設計書
04_SETUP.md                 5KB    環境構築手順
05_FEATURES.md              7KB    機能仕様書
06_FRONTEND.md              6KB    フロントエンド構成
07_EXTERNAL_API.md          6KB    外部API連携仕様
08_SECURITY.md              5KB    セキュリティ設計書
09_ROADMAP.md               5KB    ロードマップ
10_FLOW_DIAGRAMS.md         5KB    フロー図（Mermaid）
11_API_TEST_COMMANDS.md     6KB    curlコマンド集
12_TEST_DATA.md             7KB    テストデータ投入
13_DEPLOY_PRODUCTION.md     7KB    本番デプロイ手順
14_GLOSSARY.md              6KB    用語集
15_SCREENSHOTS_GUIDE.md     5KB    画面操作マニュアル
16_CHANGELOG_DECISIONS.md   7KB    Changelog・設計判断
api.test.ts                 5KB    自動テスト（24件）
─────────────────────────────────
合計: 約113KB / 3,400+行
```
