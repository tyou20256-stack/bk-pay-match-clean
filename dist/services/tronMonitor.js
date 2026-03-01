"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startMonitor = startMonitor;
exports.stopMonitor = stopMonitor;
/**
 * @file tronMonitor.ts — USDT着金自動検知
 * @description TronGrid APIでUSDT(TRC-20)ウォレットへの入金を30秒間隔で監視。
 *   着金額がconfirming状態の注文のcryptoAmountと一致（±0.01 USDT）した場合、
 *   自動的に注文をcompleted状態に更新。不一致の場合はTelegram通知。
 *   ウォレットアドレスが設定されていない場合は非アクティブ。
 */
// TronGrid USDT deposit monitor
const dbSvc = __importStar(require("./database.js"));
const notifier_js_1 = __importDefault(require("./notifier.js"));
const TRONGRID_API = 'https://api.trongrid.io';
const USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'; // USDT TRC-20
const CHECK_INTERVAL = 30000; // 30 seconds
let lastCheckedTimestamp = Date.now();
let monitorInterval = null;
async function checkDeposits() {
    const wallet = dbSvc.getWalletConfig();
    if (!wallet?.address)
        return;
    try {
        const url = `${TRONGRID_API}/v1/accounts/${wallet.address}/transactions/trc20?only_confirmed=true&limit=20&contract_address=${USDT_CONTRACT}&min_timestamp=${lastCheckedTimestamp}`;
        const res = await fetch(url, {
            headers: { 'TRON-PRO-API-KEY': process.env.TRONGRID_API_KEY || '' }
        });
        const data = await res.json();
        if (!data.data?.length)
            return;
        for (const tx of data.data) {
            // Only incoming transfers
            if (tx.to.toLowerCase() !== wallet.address.toLowerCase())
                continue;
            const usdtAmount = parseFloat(tx.value) / 1e6; // USDT has 6 decimals
            console.log(`[TronMonitor] Incoming USDT: ${usdtAmount} from ${tx.from} tx:${tx.transaction_id}`);
            // Try to match with pending buy orders
            const orders = dbSvc.getAllOrders();
            const pendingOrders = orders.filter((o) => o.status === 'confirming' &&
                Math.abs(o.cryptoAmount - usdtAmount) < 0.01 // Allow tiny variance
            );
            // Also check sell orders awaiting deposit
            const sellOrders = dbSvc.getSellOrdersAwaitingDeposit();
            const matchedSell = sellOrders.filter((o) => o.crypto === 'USDT' &&
                Math.abs(o.cryptoAmount - usdtAmount) < 0.01);
            if (matchedSell.length > 0) {
                const order = matchedSell[0];
                dbSvc.updateOrderStatus(order.id, 'deposit_received');
                console.log(`[TronMonitor] Sell order deposit received: ${order.id} (${usdtAmount} USDT)`);
                notifier_js_1.default.notifyNewOrder({
                    id: order.id,
                    amount: order.amount,
                    cryptoAmount: usdtAmount,
                    rate: order.rate,
                    payMethod: 'USDT',
                    mode: 'sell-deposit',
                    exchange: `売却入金確認 TX: ${tx.transaction_id.slice(0, 16)}...`
                });
            }
            else if (pendingOrders.length > 0) {
                const order = pendingOrders[0];
                dbSvc.updateOrderStatus(order.id, 'completed', { completedAt: Date.now() });
                console.log(`[TronMonitor] Auto-completed order ${order.id} (${usdtAmount} USDT)`);
                notifier_js_1.default.notifyCompleted({ ...order, status: 'completed', completedAt: Date.now() });
            }
            else {
                // Notify about unmatched deposit
                notifier_js_1.default.notifyNewOrder({
                    id: 'DEPOSIT',
                    amount: 0,
                    cryptoAmount: usdtAmount,
                    rate: 0,
                    payMethod: 'USDT',
                    mode: 'deposit',
                    exchange: `TX: ${tx.transaction_id.slice(0, 16)}...`
                });
            }
            if (tx.block_timestamp > lastCheckedTimestamp) {
                lastCheckedTimestamp = tx.block_timestamp + 1;
            }
        }
    }
    catch (e) {
        console.error('[TronMonitor] Error:', e.message);
    }
}
function startMonitor() {
    if (monitorInterval)
        return;
    const wallet = dbSvc.getWalletConfig();
    if (!wallet?.address) {
        console.log('[TronMonitor] No wallet configured. Monitor inactive.');
        return;
    }
    console.log(`[TronMonitor] Monitoring ${wallet.address} for USDT deposits (${CHECK_INTERVAL / 1000}s interval)`);
    monitorInterval = setInterval(checkDeposits, CHECK_INTERVAL);
    checkDeposits(); // Initial check
}
function stopMonitor() {
    if (monitorInterval) {
        clearInterval(monitorInterval);
        monitorInterval = null;
    }
}
exports.default = { startMonitor, stopMonitor };
