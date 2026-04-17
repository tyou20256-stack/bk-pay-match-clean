/**
 * @file encryption.ts — AES-256-GCM encryption with PBKDF2 key derivation
 */
import crypto from 'crypto';
import logger from '../logger.js';

// === Encryption (AES-256-GCM with PBKDF2 key derivation) ===
// H1: BK_ENC_KEY is REQUIRED in ALL environments — no fallback key
const RAW_ENC_KEY = process.env.BK_ENC_KEY || '';
if (!RAW_ENC_KEY || RAW_ENC_KEY === 'bkpay-default-key-change-me-32ch' || RAW_ENC_KEY === 'change-me-to-random-32-chars-key-here') {
  const msg = 'FATAL: BK_ENC_KEY must be set to a secure random value. Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"';
  logger.fatal(msg);
  throw new Error(msg);
} else if (RAW_ENC_KEY.length < 32) {
  logger.warn('BK_ENC_KEY should be at least 32 characters long');
}
// Derive a proper 32-byte key via PBKDF2 (deterministic, so existing data remains readable)
const ENC_SALT = process.env.BK_ENC_SALT || 'bkpay-enc-salt-v2';
if (!process.env.BK_ENC_SALT) {
  if (process.env.NODE_ENV === 'production') {
    logger.error('BK_ENC_SALT not set in production — using default salt. This weakens key derivation. Set a unique value.');
  } else {
    logger.warn('BK_ENC_SALT not set — using default salt for backward compatibility.');
  }
}
// L2: 600k iterations for new data; legacy key derived at 100k for decrypting old data
const PBKDF2_ITERATIONS_V2 = 600_000;
const PBKDF2_ITERATIONS_V1 = 100_000;
const DERIVED_KEY = crypto.pbkdf2Sync(RAW_ENC_KEY, ENC_SALT, PBKDF2_ITERATIONS_V2, 32, 'sha256');
const DERIVED_KEY_V1 = crypto.pbkdf2Sync(RAW_ENC_KEY, ENC_SALT, PBKDF2_ITERATIONS_V1, 32, 'sha256');

export function encrypt(text: string): string {
  // L2: AES-256-GCM with v2 marker (600k iterations)
  // Format: gcm2:iv:authTag:ciphertext
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', DERIVED_KEY, iv);
  let enc = cipher.update(text, 'utf8', 'hex');
  enc += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return 'gcm2:' + iv.toString('hex') + ':' + authTag + ':' + enc;
}
export function decrypt(text: string): string {
  try {
    if (text.startsWith('gcm2:')) {
      // AES-256-GCM v2 format (600k iterations): gcm2:iv:authTag:ciphertext
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
    if (text.startsWith('gcm:')) {
      // AES-256-GCM v1 format (100k iterations): gcm:iv:authTag:ciphertext
      logger.warn('Decrypting GCM v1 data (100k iterations) — should be re-encrypted with v2', { length: text.length });
      const parts = text.split(':');
      const iv = Buffer.from(parts[1], 'hex');
      const authTag = Buffer.from(parts[2], 'hex');
      const encHex = parts[3];
      const decipher = crypto.createDecipheriv('aes-256-gcm', DERIVED_KEY_V1, iv);
      decipher.setAuthTag(authTag);
      let dec = decipher.update(encHex, 'hex', 'utf8');
      dec += decipher.final('utf8');
      return dec;
    }
    // H4: Legacy AES-256-CBC fallback — gated behind ALLOW_CBC_DECRYPT to prevent downgrade
    if (process.env.ALLOW_CBC_DECRYPT !== 'true') {
      logger.error('CBC decryption blocked (ALLOW_CBC_DECRYPT not set). Run migration v28 to re-encrypt all data to GCM.', { length: text.length });
      return '[DECRYPTION_FAILED]';
    }
    logger.warn('DEPRECATED: Legacy CBC decryption used — data should be re-encrypted to GCM', { length: text.length });
    const [ivHex, encHex] = text.split(':');
    const legacyKey = Buffer.from(RAW_ENC_KEY.padEnd(32).slice(0, 32));
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
  if (value.startsWith('gcm2:') || value.startsWith('gcm:')) return decrypt(value);
  // Check for legacy CBC (hex:hex pattern)
  if (/^[0-9a-f]+:[0-9a-f]+$/i.test(value)) return decrypt(value);
  return value; // Plaintext (legacy, not yet migrated)
}
