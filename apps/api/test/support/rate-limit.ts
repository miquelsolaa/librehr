import crypto from "node:crypto";
import type { Sql } from "postgres";
import {
  createPostgresRateLimitStore,
  type RateLimitStore,
} from "../../src/lib/rate-limit-store.js";

/**
 * The shared Postgres store under a random key prefix: an app built with it
 * starts with fresh counters although it shares the test database with
 * other apps of the same file.
 */
export function isolatedRateLimitStore(
  sql: Sql,
  now?: () => number,
): RateLimitStore {
  return createPostgresRateLimitStore(sql, {
    keyPrefix: `${crypto.randomUUID()}:`,
    now,
  });
}

/**
 * In-memory test double for routes exercised against a fake `sql`, where the
 * Postgres store has no table to write to. Never used by the app itself.
 */
export function memoryRateLimitStore(now = Date.now): RateLimitStore {
  const hits = new Map<string, { count: number; resetAt: number }>();
  const failures = new Map<
    string,
    { count: number; windowStart: number; lockedUntil: number }
  >();
  return {
    async hit(key, windowMs) {
      const at = now();
      const current = hits.get(key);
      const next =
        !current || current.resetAt <= at
          ? { count: 1, resetAt: at + windowMs }
          : { count: current.count + 1, resetAt: current.resetAt };
      hits.set(key, next);
      return { count: next.count, resetInMs: next.resetAt - at };
    },
    async lockedFor(keys) {
      const at = now();
      return Math.max(
        0,
        ...keys.map((k) => (failures.get(k)?.lockedUntil ?? 0) - at),
      );
    },
    async recordFailure(entries, policy) {
      const at = now();
      for (const { key, limit } of entries) {
        let record = failures.get(key);
        if (!record || at - record.windowStart > policy.windowMs) {
          record = { count: 0, windowStart: at, lockedUntil: 0 };
        }
        record.count++;
        if (record.count >= limit) {
          record = {
            count: 0,
            windowStart: at,
            lockedUntil: at + policy.lockoutMs,
          };
        }
        failures.set(key, record);
      }
    },
    async reset(key) {
      failures.delete(key);
    },
  };
}
