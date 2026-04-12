/**
 * @file encryption.ts — AES-256-GCM encryption with PBKDF2 key derivation
 */
import crypto from 'crypto';
import logger from '../logger.js';

// === Encryption (AES-256-GCM with PBKDF2 key derivation) ===
const RAW_ENC_KEY = process.env.BK_ENC_KEY || '';
if (!RAW_ENC_KEY || RAW_ENC_KEY === 'bkpay-default-key-change-me-32ch' || RAW_ENC_KEY === 'change-me-to-random-32-chars-key-here') {
  if (process.env.NODE_ENV === 'production') {
    logger.fatal('BK_ENC_KEY must be set to a secure random value in production! Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
    process.exit(1);
  }
  logger.warn('BK_ENC_KEY is not set or is a default value. ALL stored credentials are insecure. Set a proper key before deployment.');
} else if (RAW_ENC_KEY.length < 32) {
  logger.warn('BK_ENC_KEY should be at least 32 characters long');
}
const ENC_KEY_FALLBACK = RAW_ENC_KEY || 'bkpay-default-key-change-me-32ch';
// Derive a proper 32-byte key via PBKDF2 (deterministic, so existing data remains readable)
const ENC_SALT = process.env.BK_ENC_SALT || 'bkpay-enc-salt-v2';
if (!process.env.BK_ENC_SALT && process.env.NODE_ENV === 'production') {
  logger.warn('BK_ENC_SALT not set in production — using default salt. Set a unique value for stronger key derivation.');
}
const DERIVED_KEY = crypto.pbkdf2Sync(ENC_KEY_FALLBACK, ENC_SALT, 100000, 32, 'sha256');

export function encrypt(text: string): string {
  // AES-256-GCM: iv(12) + authTag(16) + ciphertext
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', DERIVED_KEY, iv);
  let enc = cipher.update(text, 'utf8', 'hex');
  enc += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return 'gcm:' + iv.toString('hex') + ':' + authTag + ':' + enc;
}
export function decrypt(text: string): string {
  try {
    if (text.startsWith('gcm:')) {
      // AES-256-GCM format: gcm:iv:authTag:ciphertext
      const parts = text.split(':');
      const iv = Buffer.from(parts[1], 'hex');
      const authTag = Buffer.from(parts[2], 'hex');
      const encHex = parts[3];
      const decipher = crypto.createDecipheriv('aes-256-gcm', DERIVED_KEY, iv);
      decipher.setAuthTag(authTag);
      let dec = decipher.update(encHex, 'hex', 'utf8');
      dec += decipher.final('utf8');
      return dec;
    }
    // Legacy AES-256-CBC fallback (for data encrypted before upgrade)
    logger.warn('Legacy CBC decryption used — data should be re-encrypted', { length: text.length });
    const [ivHex, encHex] = text.split(':');
    const legacyKey = Buffer.from(ENC_KEY_FALLBACK.padEnd(32).slice(0, 32));
    const decipher = crypto.createDecipheriv('aes-256-cbc', legacyKey, Buffer.from(ivHex, 'hex'));
    let dec = decipher.update(encHex, 'hex', 'utf8');
    dec += decipher.final('utf8');
    return dec;
  } catch (e) {
    logger.warn('Decryption failed', { error: e instanceof Error ? e.message : String(e) });
    return '[DECRYPTION_FAILED]';
  }
}

// === Bank Account Field Encryption ===
// Transparent encrypt/decrypt for account_number and account_holder
export function encryptBankField(value: string): string {
  if (!value) return value;
  return encrypt(value);
}
export function decryptBankField(value: string): string {
  if (!value) return value;
  if (value.startsWith('gcm:')) return decrypt(value);
  return value; // Plaintext (legacy, not yet migrated)
}
