"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processArbitrage = processArbitrage;
exports.getActiveWindows = getActiveWindows;
exports.getClosedWindows = getClosedWindows;
exports.getAllWindows = getAllWindows;
const MAX_HISTORY = 100;
const MAX_SNAPSHOTS = 60;
const activeWindows = new Map();
const closedWindows = [];
function windowId(opp) {
    return `${opp.crypto}:${opp.buyExchange}>${opp.sellExchange}`;
}
function processArbitrage(rates, crypto) {
    const now = Date.now();
    const currentIds = new Set();
    // Build lookup for best orders per exchange
    const bestBuyOrders = new Map();
    const bestSellOrders = new Map();
    for (const r of rates.rates) {
        if (r.buyOrders.length > 0) {
            const best = r.buyOrders.reduce((a, b) => a.price < b.price ? a : b);
            bestBuyOrders.set(r.exchange, best);
        }
        if (r.sellOrders.length > 0) {
            const best = r.sellOrders.reduce((a, b) => a.price > b.price ? a : b);
            bestSellOrders.set(r.exchange, best);
        }
    }
    for (const opp of rates.arbitrageOpportunities) {
        const id = windowId(opp);
        currentIds.add(id);
        const buyOrder = bestBuyOrders.get(opp.buyExchange);
        const sellOrder = bestSellOrders.get(opp.sellExchange);
        const buyAvail = buyOrder?.available || 0;
        const sellAvail = sellOrder?.available || 0;
        const maxVolume = Math.min(buyAvail, sellAvail);
        const maxProfitJPY = maxVolume * opp.profitPerUnit;
        if (activeWindows.has(id)) {
            const w = activeWindows.get(id);
            w.buyPrice = opp.buyPrice;
            w.sellPrice = opp.sellPrice;
            w.profitPercent = opp.profitPercent;
            w.profitPerUnit = opp.profitPerUnit;
            w.maxVolume = maxVolume;
            w.maxProfitJPY = maxProfitJPY;
            w.buyMinLimit = buyOrder?.minLimit || 0;
            w.buyMaxLimit = buyOrder?.maxLimit || 0;
            w.sellMinLimit = sellOrder?.minLimit || 0;
            w.sellMaxLimit = sellOrder?.maxLimit || 0;
            w.lastSeenAt = now;
            w.durationMs = now - w.openedAt;
            if (opp.profitPercent > w.peakProfit) {
                w.peakProfit = opp.profitPercent;
                w.peakTime = now;
            }
            w.snapshots.push({ time: now, buyPrice: opp.buyPrice, sellPrice: opp.sellPrice, profit: opp.profitPercent });
            if (w.snapshots.length > MAX_SNAPSHOTS)
                w.snapshots.shift();
        }
        else {
            const w = {
                id, crypto, buyExchange: opp.buyExchange, sellExchange: opp.sellExchange,
                buyPrice: opp.buyPrice, sellPrice: opp.sellPrice,
                profitPercent: opp.profitPercent, profitPerUnit: opp.profitPerUnit,
                maxVolume, maxProfitJPY,
                buyMinLimit: buyOrder?.minLimit || 0, buyMaxLimit: buyOrder?.maxLimit || 0,
                sellMinLimit: sellOrder?.minLimit || 0, sellMaxLimit: sellOrder?.maxLimit || 0,
                openedAt: now, lastSeenAt: now, closedAt: null,
                peakProfit: opp.profitPercent, peakTime: now,
                durationMs: 0, isActive: true,
                snapshots: [{ time: now, buyPrice: opp.buyPrice, sellPrice: opp.sellPrice, profit: opp.profitPercent }],
            };
            activeWindows.set(id, w);
            console.log(`[Arbitrage] OPEN: ${id} +${opp.profitPercent.toFixed(2)}% vol=${maxVolume.toFixed(1)} maxProfit=¥${maxProfitJPY.toFixed(0)}`);
        }
    }
    for (const [id, w] of activeWindows) {
        if (!currentIds.has(id) && w.crypto === crypto) {
            w.isActive = false;
            w.closedAt = now;
            w.durationMs = now - w.openedAt;
            closedWindows.unshift(w);
            if (closedWindows.length > MAX_HISTORY)
                closedWindows.pop();
            activeWindows.delete(id);
        }
    }
}
function getActiveWindows() {
    return Array.from(activeWindows.values()).sort((a, b) => b.profitPercent - a.profitPercent);
}
function getClosedWindows(limit = 20) {
    return closedWindows.slice(0, limit);
}
function getAllWindows() {
    return { active: getActiveWindows(), history: getClosedWindows() };
}
