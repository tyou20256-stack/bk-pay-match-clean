# BK P2P System — APIテスト用curlコマンド集

## 前提

```bash
BASE_URL="http://localhost:3003"
# または
BASE_URL="https://debi-unominous-overcasually.ngrok-free.dev"
```

---

## 1. 認証

### ログイン（Cookieを保存）
```bash
curl -s -X POST $BASE_URL/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"bkpay2026"}' \
  -c cookies.txt
```

### セッション確認
```bash
curl -s $BASE_URL/api/auth/check -b cookies.txt
```

### パスワード変更
```bash
curl -s -X POST $BASE_URL/api/auth/change-password \
  -H 'Content-Type: application/json' \
  -b cookies.txt \
  -d '{"currentPassword":"bkpay2026","newPassword":"newpass123"}'
```

### ログアウト
```bash
curl -s -X POST $BASE_URL/api/auth/logout -b cookies.txt
```

---

## 2. レートAPI（認証不要）

### 全暗号通貨のレート
```bash
curl -s $BASE_URL/api/rates | python3 -m json.tool
```

### USDTのレート
```bash
curl -s $BASE_URL/api/rates/USDT | python3 -m json.tool
```

### BTCのレート
```bash
curl -s $BASE_URL/api/rates/BTC | python3 -m json.tool
```

### ベストレートのみ
```bash
curl -s $BASE_URL/api/best | python3 -m json.tool
```

### スプレッド
```bash
curl -s $BASE_URL/api/spread | python3 -m json.tool
```

### アービトラージ
```bash
curl -s $BASE_URL/api/arbitrage | python3 -m json.tool
```

### ステータス
```bash
curl -s $BASE_URL/api/status | python3 -m json.tool
```

### 手動レート更新
```bash
curl -s -X POST $BASE_URL/api/refresh \
  -H 'Content-Type: application/json' \
  -d '{"crypto":"USDT"}'
```

---

## 3. 注文API

### 注文作成（銀行振込 ¥50,000）
```bash
curl -s -X POST $BASE_URL/api/orders \
  -H 'Content-Type: application/json' \
  -d '{"amount":50000,"payMethod":"bank","crypto":"USDT"}'
```

### 注文作成（PayPay ¥10,000）
```bash
curl -s -X POST $BASE_URL/api/orders \
  -H 'Content-Type: application/json' \
  -d '{"amount":10000,"payMethod":"paypay"}'
```

### 注文確認
```bash
curl -s $BASE_URL/api/orders/ORD-XXXXXXXX-XXXX
```

### 振込完了報告
```bash
curl -s -X POST $BASE_URL/api/orders/ORD-XXXXXXXX-XXXX/paid
```

### 注文キャンセル
```bash
curl -s -X POST $BASE_URL/api/orders/ORD-XXXXXXXX-XXXX/cancel
```

### 全注文一覧（認証必須）
```bash
curl -s $BASE_URL/api/orders -b cookies.txt
```

---

## 4. 口座管理API（認証必須）

### 口座一覧
```bash
curl -s $BASE_URL/api/accounts -b cookies.txt
```

### 口座追加
```bash
curl -s -X POST $BASE_URL/api/accounts \
  -H 'Content-Type: application/json' \
  -b cookies.txt \
  -d '{
    "bankName": "みずほ銀行",
    "branchName": "渋谷支店",
    "accountType": "普通",
    "accountNumber": "1234567",
    "accountHolder": "テスト タロウ",
    "dailyLimit": 3000000,
    "priority": "high",
    "status": "active",
    "memo": "テスト口座"
  }'
```

### 口座更新（休止にする）
```bash
curl -s -X PUT $BASE_URL/api/accounts/1 \
  -H 'Content-Type: application/json' \
  -b cookies.txt \
  -d '{"status":"rest"}'
```

### 口座削除
```bash
curl -s -X DELETE $BASE_URL/api/accounts/1 -b cookies.txt
```

---

## 5. 電子決済API（認証必須）

### 設定一覧
```bash
curl -s $BASE_URL/api/epay -b cookies.txt
```

### PayPay設定
```bash
curl -s -X POST $BASE_URL/api/epay/paypay \
  -H 'Content-Type: application/json' \
  -b cookies.txt \
  -d '{
    "payId": "bkstock-pay",
    "displayName": "BK Stock",
    "qrImage": "",
    "linkUrl": ""
  }'
```

---

## 6. ウォレットAPI（認証必須）

### ウォレット取得
```bash
curl -s $BASE_URL/api/wallet -b cookies.txt
```

### ウォレット設定
```bash
curl -s -X POST $BASE_URL/api/wallet \
  -H 'Content-Type: application/json' \
  -b cookies.txt \
  -d '{"address":"TXyz123...","label":"メインウォレット"}'
```

---

## 7. 設定API（認証必須）

### 設定取得
```bash
curl -s $BASE_URL/api/settings -b cookies.txt
```

### 設定更新
```bash
curl -s -X POST $BASE_URL/api/settings \
  -H 'Content-Type: application/json' \
  -b cookies.txt \
  -d '{
    "minCompletion": "90",
    "orderTimeout": "15",
    "minAmount": "500",
    "maxAmount": "1000000",
    "onlineOnly": "yes",
    "fallbackMode": "self"
  }'
```

---

## 8. 取引所API（認証必須）

### Puppeteerステータス
```bash
curl -s $BASE_URL/api/trader/status -b cookies.txt
```

### 取引所認証情報設定
```bash
curl -s -X POST $BASE_URL/api/trader/credentials \
  -H 'Content-Type: application/json' \
  -b cookies.txt \
  -d '{
    "exchange": "Bybit",
    "email": "user@example.com",
    "password": "xxx",
    "totpSecret": "BASE32SECRET"
  }'
```

### 認証情報一覧（パスワード非表示）
```bash
curl -s $BASE_URL/api/exchange-creds -b cookies.txt
```

---

## 9. テストシナリオ

### フルフロー（注文作成→振込完了→完了）
```bash
# 1. 注文作成
ORDER_ID=$(curl -s -X POST $BASE_URL/api/orders \
  -H 'Content-Type: application/json' \
  -d '{"amount":30000,"payMethod":"bank"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['order']['id'])")
echo "Order: $ORDER_ID"

# 2. 注文確認
curl -s $BASE_URL/api/orders/$ORDER_ID | python3 -m json.tool

# 3. 振込完了
curl -s -X POST $BASE_URL/api/orders/$ORDER_ID/paid | python3 -m json.tool

# 4. 5秒待って完了確認
sleep 6
curl -s $BASE_URL/api/orders/$ORDER_ID | python3 -c "import sys,json;print('Status:',json.load(sys.stdin)['order']['status'])"
```

### レート制限テスト
```bash
# 11回連続ログイン → 11回目で制限
for i in $(seq 1 11); do
  echo -n "Attempt $i: "
  curl -s -X POST $BASE_URL/api/auth/login \
    -H 'Content-Type: application/json' \
    -d '{"username":"bad","password":"bad"}' | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('error','ok'))"
done
```
