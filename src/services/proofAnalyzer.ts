/**
 * @file proofAnalyzer.ts — 振込明細スクショAI解析
 * @description Claude Vision APIで振込明細を解析し、マッチング情報と照合してスコアリング。
 *   スコア80以上: 自動承認 / スコア80未満: Telegram通知→手動承認
 */
import fs from 'fs';
import path from 'path';
import logger from './logger.js';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001'; // Fast + cheap for OCR

export interface ProofAnalysisResult {
  score: number;              // 0-100
  extractedData: {
    transferTime?: string;    // 振込日時
    bankName?: string;        // 銀行名
    branchName?: string;      // 支店名
    accountNumber?: string;   // 口座番号
    accountName?: string;     // 名義
    amount?: number;          // 振込金額
    amountWithFee?: number;   // 手数料込み金額
    fee?: number;             // 手数料
  };
  matchDetails: {
    bankNameMatch: boolean;
    accountNumberMatch: boolean;
    accountNameMatch: boolean;
    amountMatch: boolean;     // 金額一致（±手数料許容）
  };
  confidence: 'high' | 'medium' | 'low';
  reason: string;             // スコアの理由
  rawAnalysis: string;        // AIの生の分析結果
}

interface ExpectedData {
  bankName: string;
  branchName: string;
  accountNumber: string;
  accountName: string;
  amountJpy: number;
}

/**
 * 振込明細スクショをAIで解析し、期待値と照合
 */
export async function analyzeProof(
  imagePath: string,
  expected: ExpectedData,
): Promise<ProofAnalysisResult> {
  if (!ANTHROPIC_API_KEY) {
    logger.warn('ProofAnalyzer: ANTHROPIC_API_KEY not set, returning low score');
    return {
      score: 0,
      extractedData: {},
      matchDetails: { bankNameMatch: false, accountNumberMatch: false, accountNameMatch: false, amountMatch: false },
      confidence: 'low',
      reason: 'API key not configured',
      rawAnalysis: '',
    };
  }

  // Read image and convert to base64
  const fullPath = path.isAbsolute(imagePath) ? imagePath : path.join(process.cwd(), 'data', 'proofs', imagePath);
  if (!fs.existsSync(fullPath)) {
    return {
      score: 0,
      extractedData: {},
      matchDetails: { bankNameMatch: false, accountNumberMatch: false, accountNameMatch: false, amountMatch: false },
      confidence: 'low',
      reason: 'Image file not found',
      rawAnalysis: '',
    };
  }

  const imageBuffer = await fs.promises.readFile(fullPath);
  const base64Image = imageBuffer.toString('base64');
  const ext = path.extname(fullPath).toLowerCase();
  const mediaType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';

  // Call Claude Vision API
  const prompt = `この画像は銀行振込の明細書・確認画面のスクリーンショットです。以下の情報を抽出してJSON形式で返してください。

抽出する項目:
- transfer_time: 振込日時（例: "2026-03-24 15:30"）
- bank_name: 振込先銀行名
- branch_name: 振込先支店名
- account_number: 振込先口座番号
- account_name: 振込先名義（カタカナ）
- amount: 振込金額（数値のみ、カンマなし）
- fee: 振込手数料（数値のみ。不明の場合null）
- amount_with_fee: 手数料込み合計（数値のみ。不明の場合null）

以下の期待値と照合してください:
- 期待する銀行名: ${expected.bankName}
- 期待する口座番号: ${expected.accountNumber}
- 期待する名義: ${expected.accountName}
- 期待する金額: ¥${expected.amountJpy.toLocaleString()}

重要:
- 画像から読み取れない項目はnullにする
- 振込明細でない画像の場合は全項目nullにする
- amountは「振込金額」（相手に届く金額）を数値で返す
- amount_with_feeは「合計引落額」や「手数料込み合計」があればその数値を返す
- feeは振込手数料が表示されていればその数値を返す
- 金額が手数料込みで1つしか表示されていない場合、amountにその数値を入れる
- bank_name_matchは振込先銀行名が期待値と一致するかどうか
- account_number_matchは口座番号が期待値と一致するかどうか（末尾一致も可）
- account_name_matchは名義が期待値と一致するかどうか（カタカナ表記の揺れは許容）
- amount_matchは振込金額が期待金額と一致するかどうか（手数料分の差は一致とみなす）
- JSONのみ返す（説明文不要）

JSON形式:
{
  "transfer_time": "...",
  "bank_name": "...",
  "branch_name": "...",
  "account_number": "...",
  "account_name": "...",
  "amount": 数値 or null,
  "fee": 数値 or null,
  "amount_with_fee": 数値 or null,
  "is_transfer_receipt": true/false,
  "bank_name_match": true/false,
  "account_number_match": true/false,
  "account_name_match": true/false,
  "amount_match": true/false,
  "notes": "特記事項"
}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: base64Image },
            },
            { type: 'text', text: prompt },
          ],
        }],
      }),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      logger.error('ProofAnalyzer: Claude API error', { status: res.status, body: errBody.slice(0, 300) });
      return {
        score: 0,
        extractedData: {},
        matchDetails: { bankNameMatch: false, accountNumberMatch: false, accountNameMatch: false, amountMatch: false },
        confidence: 'low',
        reason: `Claude API error: ${res.status}`,
        rawAnalysis: errBody.slice(0, 300),
      };
    }

    const data = await res.json() as { content: Array<{ type: string; text?: string }> };
    const rawText = data.content?.find(c => c.type === 'text')?.text || '';

    // Parse JSON from response
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        score: 10,
        extractedData: {},
        matchDetails: { bankNameMatch: false, accountNumberMatch: false, accountNameMatch: false, amountMatch: false },
        confidence: 'low',
        reason: 'AI response did not contain valid JSON',
        rawAnalysis: rawText,
      };
    }

    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

    // Build result
    const extractedData: ProofAnalysisResult['extractedData'] = {
      transferTime: parsed.transfer_time as string || undefined,
      bankName: parsed.bank_name as string || undefined,
      branchName: parsed.branch_name as string || undefined,
      accountNumber: parsed.account_number as string || undefined,
      accountName: parsed.account_name as string || undefined,
      amount: typeof parsed.amount === 'number' ? parsed.amount : undefined,
      amountWithFee: typeof parsed.amount_with_fee === 'number' ? parsed.amount_with_fee : undefined,
      fee: typeof parsed.fee === 'number' ? parsed.fee : undefined,
    };

    const isReceipt = parsed.is_transfer_receipt === true;
    const bankNameMatch = parsed.bank_name_match === true;
    const accountNumberMatch = parsed.account_number_match === true;
    const accountNameMatch = parsed.account_name_match === true;

    // Amount match: code-side logic with fee tolerance
    // 期待金額と一致 OR 手数料込みで期待金額+0~1000円以内
    const MAX_FEE_TOLERANCE = 1000; // 最大手数料許容額（円）
    let amountMatch = false;
    const extractedAmount = extractedData.amount;
    const extractedWithFee = extractedData.amountWithFee;

    if (extractedAmount !== undefined) {
      // Case 1: 振込金額が期待金額と完全一致（手数料無料 or 手数料別表示）
      if (extractedAmount === expected.amountJpy) {
        amountMatch = true;
      }
      // Case 2: 振込金額が期待金額より大きい（手数料込み表示）
      //   例: 期待¥288,000 / 実際¥288,440（手数料¥440込み）
      else if (extractedAmount > expected.amountJpy && extractedAmount <= expected.amountJpy + MAX_FEE_TOLERANCE) {
        amountMatch = true;
        if (!extractedData.fee) {
          extractedData.fee = extractedAmount - expected.amountJpy;
        }
      }
    }
    // Case 3: amount_with_fee フィールドが期待金額+手数料範囲内
    if (!amountMatch && extractedWithFee !== undefined) {
      if (extractedWithFee >= expected.amountJpy && extractedWithFee <= expected.amountJpy + MAX_FEE_TOLERANCE) {
        amountMatch = true;
      }
    }
    // Case 4: AIが金額一致と判断（フォールバック）
    if (!amountMatch && parsed.amount_match === true) {
      amountMatch = true;
    }

    // Calculate score
    let score = 0;
    if (!isReceipt) {
      score = 5;
    } else {
      if (bankNameMatch) score += 20;
      if (accountNumberMatch) score += 30;
      if (accountNameMatch) score += 25;
      if (amountMatch) score += 25;
    }

    // Confidence level
    const confidence: ProofAnalysisResult['confidence'] =
      score >= 80 ? 'high' : score >= 50 ? 'medium' : 'low';

    // Reason
    const reasons: string[] = [];
    if (!isReceipt) reasons.push('振込明細として認識できない画像');
    if (isReceipt) {
      if (bankNameMatch) reasons.push('銀行名一致');
      else reasons.push('銀行名不一致');
      if (accountNumberMatch) reasons.push('口座番号一致');
      else reasons.push('口座番号不一致');
      if (accountNameMatch) reasons.push('名義一致');
      else reasons.push('名義不一致');
      if (amountMatch) {
        if (extractedData.fee && extractedData.fee > 0) {
          reasons.push(`金額一致（手数料¥${extractedData.fee}込み）`);
        } else {
          reasons.push('金額一致');
        }
      } else {
        const diff = extractedAmount ? extractedAmount - expected.amountJpy : null;
        reasons.push(`金額不一致${diff !== null ? '（差額¥' + diff.toLocaleString() + '）' : ''}`);
      }
    }

    const result: ProofAnalysisResult = {
      score,
      extractedData,
      matchDetails: { bankNameMatch, accountNumberMatch, accountNameMatch, amountMatch },
      confidence,
      reason: reasons.join(' / '),
      rawAnalysis: rawText,
    };

    logger.info('ProofAnalyzer: analysis complete', {
      score,
      confidence,
      bankNameMatch,
      accountNumberMatch,
      accountNameMatch,
      amountMatch,
    });

    return result;
  } catch (e) {
    logger.error('ProofAnalyzer: analysis failed', { error: e instanceof Error ? e.message : String(e) });
    return {
      score: 0,
      extractedData: {},
      matchDetails: { bankNameMatch: false, accountNumberMatch: false, accountNameMatch: false, amountMatch: false },
      confidence: 'low',
      reason: e instanceof Error ? e.message : String(e),
      rawAnalysis: '',
    };
  } finally {
    clearTimeout(timeout);
  }
}
