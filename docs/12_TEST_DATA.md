# BK P2P System — テストデータ投入ガイド

## テストデータ投入スクリプト

以下のスクリプトで、テスト用の銀行口座・電子決済・設定を一括登録できます。

### 前提: ログイン
```bash
BASE_URL="http://localhost:3003"
curl -s -X POST $BASE_URL/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"bkpay2026"}' \
  -c cookies.txt
```

### 銀行口座（10件）
```bash
ACCOUNTS='[
  {"bankName":"みずほ銀行","branchName":"渋谷支店","accountType":"普通","accountNumber":"3058271","accountHolder":"タナカ タロウ","dailyLimit":3000000,"priority":"high","status":"active","memo":"メイン口座"},
  {"bankName":"三井住友銀行","branchName":"新橋支店","accountType":"普通","accountNumber":"7742190","accountHolder":"サトウ ユウキ","dailyLimit":2000000,"priority":"high","status":"active","memo":""},
  {"bankName":"楽天銀行","branchName":"第一営業支店","accountType":"普通","accountNumber":"4491823","accountHolder":"ヤマモト ケンジ","dailyLimit":5000000,"priority":"medium","status":"active","memo":"上限高め"},
  {"bankName":"住信SBIネット銀行","branchName":"法人第一支店","accountType":"普通","accountNumber":"2287654","accountHolder":"スズキ アヤカ","dailyLimit":3000000,"priority":"medium","status":"active","memo":""},
  {"bankName":"三菱UFJ銀行","branchName":"本店","accountType":"普通","accountNumber":"5513892","accountHolder":"イトウ ハルカ","dailyLimit":3000000,"priority":"medium","status":"active","memo":""},
  {"bankName":"ゆうちょ銀行","branchName":"〇一八","accountType":"普通","accountNumber":"12345671","accountHolder":"ワタナベ ダイキ","dailyLimit":1000000,"priority":"low","status":"active","memo":"上限低め"},
  {"bankName":"りそな銀行","branchName":"池袋支店","accountType":"普通","accountNumber":"8876543","accountHolder":"コバヤシ ミク","dailyLimit":2000000,"priority":"low","status":"active","memo":""},
  {"bankName":"PayPay銀行","branchName":"ビジネス営業部","accountType":"普通","accountNumber":"6654321","accountHolder":"ナカムラ ソウタ","dailyLimit":5000000,"priority":"high","status":"active","memo":"PayPay銀行専用"},
  {"bankName":"GMOあおぞらネット銀行","branchName":"法人営業部","accountType":"普通","accountNumber":"1122334","accountHolder":"キムラ リナ","dailyLimit":3000000,"priority":"medium","status":"rest","memo":"休止中"},
  {"bankName":"セブン銀行","branchName":"マネー支店","accountType":"普通","accountNumber":"9988776","accountHolder":"ヨシダ カズマ","dailyLimit":1000000,"priority":"low","status":"rest","memo":"テスト用"}
]'

echo "$ACCOUNTS" | python3 -c "
import sys, json, subprocess
accounts = json.load(sys.stdin)
for acc in accounts:
    r = subprocess.run(['curl', '-s', '-X', 'POST', 'http://localhost:3003/api/accounts',
        '-H', 'Content-Type: application/json', '-b', 'cookies.txt',
        '-d', json.dumps(acc)], capture_output=True, text=True)
    print(f'  {acc[\"bankName\"]} {acc[\"branchName\"]}: {r.stdout.strip()}')
"
```

### 電子決済設定
```bash
# PayPay
curl -s -X POST $BASE_URL/api/epay/paypay \
  -H 'Content-Type: application/json' -b cookies.txt \
  -d '{"payId":"bkstock-pay","displayName":"BK Stock","qrImage":"","linkUrl":""}'

# LINE Pay
curl -s -X POST $BASE_URL/api/epay/linepay \
  -H 'Content-Type: application/json' -b cookies.txt \
  -d '{"payId":"bkstock-line","displayName":"BK Stock","qrImage":"","linkUrl":"https://line.me/pay/xxx"}'

# au PAY
curl -s -X POST $BASE_URL/api/epay/aupay \
  -H 'Content-Type: application/json' -b cookies.txt \
  -d '{"payId":"bkstock-aupay","displayName":"BK Stock","qrImage":"","linkUrl":""}'
```

### ウォレット設定
```bash
curl -s -X POST $BASE_URL/api/wallet \
  -H 'Content-Type: application/json' -b cookies.txt \
  -d '{"address":"TJKo8mKbQKBH8bCAr2gg8H9kNVcS6rCqBn","label":"テストウォレット"}'
```

### システム設定
```bash
curl -s -X POST $BASE_URL/api/settings \
  -H 'Content-Type: application/json' -b cookies.txt \
  -d '{
    "minCompletion":"90",
    "orderTimeout":"15",
    "minAmount":"500",
    "maxAmount":"1000000",
    "onlineOnly":"yes",
    "fallbackMode":"self"
  }'
```

### テスト注文（5件）
```bash
for amount in 5000 10000 30000 50000 100000; do
  echo -n "¥${amount}: "
  curl -s -X POST $BASE_URL/api/orders \
    -H 'Content-Type: application/json' \
    -d "{\"amount\":${amount},\"payMethod\":\"bank\"}" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['order']['id'],d['order']['mode'])"
done
```

---

## 一括投入スクリプト（コピペで実行）

```bash
#!/bin/bash
# setup-test-data.sh
# テスト環境のデータを一括投入するスクリプト

BASE_URL="${1:-http://localhost:3003}"

echo "=== BK Pay テストデータ投入 ==="
echo "URL: $BASE_URL"

# Login
echo -n "ログイン... "
curl -s -X POST $BASE_URL/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"bkpay2026"}' \
  -c /tmp/bkpay_test_cookies.txt > /dev/null
echo "OK"

C="/tmp/bkpay_test_cookies.txt"

# 口座
echo "=== 口座登録 ==="
for acc in \
  '{"bankName":"みずほ銀行","branchName":"渋谷支店","accountNumber":"3058271","accountHolder":"タナカ タロウ","dailyLimit":3000000,"priority":"high"}' \
  '{"bankName":"三井住友銀行","branchName":"新橋支店","accountNumber":"7742190","accountHolder":"サトウ ユウキ","dailyLimit":2000000,"priority":"high"}' \
  '{"bankName":"楽天銀行","branchName":"第一営業支店","accountNumber":"4491823","accountHolder":"ヤマモト ケンジ","dailyLimit":5000000,"priority":"medium"}' \
  '{"bankName":"住信SBIネット銀行","branchName":"法人第一支店","accountNumber":"2287654","accountHolder":"スズキ アヤカ","dailyLimit":3000000,"priority":"medium"}' \
  '{"bankName":"PayPay銀行","branchName":"ビジネス営業部","accountNumber":"6654321","accountHolder":"ナカムラ ソウタ","dailyLimit":5000000,"priority":"high"}'; do
  echo -n "  "
  curl -s -X POST $BASE_URL/api/accounts -H 'Content-Type: application/json' -b $C -d "$acc" | python3 -c "import sys,json;d=json.load(sys.stdin);print('ID:',d.get('id','ERR'))"
done

# 電子決済
echo "=== 電子決済設定 ==="
curl -s -X POST $BASE_URL/api/epay/paypay -H 'Content-Type: application/json' -b $C -d '{"payId":"bkstock-pay","displayName":"BK Stock"}' > /dev/null && echo "  PayPay OK"
curl -s -X POST $BASE_URL/api/epay/linepay -H 'Content-Type: application/json' -b $C -d '{"payId":"bkstock-line","displayName":"BK Stock"}' > /dev/null && echo "  LINE Pay OK"
curl -s -X POST $BASE_URL/api/epay/aupay -H 'Content-Type: application/json' -b $C -d '{"payId":"bkstock-aupay","displayName":"BK Stock"}' > /dev/null && echo "  au PAY OK"

# 設定
echo "=== 設定 ==="
curl -s -X POST $BASE_URL/api/settings -H 'Content-Type: application/json' -b $C \
  -d '{"minCompletion":"90","orderTimeout":"15","minAmount":"500","maxAmount":"1000000","onlineOnly":"yes","fallbackMode":"self"}' > /dev/null && echo "  OK"

echo ""
echo "=== 完了 ==="
echo "管理画面: $BASE_URL/admin.html"
echo "決済ページ: $BASE_URL/pay.html"

rm -f $C
```

保存先: `scripts/setup-test-data.sh`

```bash
chmod +x scripts/setup-test-data.sh
./scripts/setup-test-data.sh http://localhost:3003
```
