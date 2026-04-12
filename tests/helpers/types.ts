/**
 * @file types.ts — Shared API response types for tests (replaces `as any`)
 */

export interface ApiOk<T = unknown> {
  success: true;
  data?: T;
  [key: string]: unknown;
}

export interface ApiErr {
  success: false;
  error: string;
  code?: string;
}

export type ApiResponse<T = unknown> = ApiOk<T> | ApiErr;

export interface RegisterBuyerResponse {
  success: boolean;
  buyerId: string;
  buyerToken: string;
  error?: string;
}

export interface CancelBuyerResponse {
  success: boolean;
  removed?: boolean;
  error?: string;
}

export interface RatesResponse {
  success: boolean;
  data: {
    rates: Array<{ exchange: string; buy?: number; sell?: number }>;
    bestBuyExchange?: string | null;
    bestSellExchange?: string | null;
  };
  error?: string;
}

export interface OrderResponse {
  success: boolean;
  order?: {
    id: string;
    status: string;
    amount: number;
    cryptoAmount: number;
    rate: number;
    payMethod: string;
    crypto: string;
    orderToken?: string;
    customerWalletAddress?: string;
  };
  error?: string;
}

export interface LoginResponse {
  success: boolean;
  token?: string;
  mfaRequired?: boolean;
  permissions?: string[];
  error?: string;
}

export interface ChatResponse {
  success: boolean;
  reply?: string;
  error?: string;
}
