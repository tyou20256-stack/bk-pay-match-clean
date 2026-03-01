#!/bin/bash
# BK Pay テストデータ一括投入スクリプト
BASE_URL="${1:-http://localhost:3003}"
echo "=== BK Pay テストデータ投入 ==="
echo "URL: $BASE_URL"

curl -s -X POST $BASE_URL/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"bkpay2026"}' \
  -c /tmp/bkpay_test.txt > /dev/null
C="/tmp/bkpay_test.txt"

echo "=== 口座登録 ==="
for acc in \
  '{"bankName":"みずほ銀行","branchName":"渋谷支店","accountNumber":"3058271","accountHolder":"タナカ タロウ","dailyLimit":3000000,"priority":"high"}' \
  '{"bankName":"三井住友銀行","branchName":"新橋支店","accountNumber":"7742190","accountHolder":"サトウ ユウキ","dailyLimit":2000000,"priority":"high"}' \
  '{"bankName":"楽天銀行","branchName":"第一営業支店","accountNumber":"4491823","accountHolder":"ヤマモト ケンジ","dailyLimit":5000000,"priority":"medium"}' \
  '{"bankName":"住信SBIネット銀行","branchName":"法人第一支店","accountNumber":"2287654","accountHolder":"スズキ アヤカ","dailyLimit":3000000,"priority":"medium"}' \
  '{"bankName":"PayPay銀行","branchName":"ビジネス営業部","accountNumber":"6654321","accountHolder":"ナカムラ ソウタ","dailyLimit":5000000,"priority":"high"}'; do
  echo -n "  "
  curl -s -X POST $BASE_URL/api/accounts -H 'Content-Type: application/json' -b $C -d "$acc" | python3 -c "import sys,json;d=json.load(sys.stdin);print('ID:',d.get('id','ERR'))" 2>/dev/null || echo "OK"
done

echo "=== 電子決済 ==="
curl -s -X POST $BASE_URL/api/epay/paypay -H 'Content-Type: application/json' -b $C -d '{"payId":"bkstock-pay","displayName":"BK Stock"}' > /dev/null && echo "  PayPay OK"
curl -s -X POST $BASE_URL/api/epay/linepay -H 'Content-Type: application/json' -b $C -d '{"payId":"bkstock-line","displayName":"BK Stock"}' > /dev/null && echo "  LINE Pay OK"

echo "=== 設定 ==="
curl -s -X POST $BASE_URL/api/settings -H 'Content-Type: application/json' -b $C \
  -d '{"minCompletion":"90","orderTimeout":"15","minAmount":"500","maxAmount":"1000000","onlineOnly":"yes","fallbackMode":"self"}' > /dev/null && echo "  OK"

echo "=== 完了 ==="
rm -f $C
