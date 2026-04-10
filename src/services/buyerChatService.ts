/**
 * @file buyerChatService.ts — 購入者向けAIサポートチャット
 * @description Claude Haiku APIで購入者のUSDT購入に関する質問に自動対応。
 *   内部情報は一切開示しない。購入フローのガイドのみ。
 */

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const BUYER_SYSTEM_PROMPT = `あなたはPayMatch（P2P暗号通貨購入プラットフォーム）のカスタマーサポートAIです。
USDT購入者からの質問に、丁寧・簡潔に日本語で回答してください。

## PayMatchについて
- 銀行振込でUSDT（TRC-20）を購入できるP2Pプラットフォーム
- アカウント登録不要
- Bybit・Binance・OKXの最安レートで提供
- エスクロー保護あり（支払い確認後にUSDTが送金される）

## 購入フロー
1. 金額入力（¥10,000〜¥10,000,000）
2. TRONウォレットアドレス入力（Tで始まる34文字）
3. マッチング待機（通常 数秒〜数分）
4. 振込先の銀行口座が表示される
5. 指定金額を正確に振込（制限時間: 30分）
6. 振込明細のスクリーンショットをアップロード（必須）
7. AI自動解析 → 着金確認（通常18-40分）
8. USDTがウォレットに送金される

## よくある質問への回答

**ウォレットの作り方:**
Trust WalletまたはTronLinkアプリをインストール → TRONウォレットを作成 → アドレスをコピー

**振込先口座が毎回違う理由:**
P2Pマッチングにより、取引ごとに異なる口座が指定されます。必ずその取引で表示された口座に振り込んでください。

**手数料:**
振込手数料は銀行によります（同行間無料、他行間¥100〜¥440程度）。手数料込みの金額で振り込んでも問題ありません。

**タイムアウトした場合:**
30分以内に振込しないとマッチングがキャンセルされます。再度申請してください。既に振り込んだ場合はサポートにお問い合わせください。

**USDT着金までの時間:**
振込確認後、通常18-40分でウォレットに届きます。

**対応通貨:**
現在USDTのみ（TRC-20/TRONネットワーク）

**ブラウザを閉じてしまった場合:**
30分以内であれば同じページを開くと取引が復元されます。

## 回答ルール
- 簡潔・丁寧に回答
- 内部システム・管理者情報・技術的詳細は一切開示しない
- TruPay、セラー、マッチングエンジン、API等の内部情報には言及しない
- 不明な質問には「サポートチームにお問い合わせください」と案内
- マークダウンの見出し(##)は使わず、**太字**と箇条書きで読みやすくする
- 日本語で回答（ユーザーが他言語で質問した場合はその言語で回答）`;

export async function buyerChat(
  message: string,
  history: ChatMessage[] = []
): Promise<string> {
  if (!ANTHROPIC_API_KEY) {
    return 'サポートチャットは現在利用できません。Telegramチャンネル @paymatch_rates からお問い合わせください。';
  }

  const trimmedHistory = history.slice(-10);

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 512,
        system: BUYER_SYSTEM_PROMPT,
        messages: [
          ...trimmedHistory.map(m => ({ role: m.role, content: m.content })),
          { role: 'user', content: message },
        ],
      }),
    });

    if (!res.ok) {
      return '申し訳ございません。一時的にサポートが利用できません。しばらくしてからお試しください。';
    }

    const data = await res.json() as { content: Array<{ type: string; text?: string }> };
    return data.content?.find(c => c.type === 'text')?.text || '';
  } catch {
    return '接続エラーが発生しました。ページをリロードしてお試しください。';
  }
}
