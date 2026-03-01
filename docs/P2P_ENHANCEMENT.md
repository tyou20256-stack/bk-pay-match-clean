# Pay Match P2P強化計画

## 統合するOSSツール

### 1. stablecoin-premiums
- **用途**: JPY/USDTプレミアム自動計算
- **統合箇所**: rates.ts のレート取得ロジック
- **効果**: 市場レートとP2Pレートの乖離を自動検出

### 2. AutoP2P (binance-p2p-bot)
- **用途**: Binance P2P広告の自動リプライシング
- **統合箇所**: Puppeteer traderの代替
- **効果**: API経由で安定した広告管理
- **機能**:
  - TOP-1自動入札
  - 競合フィルタリング（5段階）
  - デッドバンド保護
  - 利益範囲制限

### 3. P2P Auto-Bidding Bot
- **用途**: Binance + Bybit同時管理
- **統合箇所**: 新規マーチャント管理モジュール
- **効果**: 両取引所のP2P広告を一元管理

## 実装ロードマップ

### Phase 1: プレミアム監視（1-2日）
- stablecoin-premiumsのBinance P2Pクライアント移植
- JPY/USDTプレミアム計算をdashboardに表示
- アラート: プレミアム>X%で通知

### Phase 2: 自動リプライシング（3-5日）
- AutoP2Pのリプライシングロジック移植
- Pay Match管理画面に広告管理タブ追加
- Telegram通知連携

### Phase 3: デュアル取引所管理（1週間）
- Bybit P2P APIも統合
- Binance+Bybit同時広告管理
- 裁定取引検知

## API要件
- Binance P2P API（公開エンドポイント + 認証済みad管理）
- Bybit C2C API
- 為替レートAPI（XE or Open Exchange Rates）
