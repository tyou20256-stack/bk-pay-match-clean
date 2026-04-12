/**
 * @file types.ts — Database row interfaces and DTOs
 * @description Exported TypeScript types describing SQL row shapes plus
 *   the higher-level DTOs that callers see. Split out of connection.ts so
 *   the connection module only owns lifecycle concerns.
 */

export interface OrderRow {
  id: string;
  mode: string;
  status: string;
  amount: number;
  crypto: string;
  crypto_amount: number;
  rate: number;
  pay_method: string;
  exchange: string | null;
  merchant_name: string | null;
  merchant_completion_rate: number | null;
  payment_info: string | null;
  created_at: number;
  expires_at: number;
  paid_at: number | null;
  completed_at: number | null;
  direction?: string;
  customer_wallet?: string;
  customer_bank_info?: string;
  fee_rate?: number;
  fee_jpy?: number;
  fee_crypto?: number;
  verified_at?: number | null;
  tx_id?: string | null;
  customer_wallet_address?: string | null;
  webhook_url?: string | null;
  merchant_api_key_id?: number | null;
  seller_id?: number | null;
  seller_confirmed_at?: number | null;
  withdrawal_id?: number | null;
  order_token?: string | null;
}

export interface OrderData {
  [key: string]: unknown;
  id: string;
  mode: string;
  status: string;
  amount: number;
  crypto: string;
  cryptoAmount: number;
  rate: number;
  payMethod: string;
  exchange: string | null;
  merchantName: string | null;
  merchantCompletionRate: number | null;
  paymentInfo: Record<string, unknown> | null;
  createdAt: number;
  expiresAt: number;
  paidAt: number | null;
  completedAt: number | null;
  direction: string;
  customerWallet: string;
  customerBankInfo: Record<string, unknown>;
  feeRate: number;
  feeJpy: number;
  feeCrypto: number;
  verifiedAt: number | null;
  txId: string | null;
  customerWalletAddress: string | null;
  webhookUrl: string | null;
  merchantApiKeyId: number | null;
  sellerId: number | null;
  sellerConfirmedAt: number | null;
  withdrawalId: number | null;
  orderToken: string | null;
}

export interface BankAccountRow {
  id: number;
  bank_name: string;
  branch_name: string;
  account_type: string;
  account_number: string;
  account_holder: string;
  daily_limit: number;
  used_today: number;
  used_today_date: string | null;
  priority: string;
  status: string;
  memo: string | null;
  created_at: number;
}

export interface BankAccountInput {
  bankName: string;
  branchName: string;
  accountType?: string;
  accountNumber: string;
  accountHolder: string;
  dailyLimit?: number;
  priority?: string;
  status?: string;
  memo?: string;
}

export interface EpayConfigRow {
  type: string;
  pay_id: string;
  display_name: string;
  qr_image: string;
  link_url: string;
  updated_at: number;
}

export interface EpayConfigInput {
  payId?: string;
  displayName?: string;
  qrImage?: string;
  linkUrl?: string;
}

export interface ExchangeCredsInput {
  email?: string;
  password?: string;
  apiKey?: string;
  apiSecret?: string;
  totpSecret?: string;
  passphrase?: string;
}

export interface ExchangeCredsSummary {
  exchange: string;
  email: string;
  hasPassword: boolean;
  hasApiKey: boolean;
  hasApiSecret: boolean;
}

export interface ExchangeCredsDecrypted {
  exchange: string;
  email: string;
  password: string;
  apiKey: string;
  apiSecret: string;
  totpSecret: string;
  passphrase: string;
}

export interface WalletConfigRow {
  id: number;
  address: string | null;
  label: string | null;
  network: string;
  updated_at: number;
}

export interface SettingRow {
  value: string;
}

export interface AdminUserRow {
  id: number;
  username: string;
  password_hash: string;
  force_pw_change?: number;
  mfa_secret?: string | null;
  mfa_enabled?: number;
  created_at: number;
}

export interface SessionRow {
  token: string;
  user_id: number;
  expires_at: number;
  ip_address?: string | null;
  user_agent?: string | null;
  session_type?: string | null;
}

export interface CountRow {
  c: number;
}

export interface CustomerRow {
  id: number;
  telegram_id: string | null;
  referral_code: string;
  referred_by: string | null;
  total_volume_jpy: number;
  total_orders: number;
  vip_rank: string;
  created_at: string;
  updated_at: string;
}

export interface NotificationPrefRow {
  telegram_id: number;
  daily_summary: number;
  spike_alerts: number;
  weekly_summary: number;
  alert_crypto: string;
  alert_threshold: number;
}

export interface FeeSettingsRow {
  id: number;
  base_fee_rate: number;
  vip_bronze_rate: number;
  vip_silver_rate: number;
  vip_gold_rate: number;
  vip_platinum_rate: number;
  updated_at: string;
}

export interface FeeReportTotalRow {
  total_fee_jpy: number;
  total_fee_crypto: number;
  order_count: number;
}

export interface FeeReportDayRow {
  day: string;
  fee_jpy: number;
  fee_crypto: number;
  order_count: number;
}

export interface FeeReportCryptoRow {
  crypto: string;
  fee_jpy: number;
  fee_crypto: number;
  order_count: number;
}

export interface BankTransferRow {
  id: number;
  order_id: string | null;
  bank_account_id: number | null;
  sender_name: string | null;
  amount: number;
  transfer_date: string;
  reference: string | null;
  verification_method: string;
  status: string;
  matched_at: number | null;
  created_at: number;
}

export interface CryptoTransactionRow {
  id: number;
  order_id: string;
  tx_id: string;
  crypto: string;
  amount: number;
  to_address: string;
  status: string;
  created_at: number;
  confirmed_at: number | null;
}

export interface AuditLogEntry {
  id: number;
  user_id: number | null;
  username: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  details: string | null;
  ip_address: string | null;
  created_at: number;
}

export interface P2PSellerRow {
  id: number;
  name: string;
  email: string;
  password_hash: string;
  paypay_id: string | null;
  linepay_id: string | null;
  aupay_id: string | null;
  usdt_balance: number;
  usdt_locked: number;
  min_amount: number;
  max_amount: number;
  pay_methods: string;
  status: string;
  confirm_token: string;
  telegram_chat_id: string | null;
  total_trades: number;
  created_at: number;
  last_active: number | null;
}

export interface WithdrawalRow {
  id: number;
  external_ref: string | null;
  tracking_token: string;
  merchant_api_key_id: number | null;
  amount: number;
  pay_method: string;
  bank_name: string | null;
  branch_name: string | null;
  account_type: string;
  account_number: string | null;
  account_holder: string | null;
  paypay_id: string | null;
  status: string;
  matched_order_id: string | null;
  matched_seller_id: number | null;
  webhook_url: string | null;
  created_at: number;
  expires_at: number;
  completed_at: number | null;
}

export interface WithdrawalData {
  id: number;
  externalRef: string | null;
  trackingToken: string;
  merchantApiKeyId: number | null;
  amount: number;
  payMethod: string;
  bankName: string | null;
  branchName: string | null;
  accountType: string;
  accountNumber: string;
  accountHolder: string;
  paypayId: string | null;
  status: string;
  matchedOrderId: string | null;
  matchedSellerId: number | null;
  webhookUrl: string | null;
  createdAt: number;
  expiresAt: number;
  completedAt: number | null;
}

export interface MerchantApiKeyRow {
  id: number;
  name: string;
  key_hash: string;
  key_prefix: string;
  webhook_url: string | null;
  webhook_secret: string | null;
  is_active: number;
  created_at: number;
  last_used_at: number | null;
}

export interface ExchangeOrderRow {
  id: number;
  order_id: string;
  exchange: string;
  channel: string;
  exchange_order_id: string | null;
  status: string;
  seller_name: string | null;
  seller_bank_info: string | null;
  amount_jpy: number | null;
  crypto_amount: number | null;
  rate: number | null;
  error_message: string | null;
  screenshot_path: string | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
}

export interface ExchangeOrderData extends Omit<ExchangeOrderRow, 'seller_bank_info'> {
  sellerBankInfo: unknown;
}

export interface KeyValueRow {
  key: string;
  value: string;
}

export interface ReferralStatsRow {
  referral_count: number;
  total_rewards: number;
}

export interface ReferralRewardRow {
  id: number;
  referrer_telegram_id: string;
  referred_telegram_id: string;
  order_id: string;
  reward_jpy: number;
  status: string;
  created_at: string;
}

export interface TelegramIdRow {
  telegram_id: number;
}

export interface OrderStatusExtra {
  paidAt?: number;
  completedAt?: number;
  verifiedAt?: number;
  txId?: string;
}

export interface FeeSettingsUpdate {
  base_fee_rate?: number;
  vip_bronze_rate?: number;
  vip_silver_rate?: number;
  vip_gold_rate?: number;
  vip_platinum_rate?: number;
}

export interface CostConfig {
  id: number;
  tron_gas_jpy: number;
  bank_transfer_fee_jpy: number;
  exchange_fee_rate: number;
  min_margin_jpy: number;
  min_margin_rate: number;
  auto_adjust_fee: number;
  updated_at: number;
}

export interface TransactionCost {
  id: number;
  order_id: string;
  cost_type: string;
  amount_jpy: number;
  description: string | null;
  created_at: number;
}

export interface TruPayWithdrawalRow {
  id: number;
  trupay_id: number;
  system_transaction_id: string;
  transaction_id: string;
  amount_jpy: number;
  bank_name: string;
  branch_name: string;
  account_number: string;
  account_name: string;
  account_type: string;
  trupay_status: number;
  status: string;
  matched_at: number | null;
  completed_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface TruPayMatchRow {
  id: number;
  withdrawal_id: number;
  buyer_id: string;
  buyer_wallet: string;
  rate_jpy_usdt: number;
  amount_jpy: number;
  amount_usdt: number;
  timeout_at: number;
  reference_number: string | null;
  usdt_tx_hash: string | null;
  status: string;
  created_at: number;
  updated_at: number;
}
