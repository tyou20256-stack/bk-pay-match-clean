import './setup.js';
import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { encrypt, decrypt } from '../../src/services/db/encryption.js';

describe('encryption (GCM v2)', () => {
  it('roundtrip: encrypt then decrypt returns original', () => {
    const plain = 'sensitive-data-12345';
    const enc = encrypt(plain);
    expect(enc).not.toBe(plain);
    expect(decrypt(enc)).toBe(plain);
  });

  it('new encrypt() output uses gcm2: prefix (v2 / 600k iterations)', () => {
    const enc = encrypt('anything');
    expect(enc.startsWith('gcm2:')).toBe(true);
  });

  it('format has 4 colon-separated parts: prefix:iv:authTag:ciphertext', () => {
    const enc = encrypt('x');
    const parts = enc.split(':');
    expect(parts.length).toBe(4);
    expect(parts[0]).toBe('gcm2');
    expect(parts[1]).toMatch(/^[0-9a-f]{24}$/); // 12-byte IV in hex
    expect(parts[2]).toMatch(/^[0-9a-f]{32}$/); // 16-byte auth tag in hex
  });

  it('each encrypt() call produces different ciphertext (random IV)', () => {
    const a = encrypt('same-plaintext');
    const b = encrypt('same-plaintext');
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe(decrypt(b));
  });

  it('tampered ciphertext fails authentication (decrypt returns marker)', () => {
    const enc = encrypt('original');
    const tampered = enc.slice(0, -2) + '00';
    const result = decrypt(tampered);
    expect(result).toBe('[DECRYPTION_FAILED]');
  });

  it('handles empty string', () => {
    const enc = encrypt('');
    expect(decrypt(enc)).toBe('');
  });

  it('handles unicode (Japanese)', () => {
    const plain = 'これはテストです 🎉';
    expect(decrypt(encrypt(plain))).toBe(plain);
  });

  it('handles large payload (10KB)', () => {
    const plain = crypto.randomBytes(5000).toString('hex'); // 10k chars
    expect(decrypt(encrypt(plain))).toBe(plain);
  });

  it('can decrypt gcm: (v1 100k) format for backward compat', () => {
    // Simulate v1 data: gcm:iv:authTag:ciphertext with 100k-iter key
    const salt = process.env.BK_ENC_SALT || 'unit-test-salt-v2';
    const rawKey = process.env.BK_ENC_KEY!;
    const v1Key = crypto.pbkdf2Sync(rawKey, salt, 100_000, 32, 'sha256');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', v1Key, iv);
    let enc = cipher.update('v1-data', 'utf8', 'hex');
    enc += cipher.final('hex');
    const tag = cipher.getAuthTag().toString('hex');
    const v1Enc = 'gcm:' + iv.toString('hex') + ':' + tag + ':' + enc;
    expect(decrypt(v1Enc)).toBe('v1-data');
  });
});
