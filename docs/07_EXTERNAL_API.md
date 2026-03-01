# BK P2P System — 外部API連携仕様

## 概要

本システムは以下の外部APIからP2Pレートを取得しています。
全て**認証不要の公開API**です。

---

## 1. Bybit P2P API

### エンドポイント
```
POST https://api2.bybit.com/fiat/otc/item/online
```

### リクエスト
```json
{
  "tokenId": "USDT",
  "currencyId": "JPY",
  "payment": [],
  "side": "1",
  "size": "15",
  "page": "1"
}
```

| パラメータ | 値 | 説明 |
|-----------|-----|------|
| tokenId | USDT / BTC / ETH | 暗号通貨 |
| currencyId | JPY | 法定通貨 |
| side | "1" = buy, "0" = sell | 売買方向 |
| payment | [] | 空=全支払方法 |
| size | "15" | 取得件数 |
| page | "1" | ページ |

### レスポンス
```json
{
  "result": {
    "items": [
      {
        "price": "155.00",
        "quantity": "1000.00",
        "minAmount": "10000",
        "maxAmount": "1000000",
        "nickName": "MerchantA",
        "recentExecuteRate": 98,
        "recentOrderNum": 1234,
        "isOnline": true,
        "payments": ["1", "2", "3"]
      }
    ]
  }
}
```

### 支払方法コード（Bybit）
| コード | 方法 |
|-------|------|
| 1 | 銀行振込 |
| 2 | PayPay |
| 22 | LINE Pay |

### 注意事項
- レート制限: 明確な文書なし。30秒間隔で安定動作
- 日本からのアクセス: 可能

---

## 2. Binance P2P API

### エンドポイント
```
POST https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search
```

### リクエスト
```json
{
  "asset": "USDT",
  "fiat": "JPY",
  "tradeType": "BUY",
  "page": 1,
  "rows": 15,
  "payTypes": [],
  "publisherType": null
}
```

### レスポンス
```json
{
  "data": [
    {
      "adv": {
        "price": "154.50",
        "surplusAmount": "500.00",
        "minSingleTransAmount": "10000",
        "maxSingleTransAmount": "500000",
        "tradeMethods": [
          { "identifier": "JapanBankTransfer", "tradeMethodName": "銀行振込" }
        ]
      },
      "advertiser": {
        "nickName": "TraderB",
        "monthFinishRate": 0.975,
        "monthOrderCount": 567,
        "userOnlineStatus": "online"
      }
    }
  ]
}
```

### 注意事項
- **日本IPからブロックされることあり**（403エラー）
- レスポンスがgzip圧縮されている場合あり → `Accept-Encoding` ヘッダー注意
- レート制限: 不明。30秒間隔で安定

---

## 3. OKX P2P API

### エンドポイント
```
GET https://www.okx.com/v3/c2c/tradingOrders/books
```

### クエリパラメータ
```
?quoteCurrency=jpy
&baseCurrency=usdt
&side=buy
&paymentMethod=all
&userType=all
&showTrade=false
&showFollow=false
&showAlreadyTraded=false
&isAbleFilter=false
&receivingAds=false
&urlId=0
```

### レスポンス
```json
{
  "data": {
    "buy": [
      {
        "price": "155.00",
        "availableAmount": "800",
        "quoteMinAmountPerOrder": "10000",
        "quoteMaxAmountPerOrder": "1000000",
        "nickName": "TraderC",
        "completedRate": "0.98",
        "completedOrderQuantity": 890,
        "onLine": true,
        "paymentMethods": ["bank"]
      }
    ],
    "sell": [...]
  }
}
```

### 注意事項
- GETメソッド（他の取引所はPOST）
- `side=buy` → 相手が買う＝自分が売る（表示上は逆）

---

## 4. HTX P2P API（無効化済み）

### エンドポイント
```
GET https://www.htx.com/-/x/otc/v1/data/trade-market
```

### パラメータ
```
?coinId=2&currency=11&tradeType=buy&currPage=1
```

### 無効化の理由
- `currency=11` は**JPY（日本円）ではなくRUB（ロシアルーブル）**
- 全通貨ID（1〜30）をスキャンし、JPYに該当するIDがないことを確認
- 返ってくる価格（88〜89）はルーブルのレートとして正確
- 支払方法もSberbank, Tinkoff等のロシアの銀行のみ

### 参考: HTX通貨ID一覧（主要なもの）
| ID | 通貨 | 確認方法 |
|----|------|---------|
| 2 | USD | 価格1.20、Payoneer |
| 4 | CNY | 価格136、Alipay/WeChat |
| 5 | VND | 価格26,811、Bank Transfer (Vietnam) |
| 11 | RUB | 価格88、Sberbank/Tinkoff |
| 17 | PHP | 価格71、Gcash |
| 22 | MYR | 価格3.91、Maybank |

---

## 5. CoinGecko Spot API

### エンドポイント
```
GET https://api.coingecko.com/api/v3/simple/price
  ?ids=tether,bitcoin,ethereum
  &vs_currencies=jpy
```

### レスポンス
```json
{
  "tether": { "jpy": 150.5 },
  "bitcoin": { "jpy": 8500000 },
  "ethereum": { "jpy": 280000 }
}
```

### 用途
- スポットレート（市場基準価格）の取得
- 乖離率の計算基準
- ボリューム閾値の計算

### 注意事項
- 無料枠: 月間10,000リクエスト（30秒間隔で約86,400回/月 → 超過する可能性あり）
- 超過時: 429エラー → エラーハンドリング済み（前回の値をキャッシュ）

---

## 6. Account Router API（内部）

### エンドポイント
```
POST http://localhost:3002/api/route
```

### リクエスト
```json
{
  "amount": 50000,
  "method": "bank"
}
```

### レスポンス
```json
{
  "success": true,
  "account": {
    "id": "1",
    "bankName": "みずほ銀行",
    "branchName": "渋谷支店",
    "accountType": "普通",
    "accountNumber": "3058271",
    "accountHolder": "タナカ タロウ"
  }
}
```

### 注意事項
- 別プロセスとして起動が必要（Port 3002）
- 利用不可時はorderManager.tsのフォールバック口座を使用

---

## レート制限まとめ

| API | 間隔 | 制限 | 備考 |
|-----|------|------|------|
| Bybit | 30秒 | 不明 | 安定動作 |
| Binance | 30秒 | 不明 | 日本IPブロックあり |
| OKX | 30秒 | 不明 | 安定動作 |
| CoinGecko | 30秒 | 10K/月 | 超過注意 |

---

## P2P注文作成APIについて

**重要:** 4取引所とも**P2P注文を作成する公開APIは存在しません。**

- 利用可能なのは**広告一覧（オーダーブック）の取得のみ**
- 実際の注文作成にはWebブラウザでのログインが必要
- → **Puppeteer（ヘッドレスブラウザ）が唯一の自動化手段**

PuppeteerTrader（`src/services/puppeteerTrader.ts`）はこの制約に対応するためのフレームワークです。
