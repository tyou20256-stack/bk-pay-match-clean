interface Order {
    id: string;
    mode: 'auto' | 'self';
    status: 'matching' | 'pending_payment' | 'paid' | 'confirming' | 'completed' | 'cancelled' | 'expired';
    amount: number;
    crypto: string;
    cryptoAmount: number;
    rate: number;
    payMethod: string;
    exchange?: string;
    merchantName?: string;
    merchantCompletionRate?: number;
    paymentInfo: PaymentInfo | null;
    createdAt: number;
    expiresAt: number;
    paidAt?: number;
    completedAt?: number;
}
interface PaymentInfo {
    type: 'bank' | 'paypay' | 'linepay' | 'aupay';
    bankName?: string;
    branchName?: string;
    accountType?: string;
    accountNumber?: string;
    accountHolder?: string;
    payId?: string;
    qrUrl?: string;
    amount: number;
}
export declare function createOrder(amount: number, payMethod: string, crypto?: string): Promise<Order>;
export declare function markPaid(orderId: string): Order | null;
export declare function cancelOrder(orderId: string): Order | null;
export declare function getOrder(orderId: string): Order | null;
export declare function getAllOrders(): Order[];
export declare function createSellOrder(params: {
    cryptoAmount: number;
    crypto: string;
    customerBankInfo: {
        bankName: string;
        branchName: string;
        accountNumber: string;
        accountHolder: string;
    };
}): Promise<any>;
export declare function markDepositReceived(orderId: string): any;
export declare function markWithdrawalComplete(orderId: string): any;
declare const _default: {
    createOrder: typeof createOrder;
    createSellOrder: typeof createSellOrder;
    markPaid: typeof markPaid;
    markDepositReceived: typeof markDepositReceived;
    markWithdrawalComplete: typeof markWithdrawalComplete;
    cancelOrder: typeof cancelOrder;
    getOrder: typeof getOrder;
    getAllOrders: typeof getAllOrders;
};
export default _default;
