# BK P2P System — API仕様書

## 認証方式

- **方式:** Cookie認証（`bkpay_token`）
- **取得:** `POST /api/auth/login` → Set-Cookie
- **有効期間:** 24時間
- **代替:** `Authorization: Bearer <token>` ヘッダー

### 認証区分

| 区分 | 説明 |
|------|------|
| 公開 | 認証不要。顧客向けエンドポイント |
| 保護 | 認証必須。管理者向けエンドポイント |

---

## 認証API（公開）

### POST /api/auth/login
ログインしてセッショントークンを取得。

**Request:**
```json
{ "username": "admin", "password": "bkpay2026" }
```

**Response (200):**
```json
{ "success": true, "token": "26f05b72..." }
```
※ `Set-Cookie: bkpay_token=<token>; HttpOnly; Max-Age=86400; SameSite=Lax`

**Response (認証失敗):**
```json
{ "success": false, "error": "Invalid credentials" }
```

### POST /api/auth/logout
セッションを無効化。

**Response:**
```json
{ "success": true }
```

### GET /api/auth/check
現在のセッションが有効か確認。

**Response:**
```json
{ "success": true }  // or { "success": false }
```

---

## レートAPI（公開）

### GET /api/rates
全暗号通貨のP2Pレートを取得。

**Response:**
```json
{
  "success": true,
  "data": {
    "USDT": {
      "rates": [
        {
          "exchange": "Bybit",
          "crypto": "USDT",
          "buyOrders": [
            {
              "exchange": "Bybit",
              "side": "buy",
              "crypto": "USDT",
              "fiat": "JPY",
              "price": 155.00,
              "available": 1000,
              "minLimit": 10000,
              "maxLimit": 1000000,
              "merchant": {
                "name": "MerchantA",
                "completionRate": 98.5,
                "orderCount": 1234,
                "isOnline": true
              },
              "paymentMethods": ["銀行振込", "PayPay"],
              "fetchedAt": 1709280000000
            }
          ],
          "sellOrders": [...],
          "bestBuy": 155.00,
          "bestSell": 152.00,
          "spread": 3.00,
          "spotPrice": 150.50,
          "buyPremium": 2.99,
          "sellPremium": 1.00,
          "lastUpdated": 1709280000000
        }
      ],
      "bestBuyExchange": { "exchange": "OKX", "price": 153.00 },
      "bestSellExchange": { "exchange": "Bybit", "price": 156.00 },
      "arbitrageOpportunities": [...],
      "spotPrices": { "USDT": 150.50 },
      "lastUpdated": 1709280000000
    }
  }
}
```

### GET /api/rates/:crypto
指定暗号通貨のレートを取得。

**パラメータ:** `crypto` = USDT | BTC | ETH

### GET /api/best
各通貨のベストレートのみ取得。

### GET /api/spread
各取引所のスプレッド情報を取得。

### GET /api/arbitrage
アクティブなアービトラージ機会を取得。

**Response:**
```json
{
  "success": true,
  "data": {
    "USDT": {
      "active": [
        {
          "buyExchange": "OKX",
          "sellExchange": "Bybit",
          "buyPrice": 153.00,
          "sellPrice": 156.00,
          "profitPerUnit": 3.00,
          "profitPercent": 1.96,
          "crypto": "USDT",
          "openedAt": 1709280000000,
          "duration": 120000
        }
      ],
      "closed": [...]
    }
  }
}
```

### POST /api/refresh
手動でレートを更新。

**Request:**
```json
{ "crypto": "USDT" }
```

### GET /api/status
システムステータスを取得。

---

## 注文API

### POST /api/orders（公開）
新規注文を作成。自動マッチングを試行し、失敗時は自社決済にフォールバック。

**Request:**
```json
{
  "amount": 50000,
  "payMethod": "bank",
  "crypto": "USDT"
}
```

| フィールド | 型 | 必須 | 説明 |
|-----------|-----|------|------|
| amount | number | ○ | 日本円金額（最低500円） |
| payMethod | string | △ | bank / paypay / linepay / aupay（デフォルト: bank） |
| crypto | string | △ | USDT / BTC / ETH（デフォルト: USDT） |

**Response:**
```json
{
  "success": true,
  "order": {
    "id": "ORD-MM7A15RO-Y4JU",
    "mode": "auto",
    "status": "pending_payment",
    "amount": 50000,
    "crypto": "USDT",
    "cryptoAmount": 322.58,
    "rate": 155.00,
    "payMethod": "bank",
    "exchange": "Bybit",
    "merchantName": "MerchantA",
    "merchantCompletionRate": 98.5,
    "paymentInfo": {
      "type": "bank",
      "bankName": "みずほ銀行",
      "branchName": "渋谷支店",
      "accountType": "普通",
      "accountNumber": "3058271",
      "accountHolder": "タナカ タロウ",
      "amount": 50000
    },
    "createdAt": 1709280000000,
    "expiresAt": 1709280900000
  }
}
```

### GET /api/orders/:id（公開）
注文状態を取得。

### POST /api/orders/:id/paid（公開）
顧客が振込完了を報告。ステータスが `confirming` に変更。

### POST /api/orders/:id/cancel（公開）
注文をキャンセル。

### GET /api/orders（保護）
全注文一覧を取得（管理者のみ）。

---

## 注文ステータス遷移

```
matching → pending_payment → paid → confirming → completed
                ↓                                    
             cancelled                              
                ↓                                    
             expired（15分経過で自動）                  
```

| ステータス | 説明 |
|-----------|------|
| matching | マッチング検索中 |
| pending_payment | 振込待ち |
| paid | 顧客が振込完了報告済み |
| confirming | 入金確認中 |
| completed | 完了（USDT送付済み） |
| cancelled | キャンセル |
| expired | 15分タイムアウト |

---

## 口座管理API（保護）

### GET /api/accounts
全銀行口座を取得。

### POST /api/accounts
口座を追加。

**Request:**
```json
{
  "bankName": "みずほ銀行",
  "branchName": "渋谷支店",
  "accountType": "普通",
  "accountNumber": "1234567",
  "accountHolder": "タナカ タロウ",
  "dailyLimit": 3000000,
  "priority": "medium",
  "status": "active",
  "memo": ""
}
```

### PUT /api/accounts/:id
口座情報を更新。

### DELETE /api/accounts/:id
口座を削除。

---

## 電子決済API（保護）

### GET /api/epay
全電子決済設定を取得。

### POST /api/epay/:type
電子決済設定を保存。`type` = paypay | linepay | aupay

**Request:**
```json
{
  "payId": "bkstock-pay",
  "displayName": "BK Stock",
  "qrImage": "data:image/png;base64,...",
  "linkUrl": ""
}
```

---

## ウォレットAPI（保護）

### GET /api/wallet
ウォレット設定を取得。

### POST /api/wallet
ウォレットアドレスを保存。

**Request:**
```json
{
  "address": "TXyz...",
  "label": "メインウォレット"
}
```

---

## 取引所API（保護）

### GET /api/trader/status
Puppeteer自動取引のステータスを取得。

### POST /api/trader/credentials
取引所ログイン情報を設定。

**Request:**
```json
{
  "exchange": "Bybit",
  "email": "user@example.com",
  "password": "***",
  "apiKey": "",
  "apiSecret": "",
  "totpSecret": ""
}
```

### GET /api/exchange-creds
設定済み取引所一覧（パスワード等は非表示）。

### POST /api/exchange-creds
取引所認証情報をDBに保存（暗号化）。

---

## 設定API（保護）

### GET /api/settings
システム設定を取得。

### POST /api/settings
設定を更新。

**Request:**
```json
{
  "minCompletion": "90",
  "orderTimeout": "15",
  "minAmount": "500",
  "maxAmount": "1000000",
  "onlineOnly": "yes",
  "fallbackMode": "self"
}
```

---

## エラーレスポンス

全エンドポイント共通:
```json
{ "success": false, "error": "エラーメッセージ" }
```

認証エラー（401）:
```json
{ "success": false, "error": "Unauthorized" }
```
