type ExportFormat = 'standard' | 'freee' | 'yayoi';
export declare function exportOrders(from?: string, to?: string, format?: ExportFormat): string;
export declare function exportFreee(from?: string, to?: string): string;
export declare function exportYayoi(from?: string, to?: string): string;
export declare function exportAccounts(): string;
export declare function exportFeeReport(from?: string, to?: string): string;
export {};
