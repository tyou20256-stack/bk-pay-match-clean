export interface AccountHealth {
    accountId: number;
    bankName: string;
    consecutiveFailures: number;
    todaySuccess: number;
    todayFail: number;
    healthScore: number;
    recommendation: 'active' | 'rest' | 'investigate' | 'frozen';
}
export declare function recordOrderResult(accountId: number, success: boolean): void;
export declare function markTransferFailed(accountId: number): void;
export declare function checkAccountHealth(accountId: number): AccountHealth | null;
export declare function getHealthDashboard(): AccountHealth[];
export declare function autoRestUnhealthyAccounts(): {
    rested: number;
    frozen: number;
};
export declare function initFreezeDetector(): void;
