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
Object.defineProperty(exports, "__esModule", { value: true });
exports.exportOrders = exportOrders;
exports.exportFreee = exportFreee;
exports.exportYayoi = exportYayoi;
exports.exportAccounts = exportAccounts;
exports.exportFeeReport = exportFeeReport;
/**
 * @file csvExporter.ts — CSV Export Service
 * @description 注文・口座・手数料のCSVエクスポート（標準/freee/弥生形式対応）
 */
const dbSvc = __importStar(require("./database.js"));
function escapeCSV(val) {
    if (val == null)
        return '';
    const s = String(val);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
}
function toCSV(headers, rows) {
    const lines = [headers.map(escapeCSV).join(',')];
    for (const row of rows) {
        lines.push(row.map(escapeCSV).join(','));
    }
    return lines.join('\n');
}
function filterByDate(orders, from, to) {
    let filtered = orders;
    if (from) {
        const fromTs = new Date(from).getTime();
        filtered = filtered.filter(o => o.createdAt >= fromTs);
    }
    if (to) {
        const toTs = new Date(to + 'T23:59:59').getTime();
        filtered = filtered.filter(o => o.createdAt <= toTs);
    }
    return filtered;
}
function formatDate(ts) {
    return new Date(ts).toISOString().slice(0, 10);
}
function formatDateTime(ts) {
    return new Date(ts).toISOString().replace('T', ' ').slice(0, 19);
}
function directionLabel(order) {
    return order.direction === 'sell' ? '売却' : '購入';
}
function calcFee(order) {
    return Math.round(order.amount * 0.02);
}
function statusLabel(status) {
    const map = {
        matching: 'マッチング中', pending_payment: '支払待ち', paid: '支払済み',
        confirming: '確認中', completed: '完了', cancelled: 'キャンセル', expired: '期限切れ'
    };
    return map[status] || status;
}
function payMethodLabel(method) {
    const map = {
        bank: '銀行振込', paypay: 'PayPay', linepay: 'LINE Pay', aupay: 'au PAY'
    };
    return map[method] || method;
}
function exportOrders(from, to, format = 'standard') {
    if (format === 'freee')
        return exportFreee(from, to);
    if (format === 'yayoi')
        return exportYayoi(from, to);
    const allOrders = dbSvc.getAllOrders(10000);
    const orders = filterByDate(allOrders, from, to);
    const headers = ['注文ID', '日時', '方向', '金額(JPY)', '暗号通貨', '数量', 'レート', '手数料(JPY)', '取引所', 'ステータス', '支払方法'];
    const rows = orders.map(o => [
        o.id, formatDateTime(o.createdAt), directionLabel(o), o.amount, o.crypto,
        o.cryptoAmount, o.rate, calcFee(o), o.exchange || '', statusLabel(o.status), payMethodLabel(o.payMethod)
    ]);
    return toCSV(headers, rows);
}
function exportFreee(from, to) {
    const allOrders = dbSvc.getAllOrders(10000);
    const orders = filterByDate(allOrders, from, to).filter(o => o.status === 'completed');
    const headers = ['取引日', '勘定科目', '税区分', '金額', '取引先', '品目', 'メモ'];
    const rows = [];
    for (const o of orders) {
        const date = formatDate(o.createdAt);
        const isBuy = o.direction !== 'sell';
        rows.push([date, isBuy ? '仮想通貨' : '預り金', '対象外', o.amount, o.exchange || '', o.crypto, `${o.id} ${directionLabel(o)} ${o.cryptoAmount} ${o.crypto}`]);
        rows.push([date, isBuy ? '預り金' : '仮想通貨', '対象外', o.amount, o.exchange || '', o.crypto, `${o.id} ${directionLabel(o)} ${o.cryptoAmount} ${o.crypto}`]);
        const fee = calcFee(o);
        if (fee > 0) {
            rows.push([date, '支払手数料', '対象外', fee, o.exchange || '', o.crypto, `${o.id} 手数料`]);
        }
    }
    return toCSV(headers, rows);
}
function exportYayoi(from, to) {
    const allOrders = dbSvc.getAllOrders(10000);
    const orders = filterByDate(allOrders, from, to).filter(o => o.status === 'completed');
    const headers = ['日付', '伝票番号', '借方科目', '借方金額', '貸方科目', '貸方金額', '摘要'];
    const rows = [];
    let slipNo = 1;
    for (const o of orders) {
        const date = formatDate(o.createdAt);
        const isBuy = o.direction !== 'sell';
        rows.push([date, slipNo++, isBuy ? '仮想通貨' : '預り金', o.amount, isBuy ? '預り金' : '仮想通貨', o.amount, `${directionLabel(o)} ${o.crypto} ${o.cryptoAmount} @${o.rate} (${o.exchange || ''})`]);
        const fee = calcFee(o);
        if (fee > 0) {
            rows.push([date, slipNo++, '支払手数料', fee, '預り金', fee, `${o.id} 取引手数料`]);
        }
    }
    return toCSV(headers, rows);
}
function exportAccounts() {
    const accounts = dbSvc.getBankAccounts();
    const headers = ['ID', '銀行名', '支店名', '口座種別', '口座番号', '口座名義', '1日上限額', '優先度', 'ステータス', 'メモ'];
    const rows = accounts.map((a) => [
        a.id, a.bank_name, a.branch_name, a.account_type, a.account_number,
        a.account_holder, a.daily_limit, a.priority, a.status, a.memo || ''
    ]);
    return toCSV(headers, rows);
}
function exportFeeReport(from, to) {
    const allOrders = dbSvc.getAllOrders(10000);
    const orders = filterByDate(allOrders, from, to).filter(o => o.status === 'completed');
    const headers = ['日付', '注文ID', '方向', '取引金額(JPY)', '手数料(JPY)', '手数料率(%)', '暗号通貨', '取引所'];
    const rows = orders.map(o => [
        formatDate(o.createdAt), o.id, directionLabel(o), o.amount, calcFee(o), '2.0', o.crypto, o.exchange || ''
    ]);
    const totalAmount = orders.reduce((s, o) => s + o.amount, 0);
    const totalFee = orders.reduce((s, o) => s + calcFee(o), 0);
    rows.push(['', '', '合計', totalAmount, totalFee, '', '', '']);
    return toCSV(headers, rows);
}
