/**
 * @file setup.ts — Unit test setup
 * Sets required env vars before any db module is imported.
 * Uses in-memory SQLite to avoid touching the real DB.
 */
// CRITICAL: Set env BEFORE any imports that could trigger encryption module load
process.env.BK_ENC_KEY = process.env.BK_ENC_KEY || 'unit-test-enc-key-32-chars-long-aaaaaaaa';
process.env.BK_ENC_SALT = process.env.BK_ENC_SALT || 'unit-test-salt-v2';
process.env.BK_ADMIN_PASSWORD = process.env.BK_ADMIN_PASSWORD || 'unit-test-admin-pw';
process.env.NODE_ENV = 'test';
// Point DB to in-memory path so each test module gets a fresh isolated DB
process.env.DB_PATH = ':memory:';
