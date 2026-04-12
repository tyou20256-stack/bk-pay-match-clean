/**
 * @file index.ts — Barrel re-export for all db modules
 */

// Connection: db instance, lifecycle, types, helpers
export {
  db,
  default,
  closeDatabase,
  safeJsonParse,
} from './connection.js';

// Re-export all interfaces/types from connection
export type {
  OrderRow,
  OrderData,
  BankAccountRow,
  BankAccountInput,
  EpayConfigRow,
  EpayConfigInput,
  ExchangeCredsInput,
  ExchangeCredsSummary,
  ExchangeCredsDecrypted,
  WalletConfigRow,
  SettingRow,
  AdminUserRow,
  SessionRow,
  CountRow,
  CustomerRow,
  NotificationPrefRow,
  FeeSettingsRow,
  FeeReportTotalRow,
  FeeReportDayRow,
  FeeReportCryptoRow,
  BankTransferRow,
  CryptoTransactionRow,
  AuditLogEntry,
  P2PSellerRow,
  WithdrawalRow,
  WithdrawalData,
  MerchantApiKeyRow,
  ExchangeOrderRow,
  ExchangeOrderData,
  KeyValueRow,
  ReferralStatsRow,
  ReferralRewardRow,
  TelegramIdRow,
  OrderStatusExtra,
  FeeSettingsUpdate,
  CostConfig,
  TransactionCost,
  TruPayWithdrawalRow,
  TruPayMatchRow,
} from './connection.js';

// Encryption
export {
  encrypt,
  decrypt,
  encryptBankField,
  decryptBankField,
} from './encryption.js';

// Auth
export {
  createAdminUser,
  authenticateUser,
  verifyMfaAndLogin,
  setupMfa,
  enableMfa,
  verifyUserPassword,
  getMfaStatus,
  disableMfa,
  validateSession,
  deleteSession,
  deleteAllUserSessions,
  getSessionUserId,
  changePassword,
} from './auth.js';

// Orders
export {
  rowToOrder,
  saveOrder,
  getOrder,
  getAllOrders,
  updateOrderStatus,
  getExpiredPendingOrders,
  transitionOrderStatus,
  claimOrderForSending,
  createSellOrder,
  getSellOrdersAwaitingDeposit,
  getConfirmingOrders,
  saveOrderSellerId,
  confirmOrderBySeller,
  getOrdersBySellerId,
  saveOrderWithdrawalId,
  saveOrderWithMerchantKey,
} from './orders.js';

// Accounts (bank, epay, exchange creds, wallet)
export {
  addBankAccount,
  getBankAccounts,
  updateBankAccount,
  deleteBankAccount,
  getRoutableAccount,
  bulkAddBankAccounts,
  saveEpayConfig,
  getEpayConfig,
  getAllEpayConfig,
  saveExchangeCreds,
  getExchangeCreds,
  getExchangeCredsDecrypted,
  saveWalletConfig,
  getWalletConfig,
} from './accounts.js';

// Config
export {
  setSetting,
  getSetting,
  getAutoTradeConfig,
  setAutoTradeConfig,
  getWalletThresholds,
  setWalletThreshold,
  setSystemConfig,
  getSystemConfig,
  deleteSystemConfig,
  getSystemConfigMeta,
} from './config.js';

// Customers
export {
  getVipDiscount,
  getOrCreateCustomer,
  applyReferralCode,
  addReferralReward,
  updateCustomerVolume,
  getCustomerStats,
  getReferralStats,
  getAllCustomers,
  getAllReferralRewards,
  getCustomerByReferralCode,
  createReferralCode,
  getReferralByCode,
  recordReferralConversion,
  getP2pReferralStats,
} from './customers.js';

// P2P Sellers
export {
  createP2PSeller,
  getP2PSeller,
  getP2PSellerByEmail,
  getP2PSellerByToken,
  listP2PSellers,
  listActiveP2PSellers,
  updateP2PSellerStatus,
  updateP2PSeller,
  creditP2PSellerBalance,
  lockP2PSellerBalance,
  releaseP2PSellerBalance,
  deductP2PSellerBalance,
  listActiveP2PSellersAnyMethod,
} from './p2p.js';

// Withdrawals
export {
  createWithdrawal,
  getWithdrawal,
  getWithdrawalByToken,
  getWithdrawalByExternalRef,
  updateWithdrawalStatus,
  listWithdrawals,
  revertWithdrawalToPending,
  claimPendingWithdrawalByAmount,
  findPendingWithdrawalByAmount,
} from './withdrawals.js';

// Merchant
export {
  createMerchantApiKey,
  getMerchantApiKeyByHash,
  getMerchantApiKeyById,
  listMerchantApiKeys,
  revokeMerchantApiKey,
  touchMerchantApiKey,
} from './merchant.js';

// Transfers
export {
  recordBankTransfer,
  getBankTransfers,
  updateBankTransfer,
  getUnmatchedBankTransfers,
  recordCryptoTransaction,
  getCryptoTransactions,
  getUnconfirmedTransactions,
  updateCryptoTransactionStatus,
} from './transfers.js';

// Audit
export {
  recordAuditLog,
  getAuditLog,
} from './audit.js';

// Fees
export {
  getFeeSettings,
  updateFeeSettings,
  getFeeRateForRank,
  getFeeReport,
  getCostConfig,
  updateCostConfig,
  recordTransactionCost,
  getTransactionCosts,
  getTotalTransactionCost,
  estimateOrderCost,
} from './fees.js';

// Notifications
export {
  getNotificationSubscribers,
  setNotificationPreference,
  getNotificationPreferences,
  setAlertThreshold,
  createRateAlert,
  getActiveRateAlerts,
  triggerRateAlert,
  insertFunnelEvent,
} from './notifications.js';

// Exchange Orders
export {
  createExchangeOrder,
  getExchangeOrder,
  getExchangeOrderById,
  updateExchangeOrder,
  listExchangeOrders,
  listActiveExchangeOrders,
} from './exchange.js';

// TruPay
export {
  insertTruPayWithdrawal,
  getTruPayWithdrawalById,
  getTruPayWithdrawalByTruPayId,
  getQueuedTruPayWithdrawals,
  expireOldQueuedWithdrawals,
  getTruPayWithdrawals,
  updateTruPayWithdrawalStatus,
  insertTruPayMatch,
  getTruPayMatch,
  getTruPayMatchByWithdrawalId,
  getActiveTruPayMatches,
  getTruPayMatches,
  updateTruPayMatchStatus,
  getTruPayStats,
  dbInsertPendingBuyer,
  dbGetActivePendingBuyers,
  dbDeletePendingBuyer,
  dbExpireOldPendingBuyers,
} from './trupay.js';

// PayPay
export {
  insertPayPayConversion,
  getWaitingPayPayConversions,
  getActivePayPayProviders,
  insertPayPayProvider,
  matchPayPayConversion,
  updatePayPayConversionStatus,
  getPayPayConversion,
  getPayPayConversionByRequesterId,
  deletePayPayProvider,
  expirePayPayConversions,
} from './paypay.js';
