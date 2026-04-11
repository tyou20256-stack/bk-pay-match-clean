/**
 * @file redisClient.ts — Optional Redis client for session caching
 * Falls back gracefully to SQLite-only if Redis is not available.
 * Redis becomes active only when REDIS_URL is set and the redis package is installed.
 */
import logger from './logger.js';

interface RedisLike {
  setEx(key: string, ttl: number, value: string): Promise<void>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<void>;
  connect(): Promise<void>;
  on(event: string, handler: (...args: unknown[]) => void): void;
}

let redisAvailable = false;
let redisClient: RedisLike | null = null;

export async function initRedis(): Promise<void> {
  const url = process.env.REDIS_URL;
  if (!url) {
    logger.info('Redis not configured, using SQLite-only sessions');
    return;
  }

  try {
    // Dynamic import — redis package is optional
     
     
    const redisMod = await (Function('return import("redis")')() as Promise<Record<string, unknown>>);
    const createClient = redisMod.createClient as (opts: { url: string }) => RedisLike;
    redisClient = createClient({ url });
    redisClient.on('error', (err: unknown) => {
      logger.warn('Redis error', { error: err instanceof Error ? err.message : String(err) });
      redisAvailable = false;
    });
    redisClient.on('connect', () => {
      redisAvailable = true;
      logger.info('Redis connected');
    });
    await redisClient.connect();
  } catch (e) {
    logger.info('Redis not available, using SQLite-only sessions', {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

export async function cacheSet(key: string, value: string, ttlSeconds: number): Promise<void> {
  if (!redisAvailable || !redisClient) return;
  try {
    await redisClient.setEx(key, ttlSeconds, value);
  } catch {
    /* fallback to SQLite */
  }
}

export async function cacheGet(key: string): Promise<string | null> {
  if (!redisAvailable || !redisClient) return null;
  try {
    return await redisClient.get(key);
  } catch {
    return null;
  }
}

export async function cacheDel(key: string): Promise<void> {
  if (!redisAvailable || !redisClient) return;
  try {
    await redisClient.del(key);
  } catch {
    /* ignore */
  }
}

export function isRedisAvailable(): boolean {
  return redisAvailable;
}
