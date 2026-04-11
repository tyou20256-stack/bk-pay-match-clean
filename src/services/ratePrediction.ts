/**
 * @file ratePrediction.ts — レート予測（統計的アプローチ）
 * @description 移動平均/線形回帰/時間帯パターン/ボラティリティから
 *   購入タイミングスコア(0-100)を算出。ML不使用の軽量実装。
 */
import { getHistory } from './priceHistory.js';
import logger from './logger.js';

interface PriceHistoryRow {
  timestamp: number;
  exchange: string;
  best_buy: number;
  best_sell: number;
  spot: number | null;
  spread: number | null;
}

// === Types ===
export interface PredictionResult {
  crypto: string;
  currentBuyRate: number;
  currentSellRate: number;
  predictedDirection: 'up' | 'down' | 'stable';
  confidence: number;
  buyTimingScore: number;   // 0-100 (100 = buy now!)
  sellTimingScore: number;  // 0-100 (100 = sell now!)
  shortTermTrend: number;   // -1 to +1
  longTermTrend: number;    // -1 to +1
  volatility: number;
  sma12: number;
  sma24: number;
  hourlyPattern: { hour: number; avgBuy: number; avgSell: number }[];
  reasoning: string[];
  updatedAt: string;
}

export interface OptimalTimeResult {
  crypto: string;
  bestBuyHour: number;
  bestBuyDay: number; // 0=Sun
  bestSellHour: number;
  bestSellDay: number;
  confidence: number;
  reasoning: string;
}

// === Core Prediction ===
export function getPrediction(crypto: string): PredictionResult {
  const history = getHistory(crypto, 24); // 24 hours of data
  const longHistory = getHistory(crypto, 168); // 7 days

  if (!history || history.length < 10) {
    return emptyPrediction(crypto);
  }

  // Extract buy prices
  const buyPrices = history
    .filter((h: PriceHistoryRow) => h.best_buy > 0)
    .map((h: PriceHistoryRow) => ({ price: h.best_buy, time: h.timestamp }));
  const sellPrices = history
    .filter((h: PriceHistoryRow) => h.best_sell > 0)
    .map((h: PriceHistoryRow) => ({ price: h.best_sell, time: h.timestamp }));

  if (buyPrices.length < 5) return emptyPrediction(crypto);

  const prices = buyPrices.map(p => p.price);
  const currentBuy = prices[prices.length - 1];
  const currentSell = sellPrices.length > 0 ? sellPrices[sellPrices.length - 1].price : 0;

  // Moving Averages
  const sma12 = movingAverage(prices, 12);
  const sma24 = movingAverage(prices, 24);

  // Short-term trend (last 2 hours = ~240 data points at 30s intervals)
  const shortPrices = prices.slice(-240);
  const shortTermTrend = linearRegressionSlope(shortPrices);

  // Long-term trend (all 24h data)
  const longTermTrend = linearRegressionSlope(prices);

  // Volatility (standard deviation of % changes)
  const volatility = calculateVolatility(prices);

  // Hourly pattern
  const hourlyPattern = calculateHourlyPattern(longHistory || history);

  // Direction prediction
  const reasoning: string[] = [];
  let directionScore = 0;

  // SMA crossover signal
  if (sma12 > sma24) {
    directionScore += 0.3;
    reasoning.push('短期SMAが長期SMAを上回り（上昇トレンド）');
  } else if (sma12 < sma24) {
    directionScore -= 0.3;
    reasoning.push('短期SMAが長期SMAを下回り（下降トレンド）');
  }

  // Trend signal
  if (shortTermTrend > 0.001) {
    directionScore += 0.3;
    reasoning.push('短期トレンド: 上昇中');
  } else if (shortTermTrend < -0.001) {
    directionScore -= 0.3;
    reasoning.push('短期トレンド: 下降中');
  } else {
    reasoning.push('短期トレンド: 安定');
  }

  // Price vs SMA
  if (currentBuy < sma24 * 0.99) {
    directionScore += 0.2;
    reasoning.push('現在のレートが24h平均を下回り（買い時の可能性）');
  } else if (currentBuy > sma24 * 1.01) {
    directionScore -= 0.2;
    reasoning.push('現在のレートが24h平均を上回り（高値圏）');
  }

  // Volatility signal
  if (volatility > 1.5) {
    reasoning.push(`ボラティリティ高（${volatility.toFixed(2)}%）: 急変動に注意`);
  } else if (volatility < 0.3) {
    reasoning.push(`ボラティリティ低（${volatility.toFixed(2)}%）: 安定推移`);
  }

  // Determine direction
  let predictedDirection: 'up' | 'down' | 'stable' = 'stable';
  if (directionScore > 0.2) predictedDirection = 'up';
  else if (directionScore < -0.2) predictedDirection = 'down';

  // Confidence (based on consistency of signals)
  const confidence = Math.min(Math.round(Math.abs(directionScore) * 100), 95);

  // Buy timing score: higher = better time to buy
  let buyTimingScore = 50;
  if (currentBuy < sma24) buyTimingScore += 15; // Below average
  if (shortTermTrend < 0) buyTimingScore += 10; // Prices dropping
  if (volatility < 0.5) buyTimingScore += 10; // Low volatility
  if (currentBuy <= safeMin(prices.slice(-48))) buyTimingScore += 15; // Near recent low
  buyTimingScore = Math.max(0, Math.min(100, buyTimingScore));

  // Sell timing score
  let sellTimingScore = 50;
  if (currentSell > sma24) sellTimingScore += 15;
  if (shortTermTrend > 0) sellTimingScore += 10;
  if (currentSell >= safeMax(sellPrices.slice(-48).map(p => p.price))) sellTimingScore += 15;
  sellTimingScore = Math.max(0, Math.min(100, sellTimingScore));

  return {
    crypto,
    currentBuyRate: currentBuy,
    currentSellRate: currentSell,
    predictedDirection,
    confidence,
    buyTimingScore,
    sellTimingScore,
    shortTermTrend: Math.round(shortTermTrend * 10000) / 10000,
    longTermTrend: Math.round(longTermTrend * 10000) / 10000,
    volatility: Math.round(volatility * 100) / 100,
    sma12: Math.round(sma12 * 100) / 100,
    sma24: Math.round(sma24 * 100) / 100,
    hourlyPattern,
    reasoning,
    updatedAt: new Date().toISOString(),
  };
}

// === Optimal Time ===
export function getOptimalBuyTime(crypto: string): OptimalTimeResult {
  const history = getHistory(crypto, 168); // 7 days
  if (!history || history.length < 100) {
    return { crypto, bestBuyHour: 9, bestBuyDay: 1, bestSellHour: 14, bestSellDay: 5, confidence: 0, reasoning: 'データ不足' };
  }

  // Group by hour
  const hourlyBuy: Record<number, number[]> = {};
  const hourlySell: Record<number, number[]> = {};
  const dailyBuy: Record<number, number[]> = {};

  for (const h of history as PriceHistoryRow[]) {
    const date = new Date(h.timestamp);
    const hour = date.getHours();
    const day = date.getDay();
    if (h.best_buy > 0) {
      if (!hourlyBuy[hour]) hourlyBuy[hour] = [];
      hourlyBuy[hour].push(h.best_buy);
      if (!dailyBuy[day]) dailyBuy[day] = [];
      dailyBuy[day].push(h.best_buy);
    }
    if (h.best_sell > 0) {
      if (!hourlySell[hour]) hourlySell[hour] = [];
      hourlySell[hour].push(h.best_sell);
    }
  }

  // Find best buy hour (lowest average buy price)
  let bestBuyHour = 9;
  let bestBuyAvg = Infinity;
  for (const [hour, prices] of Object.entries(hourlyBuy)) {
    const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
    if (avg < bestBuyAvg) { bestBuyAvg = avg; bestBuyHour = parseInt(hour); }
  }

  // Find best sell hour (highest average sell price)
  let bestSellHour = 14;
  let bestSellAvg = 0;
  for (const [hour, prices] of Object.entries(hourlySell)) {
    const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
    if (avg > bestSellAvg) { bestSellAvg = avg; bestSellHour = parseInt(hour); }
  }

  // Find best buy day
  let bestBuyDay = 1;
  let bestDayAvg = Infinity;
  for (const [day, prices] of Object.entries(dailyBuy)) {
    const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
    if (avg < bestDayAvg) { bestDayAvg = avg; bestBuyDay = parseInt(day); }
  }

  const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
  const confidence = Math.min(history.length / 5, 85);

  return {
    crypto, bestBuyHour, bestBuyDay, bestSellHour, bestSellDay: 5,
    confidence: Math.round(confidence),
    reasoning: `過去7日間のデータ分析: 買い最適 ${bestBuyHour}時(${dayNames[bestBuyDay]}曜) / 売り最適 ${bestSellHour}時`,
  };
}

// === Helper Functions ===
// Safe min/max that avoids stack overflow with large arrays (Math.min/max spread limit ~65k args)
function safeMin(arr: number[]): number {
  if (arr.length === 0) return Infinity;
  let min = arr[0];
  for (let i = 1; i < arr.length; i++) { if (arr[i] < min) min = arr[i]; }
  return min;
}

function safeMax(arr: number[]): number {
  if (arr.length === 0) return -Infinity;
  let max = arr[0];
  for (let i = 1; i < arr.length; i++) { if (arr[i] > max) max = arr[i]; }
  return max;
}

function movingAverage(data: number[], period: number): number {
  if (data.length < period) return data.reduce((a, b) => a + b, 0) / data.length;
  const slice = data.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function linearRegressionSlope(data: number[]): number {
  const n = data.length;
  if (n < 2) return 0;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += data[i];
    sumXY += i * data[i];
    sumX2 += i * i;
  }
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}

function calculateVolatility(prices: number[]): number {
  if (prices.length < 2) return 0;
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1] > 0) {
      returns.push(((prices[i] - prices[i - 1]) / prices[i - 1]) * 100);
    }
  }
  if (returns.length === 0) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / returns.length;
  return Math.sqrt(variance);
}

function calculateHourlyPattern(history: PriceHistoryRow[]): { hour: number; avgBuy: number; avgSell: number }[] {
  const hourlyData: Record<number, { buys: number[]; sells: number[] }> = {};
  for (let h = 0; h < 24; h++) hourlyData[h] = { buys: [], sells: [] };

  for (const h of history) {
    const hour = new Date(h.timestamp).getHours();
    if (h.best_buy > 0) hourlyData[hour].buys.push(h.best_buy);
    if (h.best_sell > 0) hourlyData[hour].sells.push(h.best_sell);
  }

  return Object.entries(hourlyData).map(([hour, data]) => ({
    hour: parseInt(hour),
    avgBuy: data.buys.length > 0 ? Math.round(data.buys.reduce((a, b) => a + b, 0) / data.buys.length * 100) / 100 : 0,
    avgSell: data.sells.length > 0 ? Math.round(data.sells.reduce((a, b) => a + b, 0) / data.sells.length * 100) / 100 : 0,
  }));
}

function emptyPrediction(crypto: string): PredictionResult {
  return {
    crypto, currentBuyRate: 0, currentSellRate: 0,
    predictedDirection: 'stable', confidence: 0,
    buyTimingScore: 50, sellTimingScore: 50,
    shortTermTrend: 0, longTermTrend: 0, volatility: 0,
    sma12: 0, sma24: 0, hourlyPattern: [],
    reasoning: ['データ不足: 予測にはより多くの履歴データが必要です'],
    updatedAt: new Date().toISOString(),
  };
}

logger.info('Rate prediction system initialized');
