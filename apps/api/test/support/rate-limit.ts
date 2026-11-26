import crypto from "node:crypto";
import type { Sql } from "postgres";
import {
  createPostgresRateLimitStore,
  type FailurePolicy,
  type RateLimitStore,
} from "../../src/lib/rate-limit-store.js";

/**
 * Never inject a fake clock into a Postgres store far in the past or future
 * on a database other test files share (the CI `librehr_test` database):
 * its sweep deletes every bucket that expired before the fake "now", so a
 * future clock would wipe other files' live counters and lockouts. Use fake
 * clocks only on a per-file database (createRoleSeparatedDatabase), as the
 * rate-limit suites do, or the memory double.
 *
 * The shared Postgres store under a random (or given) key prefix: an app
 * built with it starts with fresh counters although it shares the test
 * database with other apps of the same file. Two apps given the same
 * `prefix` behave as two replicas of one deployment.
 */
export function isolatedRateLimitStore(
  sql: Sql,
  options: { prefix?: string; now?: () => number } = {},
): RateLimitStore {
  return createPostgresRateLimitStore(sql, {
    keyPrefix: `${options.prefix ?? crypto.randomUUID()}:`,
    now: options.now,
  });
}

/**
 * In-memory test double for routes exercised against a fake `sql`, where the
 * Postgres store has no table to write to. It mirrors the semantics of
 * RateLimitRepository; rate-limit-store-parity.int.test.ts runs the same
 * scenarios against both. Never used by the app itself.
 */
export function memoryRateLimitStore(now = Date.now): RateLimitStore {
  const hits = new Map<string, { count: number; resetAt: number }>();
  const failures = new Map<
    string,
    { count: number; windowStart: number; lockedUntil: number }
  >();

  /** One failure (or reserved attempt) against `key`; mirrors failureUpsert. */
  const fail = (key: string, policy: FailurePolicy, at: number) => {
    let record = failures.get(key);
    // A new window keeps any lock: a lockout may outlast the window.
    if (!record || at - record.windowStart > policy.windowMs) {
      record = {
        count: 0,
        windowStart: at,
        lockedUntil: record?.lockedUntil ?? 0,
      };
    }
    record = { ...record, count: record.count + 1 };
    if (record.count >= policy.limit) {
      record = {
        count: 0,
        windowStart: at,
        lockedUntil: Math.max(record.lockedUntil, at + policy.lockoutMs),
      };
    }
    failures.set(key, record);
  };
  const lockedMs = (key: string, at: number) =>
    Math.max(0, (failures.get(key)?.lockedUntil ?? 0) - at);

  return {
    now,
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
      return Math.max(0, ...keys.map((k) => lockedMs(k, at)));
    },
    async recordFailure(entries, policy) {
      const at = now();
      for (const { key, limit } of entries) fail(key, { ...policy, limit }, at);
    },
    async reserveAttempt(key, policy) {
      const at = now();
      const locked = lockedMs(key, at);
      if (locked > 0) return { allowed: false, lockedMs: locked };
      fail(key, policy, at);
      return { allowed: true };
    },
    async reset(key) {
      failures.delete(key);
    },
  };
}
