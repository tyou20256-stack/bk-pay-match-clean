# BK P2P System — フロー図・状態遷移図

## 1. 注文フロー全体図

```mermaid
sequenceDiagram
    participant C as 顧客
    participant P as BK Pay (pay.html)
    participant S as Server (API)
    participant E as 取引所 (Bybit/Binance/OKX)
    participant R as Account Router
    participant D as SQLite DB

    C->>P: 金額入力 + 支払方法選択
    P->>S: POST /api/orders {amount, payMethod}
    S->>E: GET /api/rates/{crypto}
    E-->>S: P2Pオーダー一覧

    alt マッチ成功 (AUTO MODE)
        S->>S: フィルター (支払方法/金額/完了率90%+/オンライン)
        S->>D: 注文保存 (mode=auto, status=pending_payment)
        S-->>P: 注文情報 + マーチャント振込先
    else マッチ失敗 (SELF MODE)
        S->>R: POST /api/route {amount}
        R-->>S: 口座情報
        S->>D: 注文保存 (mode=self, status=pending_payment)
        S-->>P: 注文情報 + 自社口座振込先
    end

    P-->>C: 振込先を表示 + 15分タイマー開始
    C->>C: 銀行振込を実行
    C->>P: 「振込完了」ボタン
    P->>S: POST /api/orders/:id/paid
    S->>D: status → confirming
    S-->>P: 確認中表示

    Note over S: 入金確認<br/>(現在: 5秒自動確認 / 本番: TronGrid or 銀行API)

    S->>D: status → completed
    S-->>P: 完了表示
```

## 2. 注文ステータス遷移図

```mermaid
stateDiagram-v2
    [*] --> matching: POST /api/orders
    matching --> pending_payment: マッチング完了

    pending_payment --> paid: POST /:id/paid
    pending_payment --> cancelled: POST /:id/cancel
    pending_payment --> expired: 15分経過

    paid --> confirming: 振込確認開始
    confirming --> completed: 入金確認OK

    cancelled --> [*]
    expired --> [*]
    completed --> [*]
```

## 3. 認証フロー

```mermaid
sequenceDiagram
    participant U as ブラウザ
    participant S as Server
    participant D as SQLite DB

    U->>S: POST /api/auth/login {username, password}
    S->>S: SHA-256(password + 'bkpay-salt')
    S->>D: SELECT FROM admin_users WHERE username = ?

    alt パスワード一致
        S->>S: token = randomBytes(32).hex()
        S->>D: INSERT INTO sessions (token, user_id, expires_at)
        S-->>U: Set-Cookie: bkpay_token=xxx (HttpOnly, 24h)
        S-->>U: {success: true, token: "xxx"}
    else パスワード不一致
        S-->>U: {success: false, error: "Invalid credentials"}
    end

    Note over U,S: 以降のリクエスト

    U->>S: GET /api/orders (Cookie: bkpay_token=xxx)
    S->>D: SELECT FROM sessions WHERE token = ? AND expires_at > now
    alt セッション有効
        S-->>U: {success: true, orders: [...]}
    else セッション無効/期限切れ
        S-->>U: 401 {success: false, error: "Unauthorized"}
    end
```

## 4. レート更新フロー

```mermaid
flowchart TD
    A[30秒タイマー] --> B[Aggregator.updateAllCryptos]
    B --> C1[Bybit Fetcher]
    B --> C2[Binance Fetcher]
    B --> C3[OKX Fetcher]
    B --> C4[CoinGecko Spot]

    C1 --> D1[買いオーダー15件]
    C1 --> D2[売りオーダー15件]
    C2 --> D3[買いオーダー15件]
    C2 --> D4[売りオーダー15件]
    C3 --> D5[買いオーダー15件]
    C3 --> D6[売りオーダー15件]
    C4 --> D7[スポットレート]

    D1 & D2 & D3 & D4 & D5 & D6 --> E[乖離率フィルター]
    E --> |スポットから±15%超を除外| F[フィルター済みオーダー]

    F --> G[平均価格計算]
    F --> H[アービトラージ検出]
    F --> I[キャッシュに保存]

    I --> J[/api/rates で取得可能]
    J --> K[フロントエンドが30秒ごとにポーリング]
```

## 5. USDT着金検知フロー

```mermaid
sequenceDiagram
    participant W as TRONウォレット
    participant T as TronGrid API
    participant M as TronMonitor
    participant D as SQLite DB
    participant N as Telegram通知

    loop 30秒ごと
        M->>T: GET /v1/accounts/{addr}/transactions/trc20
        T-->>M: 最新のTRC-20トランザクション

        alt 新しいUSDT入金あり
            M->>D: confirming状態の注文を検索
            alt 金額一致する注文あり
                M->>D: status → completed
                M->>N: 注文完了通知
            else 金額不一致
                M->>N: 不明な入金を通知
            end
        end
    end
```

## 6. 口座ローテーションフロー

```mermaid
flowchart TD
    A[注文: SELF MODE] --> B[getRoutableAccount]
    B --> C{used_today_date = 今日?}
    C -->|No| D[used_today = 0 にリセット]
    C -->|Yes| E[そのまま]
    D --> E

    E --> F[SQLクエリ]
    F --> |status=active<br>used_today+amount<=daily_limit<br>ORDER BY priority, used_today| G{口座あり?}

    G -->|Yes| H[口座を選定]
    H --> I[used_today += amount]
    I --> J[振込先情報を返却]

    G -->|No| K[エラー: 利用可能な口座なし]
```
