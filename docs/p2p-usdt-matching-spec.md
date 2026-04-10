# P2P USDTマッチングアプリ 実装仕様書

**作成日**: 2026-03-19  
**対象システム**: TruPay連携 P2P USDT購入マッチングプラットフォーム  
**ステータス**: Draft v1.0

---

## 1. システム概要

### 1.1 目的
sloten.ioユーザーの出金申請（JPY→振込）を、USDT購入希望者とP2Pマッチングさせる。
ユーザーが出金申請した振込先口座に購入者が振り込み、着金確認後にUSDTを購入者ウォレットへ送金する。

### 1.2 登場人物
| 役割 | 説明 |
|---|---|
| **出金者** | sloten.ioでの出金申請者（JPYをUSDTに換えたい） |
| **購入者** | USDTをJPYで買いたいユーザー |
| **P2Pアプリ** | 本仕様書の対象システム |
| **TruPay** | 決済バックエンド（出金管理・着金確認） |

### 1.3 フロー全体図

```
[sloten.io 出金申請]
        │
        ▼
[TruPay: approved状態]
   bank_name, account_number, account_name, amount
        │
        ▼
[P2Pアプリ: ポーリング検知]
        │
        ▼
[マッチングキュー登録]
        │
        ▼
[購入者とマッチング]
  ・レート合意 (JPY/USDT)
  ・タイムアウト設定 (30分)
        │
        ▼
[購入者に振込先情報を通知]
  銀行名 / 支店 / 口座番号 / 名義 / 金額
        │
        ▼
[購入者が振込実行]
        │
        ▼
[着金確認]
  A: TruPayポーリング → new_status=32(completed)
  B: 購入者が参照番号入力 → POST /scrapper/match
        │
        ▼
[USDT送金実行]
  購入者ウォレットアドレスへ
        │
        ▼
[完了通知 + 記録]
```

---

## 2. TruPay API 仕様

### 2.1 認証
```
Base URL: https://api.trupay.vip/api/v1
Auth:     Authorization: Bearer {JWT_TOKEN}
```

JWTトークンはログインセッションで発行される。トークン管理については「7. セキュリティ」参照。

---

### 2.2 出金API（コアAPI）

#### ① 未処理出金一覧取得（ポーリング用）
```
GET /withdrawals?new_status=31&per_page=50&page=1
```

> **⚠️ フィルタリング注意**  
> `new_status=31` で取得できる出金は現状すべて国内銀行振込（JPY）だが、  
> 将来的に仮想通貨出金・海外送金が混入した場合の誤マッチングを防ぐため、  
> 取得後に必ず以下の条件でフィルタリングすること。

```javascript
// 国内銀行振込のみに絞り込む安全フィルター
const bankWithdrawals = withdrawals.filter(w =>
  w.is_overseas === 0 &&   // 海外送金を除外
  w.currency === 'JPY' &&  // JPY以外（USDT等）を除外
  w.bank_name &&           // 銀行名が存在する
  w.account_number         // 口座番号が存在する
);
```

**レスポンス例:**
```json
{
  "data": {
    "current_page": 1,
    "total": 348651,
    "data": [
      {
        "id": 651983,
        "system_transaction_id": "P20260319WQE38604",
        "transaction_id": "w120260319173938786",
        "amount": 288000,
        "status": "approved",
        "new_status": 31,
        "bank_name": "みずほ銀行",
        "branch_name": "オリーブBLUE支店",
        "branch_code": "",
        "account_type": "savings",
        "account_number": "6662426",
        "account_name": "ナカジマケイタ",
        "created_at": "2026-03-19 18:11:55",
        "date_completed": null,
        "callback_received": 0
      }
    ]
  }
}
```

**ステータスコード表:**
| new_status | 意味 |
|---|---|
| 21 | applying（申請中） |
| 31 | **approved（承認済み・振込待ち）← マッチング対象** |
| 32 | **completed（完了）← USDT送金トリガー** |
| 33 | declined（却下） |
| 34 | cancelled（キャンセル） |

---

#### ② 出金単件取得
```
GET /withdrawal/{id}
```

**レスポンス:** 上記と同構造の単件データ

---

#### ③ トランザクションID検索
```
GET /withdrawals?transaction_id=w120260319173938786
GET /withdrawals?system_transaction_id=P20260319WQE38604
```

---

#### ④ 着金確認（手動マッチング）
```
POST /scrapper/match
Content-Type: application/json

{
  "id": 651983,
  "reference_number": "振込時の参照番号（購入者入力）",
  "notes": "P2P match confirmed"
}
```

> ⚠️ `reference_number` は購入者が振込時に使った参照番号。これにより自動スクレイパーを待たずに即時確認できる可能性がある。

---

#### ⑤ サマリー取得（モニタリング用）
```
GET /withdrawal/summary/all
```
```json
{
  "data": [{
    "withdrawal_all": 223287387,
    "withdrawal_today": 2412116,
    "withdrawal_month": 64860339
  }]
}
```

---

### 2.3 着金ラグの実測値

| パターン | 所要時間 |
|---|---|
| 最速ケース | **18分** |
| 平均ケース | **20〜40分** |
| 最遅ケース | 60分以上の可能性あり |

→ **タイムアウト設定は60分推奨**（余裕を持って設定）

---

## 3. P2Pアプリ 実装仕様

### 3.1 必要なコンポーネント

```
┌─────────────────────────────────────────┐
│           P2P マッチングアプリ            │
├─────────────┬───────────────────────────┤
│  Poller     │ TruPayポーリングワーカー    │
│  Matcher    │ マッチングエンジン          │
│  Notifier   │ 通知サービス               │
│  Verifier   │ 着金確認サービス            │
│  Sender     │ USDT送金サービス           │
│  DB         │ 状態管理データベース        │
└─────────────┴───────────────────────────┘
```

---

### 3.2 データベース設計

#### `withdrawal_orders` テーブル（出金注文）
```sql
CREATE TABLE withdrawal_orders (
  id                    INTEGER PRIMARY KEY,
  trupay_withdrawal_id  INTEGER UNIQUE NOT NULL,  -- TruPay側のID
  system_transaction_id VARCHAR NOT NULL,
  transaction_id        VARCHAR NOT NULL,
  amount_jpy            DECIMAL(12, 2) NOT NULL,
  bank_name             VARCHAR NOT NULL,
  branch_name           VARCHAR,
  account_number        VARCHAR NOT NULL,
  account_name          VARCHAR NOT NULL,
  status                ENUM('queued','matched','verifying','completed','timeout','error'),
  matched_at            TIMESTAMP,
  completed_at          TIMESTAMP,
  created_at            TIMESTAMP DEFAULT NOW(),
  updated_at            TIMESTAMP DEFAULT NOW()
);
```

#### `p2p_matches` テーブル（マッチング記録）
```sql
CREATE TABLE p2p_matches (
  id                  INTEGER PRIMARY KEY,
  withdrawal_order_id INTEGER REFERENCES withdrawal_orders(id),
  buyer_id            INTEGER NOT NULL,           -- 購入者ユーザーID
  buyer_wallet        VARCHAR NOT NULL,           -- 送金先USDTウォレット
  rate_jpy_usdt       DECIMAL(10, 4) NOT NULL,   -- 合意レート (例: 150.5000)
  amount_jpy          DECIMAL(12, 2) NOT NULL,
  amount_usdt         DECIMAL(12, 6) NOT NULL,   -- 送金するUSDT量
  timeout_at          TIMESTAMP NOT NULL,        -- マッチングタイムアウト時刻
  reference_number    VARCHAR,                   -- 購入者が入力した参照番号
  usdt_tx_hash        VARCHAR,                   -- USDT送金トランザクションハッシュ
  status              ENUM('waiting_transfer','transfer_confirmed','usdt_sent','completed','timeout','cancelled'),
  created_at          TIMESTAMP DEFAULT NOW(),
  updated_at          TIMESTAMP DEFAULT NOW()
);
```

---

### 3.3 Poller（ポーリングワーカー）

**実行間隔**: 1分ごと

```javascript
// poller.js
async function pollWithdrawals() {
  const res = await trupayAPI.get('/withdrawals', {
    params: {
      new_status: 31,        // approved のみ
      per_page: 50,
      page: 1
    }
  });

  for (const withdrawal of res.data.data) {
    // 既にキューに入っているものはスキップ
    const exists = await db.withdrawalOrders.findOne({
      trupay_withdrawal_id: withdrawal.id
    });
    if (exists) continue;

    // 新規出金をキューに登録
    await db.withdrawalOrders.insert({
      trupay_withdrawal_id:  withdrawal.id,
      system_transaction_id: withdrawal.system_transaction_id,
      transaction_id:        withdrawal.transaction_id,
      amount_jpy:            withdrawal.amount,
      bank_name:             withdrawal.bank_name,
      branch_name:           withdrawal.branch_name,
      account_number:        withdrawal.account_number,
      account_name:          withdrawal.account_name,
      status:                'queued'
    });

    // マッチングイベントを発火
    eventEmitter.emit('new_withdrawal', withdrawal);
  }
}

// 毎分実行
setInterval(pollWithdrawals, 60 * 1000);
```

---

### 3.4 Matcher（マッチングエンジン）

```javascript
// matcher.js
async function matchWithdrawal(withdrawal) {
  // 待機中の購入者を検索（金額範囲 ±10%で柔軟マッチング）
  const buyer = await db.buyers.findOne({
    status: 'waiting',
    min_amount_jpy: { $lte: withdrawal.amount },
    max_amount_jpy: { $gte: withdrawal.amount }
  });

  if (!buyer) {
    // マッチング相手なし → キューで待機
    return;
  }

  // レート計算
  const rate = await getExchangeRate(); // 外部レートAPI
  const amountUsdt = withdrawal.amount / rate;

  // マッチング記録作成
  const match = await db.p2pMatches.insert({
    withdrawal_order_id: withdrawal.id,
    buyer_id:            buyer.id,
    buyer_wallet:        buyer.wallet_address,
    rate_jpy_usdt:       rate,
    amount_jpy:          withdrawal.amount,
    amount_usdt:         amountUsdt,
    timeout_at:          new Date(Date.now() + 60 * 60 * 1000), // 60分後
    status:              'waiting_transfer'
  });

  // 購入者に振込情報を通知
  await notifier.send(buyer, {
    message:        '振込先情報',
    bank_name:      withdrawal.bank_name,
    branch_name:    withdrawal.branch_name,
    account_number: withdrawal.account_number,
    account_name:   withdrawal.account_name,
    amount:         withdrawal.amount,
    deadline:       match.timeout_at,
    match_id:       match.id
  });
}
```

---

### 3.5 Verifier（着金確認）

**方式A: TruPayポーリング（自動）**

```javascript
// verifier.js - TruPayポーリング
async function checkCompletedWithdrawals() {
  // マッチング中の全出金IDをまとめて確認
  const pendingMatches = await db.p2pMatches.findAll({ status: 'waiting_transfer' });

  for (const match of pendingMatches) {
    const withdrawal = await db.withdrawalOrders.findOne({
      id: match.withdrawal_order_id
    });

    // TruPayで出金状態を確認
    const res = await trupayAPI.get(`/withdrawal/${withdrawal.trupay_withdrawal_id}`);
    const w = res.data;

    if (w.new_status === 32) { // completed
      // 着金確認 → USDT送金へ
      await handleTransferConfirmed(match);
    } else if (match.timeout_at < new Date()) {
      // タイムアウト処理
      await handleTimeout(match);
    }
  }
}

setInterval(checkCompletedWithdrawals, 60 * 1000); // 毎分
```

**方式B: 購入者が参照番号を入力して即時確認**

```javascript
// verifier.js - 手動マッチング
async function manualMatch(matchId, referenceNumber) {
  const match = await db.p2pMatches.findOne({ id: matchId });
  const withdrawal = await db.withdrawalOrders.findOne({
    id: match.withdrawal_order_id
  });

  // TruPay scrapper/match APIを叩く
  const res = await trupayAPI.post('/scrapper/match', {
    id:               withdrawal.trupay_withdrawal_id,
    reference_number: referenceNumber,
    notes:            `P2P match ID: ${matchId}`
  });

  if (res.data.success) {
    await handleTransferConfirmed(match);
  }
}
```

---

### 3.6 Sender（USDT送金）

```javascript
// sender.js
async function sendUsdt(match) {
  // USDT送金実行（TRON/ETH/BSC等、選択するチェーンに応じて実装）
  const txHash = await usdtWallet.transfer({
    to:     match.buyer_wallet,
    amount: match.amount_usdt,
    chain:  'TRON' // TRC20-USDTを推奨（手数料安い）
  });

  // 送金記録
  await db.p2pMatches.update(match.id, {
    usdt_tx_hash: txHash,
    status:       'usdt_sent'
  });

  // 購入者に完了通知
  await notifier.send(match.buyer_id, {
    message:  `✅ USDT送金完了`,
    amount:   match.amount_usdt,
    tx_hash:  txHash,
    wallet:   match.buyer_wallet
  });
}
```

---

### 3.7 タイムアウト処理

```javascript
// timeout_handler.js
async function handleTimeout(match) {
  await db.p2pMatches.update(match.id, { status: 'timeout' });

  // 出金注文をキューに戻す
  await db.withdrawalOrders.update(match.withdrawal_order_id, {
    status: 'queued'
  });

  // 購入者に通知
  await notifier.send(match.buyer_id, {
    message: '⚠️ タイムアウト: 振込期限が切れました。マッチングをキャンセルします。'
  });

  // 保証金があれば没収ロジック（任意）
}
```

---

## 4. 購入者アプリ UX フロー

```
1. [購入者] USDT購入申請
   └─ 希望金額 (JPY)、ウォレットアドレス入力

2. [アプリ] マッチング待機
   └─ "マッチング中..." 表示

3. [アプリ] マッチング成立通知
   └─ 振込先情報を表示:
      ────────────────────
      銀行名:   みずほ銀行
      支店名:   オリーブBLUE支店
      口座番号: 6662426
      名義:     ナカジマケイタ
      金額:     ¥288,000
      期限:     60分以内
      ────────────────────
      [振込完了を報告する] ボタン

4. [購入者] 振込実行 → アプリで報告
   └─ 参照番号（任意）入力

5. [アプリ] 着金確認（自動 or 手動マッチング）

6. [アプリ] USDT送金完了通知
   └─ TX Hash、送金量を表示
```

---

## 5. リスク管理

### 5.1 不正リスクと対策

| リスク | 対策 |
|---|---|
| 購入者が振込せずにキャンセル | **タイムアウト60分** + 保証金デポジット制度 |
| 同一口座への二重マッチング | `trupay_withdrawal_id` にUNIQUE制約 |
| レート操作 | 外部オラクル（Binance OTC等）の中間値を使用 |
| TruPayトークン期限切れ | Refresh token + エラー時の自動再ログイン |
| スクレイパー遅延 | 最大2時間待機 → タイムアウト後に再キュー |

### 5.2 保証金制度（推奨）
- 購入者登録時にUSDT保証金（例: 50 USDT）をデポジット
- 振込せずタイムアウト → 保証金から手数料を徴収
- 悪質ユーザーはBANリスト登録

---

## 6. インフラ構成（推奨）

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│  フロントエンド  │    │   バックエンド   │    │   TruPay API  │
│  (Next.js)   │◄──►│  (Node.js)   │◄──►│  (外部)      │
└──────────────┘    └──────┬───────┘    └──────────────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
         ┌────────┐  ┌─────────┐  ┌──────────┐
         │ MySQL  │  │  Redis  │  │ USDT     │
         │ (状態管理)│  │ (キュー) │  │ ウォレット  │
         └────────┘  └─────────┘  └──────────┘
```

---

## 7. セキュリティ

### 7.1 TruPay APIキー管理
- JWTトークンはサーバーサイドのみで保持（フロントに露出禁止）
- トークン有効期限監視 → 自動リフレッシュ
- 環境変数 `TRUPAY_JWT` で管理

### 7.2 USDT秘密鍵管理
- ホットウォレット（小額）とコールドウォレット（大額）を分離
- 1回あたりの送金上限を設定（例: 10,000 USDT/回）
- 日次送金上限を設定（例: 100,000 USDT/日）
- HSM（ハードウェアセキュリティモジュール）推奨

### 7.3 振込先情報の取り扱い
- 個人の銀行口座情報（account_name, account_number）はログに残さない
- 表示は購入者本人のみ（セッション管理）
- 振込完了後に即座にデータを暗号化またはマスク

---

## 8. TruPay API エンドポイント チートシート

```bash
# 環境変数
TRUPAY_BASE=https://api.trupay.vip/api/v1
TRUPAY_TOKEN=Bearer eyJ...

# ① 承認済み出金一覧（メインポーリング）
curl "$TRUPAY_BASE/withdrawals?new_status=31&per_page=50" \
  -H "Authorization: $TRUPAY_TOKEN"

# ② 出金単件取得
curl "$TRUPAY_BASE/withdrawal/{id}" \
  -H "Authorization: $TRUPAY_TOKEN"

# ③ 完了済み出金確認（着金確認ポーリング）
curl "$TRUPAY_BASE/withdrawals?new_status=32&per_page=50" \
  -H "Authorization: $TRUPAY_TOKEN"

# ④ 手動スクレイパーマッチング（着金即時確認）
curl -X POST "$TRUPAY_BASE/scrapper/match" \
  -H "Authorization: $TRUPAY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"id": 651983, "reference_number": "REF123", "notes": "P2P match"}'

# ⑤ 出金サマリー（モニタリング用）
curl "$TRUPAY_BASE/withdrawal/summary/all" \
  -H "Authorization: $TRUPAY_TOKEN"

# ⑥ トランザクションID検索（照合用）
curl "$TRUPAY_BASE/withdrawals?transaction_id=w120260319173938786" \
  -H "Authorization: $TRUPAY_TOKEN"
```

---

## 9. 実装フェーズ

| フェーズ | 内容 | 期間目安 |
|---|---|---|
| **Phase 1** | TruPay APIポーリング + DB設計 | 1週間 |
| **Phase 2** | マッチングエンジン + 着金確認（方式A） | 1週間 |
| **Phase 3** | USDT送金 + 購入者通知 | 1週間 |
| **Phase 4** | 購入者フロントエンド | 1〜2週間 |
| **Phase 5** | リスク管理 + 保証金制度 | 1週間 |
| **Phase 6** | テスト + セキュリティ監査 | 1週間 |

**最短MVP: 3週間**（Phase 1〜3のバックエンドのみ）

---

## 10. 未解決事項・要確認

- [ ] USDT送金に使うチェーン（TRC20 / ERC20 / BEP20）の選定
- [ ] レートソース（Binance / Coinbase / 固定レート）の決定
- [ ] 購入者の本人確認（KYC）要否
- [ ] 保証金デポジットの金額・通貨
- [ ] TruPayのJWTトークン有効期限の確認（自動更新の実装要否）
- [ ] 通知手段（Telegram Bot / LINE / メール）の選定
- [ ] `/scrapper/match` の `reference_number` フォーマット仕様確認（TruPay側に問い合わせ要）

---

*本仕様書はTruPay API実地調査（2026-03-19）に基づき作成。*  
*API仕様はTruPay側の更新により変更される可能性があります。*
