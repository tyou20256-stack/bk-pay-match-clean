import { AggregatedRates, ArbitrageOpp } from '../types';

export interface ArbitrageWindow {
  id: string;
  crypto: string;
  buyExchange: string;
  sellExchange: string;
  buyPrice: number;
  sellPrice: number;
  profitPercent: number;
  profitPerUnit: number;
  openedAt: number;
  lastSeenAt: number;
  closedAt: number | null;
  peakProfit: number;
  peakTime: number;
  durationMs: number;
  isActive: boolean;
  snapshots: { time: number; buyPrice: number; sellPrice: number; profit: number }[];
}

const MAX_HISTORY = 100;
const MAX_SNAPSHOTS = 60; // 30min at 30s intervals
const activeWindows: Map<string, ArbitrageWindow> = new Map();
const closedWindows: ArbitrageWindow[] = [];

function windowId(opp: ArbitrageOpp): string {
  return `${opp.crypto}:${opp.buyExchange}>${opp.sellExchange}`;
}

export function processArbitrage(rates: AggregatedRates, crypto: string): void {
  const now = Date.now();
  const currentIds = new Set<string>();

  for (const opp of rates.arbitrageOpportunities) {
    const id = windowId(opp);
    currentIds.add(id);

    if (activeWindows.has(id)) {
      // Update existing window
      const w = activeWindows.get(id)!;
      w.buyPrice = opp.buyPrice;
      w.sellPrice = opp.sellPrice;
      w.profitPercent = opp.profitPercent;
      w.profitPerUnit = opp.profitPerUnit;
      w.lastSeenAt = now;
      w.durationMs = now - w.openedAt;
      if (opp.profitPercent > w.peakProfit) {
        w.peakProfit = opp.profitPercent;
        w.peakTime = now;
      }
      w.snapshots.push({ time: now, buyPrice: opp.buyPrice, sellPrice: opp.sellPrice, profit: opp.profitPercent });
      if (w.snapshots.length > MAX_SNAPSHOTS) w.snapshots.shift();
    } else {
      // New window opened
      const w: ArbitrageWindow = {
        id, crypto, buyExchange: opp.buyExchange, sellExchange: opp.sellExchange,
        buyPrice: opp.buyPrice, sellPrice: opp.sellPrice,
        profitPercent: opp.profitPercent, profitPerUnit: opp.profitPerUnit,
        openedAt: now, lastSeenAt: now, closedAt: null,
        peakProfit: opp.profitPercent, peakTime: now,
        durationMs: 0, isActive: true,
        snapshots: [{ time: now, buyPrice: opp.buyPrice, sellPrice: opp.sellPrice, profit: opp.profitPercent }],
      };
      activeWindows.set(id, w);
      console.log(`[Arbitrage] OPEN: ${id} +${opp.profitPercent.toFixed(2)}% (buy ${opp.buyExchange} ¥${opp.buyPrice} → sell ${opp.sellExchange} ¥${opp.sellPrice})`);
    }
  }

  // Close windows that are no longer active
  for (const [id, w] of activeWindows) {
    if (!currentIds.has(id) && w.crypto === crypto) {
      w.isActive = false;
      w.closedAt = now;
      w.durationMs = now - w.openedAt;
      closedWindows.unshift(w);
      if (closedWindows.length > MAX_HISTORY) closedWindows.pop();
      activeWindows.delete(id);
      console.log(`[Arbitrage] CLOSED: ${id} lasted ${formatDuration(w.durationMs)} peak +${w.peakProfit.toFixed(2)}%`);
    }
  }
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h${m % 60}m`;
}

export function getActiveWindows(): ArbitrageWindow[] {
  return Array.from(activeWindows.values()).sort((a, b) => b.profitPercent - a.profitPercent);
}

export function getClosedWindows(limit = 20): ArbitrageWindow[] {
  return closedWindows.slice(0, limit);
}

export function getAllWindows(): { active: ArbitrageWindow[]; history: ArbitrageWindow[] } {
  return { active: getActiveWindows(), history: getClosedWindows() };
}
