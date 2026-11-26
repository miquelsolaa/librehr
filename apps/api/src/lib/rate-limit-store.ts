import crypto from "node:crypto";
import type { Sql } from "postgres";
import { RateLimitRepository, type FailurePolicy } from "@librehr/db";
import { logger } from "../middleware/logger.js";

/**
 * Where rate limits and failure lockouts keep their counters (issue #35).
 * Keys are plain, namespaced strings ("auth.sign-in.ip:203.0.113.7"); the
 * store hashes them before they leave the process.
 */
export interface RateLimitStore {
  /** Counts one request; returns the window's count and ms until it resets. */
  hit(
    key: string,
    windowMs: number,
  ): Promise<{ count: number; resetInMs: number }>;
  /** Ms until every one of `keys` is unlocked; 0 when none is locked. */
  lockedFor(keys: readonly string[]): Promise<number>;
  /** Records one failure against each key with its own limit. */
  recordFailure(
    failures: ReadonlyArray<{ key: string; limit: number }>,
    policy: Omit<FailurePolicy, "limit">,
  ): Promise<void>;
  /** Clears a key after a successful attempt. */
  reset(key: string): Promise<void>;
}

export interface PostgresRateLimitStoreOptions {
  /**
   * Server-side secret (SESSION_SECRET) that keys the HMAC of bucket keys, so
   * stored digests of low-entropy values (IPs, emails) cannot be reversed by
   * brute force. Without it (tests, local runs) a fixed dev key is used.
   */
  secret?: string | undefined;
  /** Separates buckets of apps that share one database (tests only). */
  keyPrefix?: string | undefined;
  /** Clock in epoch ms; tests inject a fake one. */
  now?: (() => number) | undefined;
  /** Minimum ms between two sweeps of expired buckets from this process. */
  sweepEveryMs?: number | undefined;
}

const DEV_SECRET = "librehr-dev-rate-limit-key";

/**
 * Derives the HMAC key for bucket keys from the server secret, separate from
 * any other use of that secret.
 */
export function rateLimitKeyHasher(
  secret: string | undefined,
): (key: string) => string {
  const derived = crypto
    .createHmac("sha256", secret ?? DEV_SECRET)
    .update("librehr/rate-limit-key/v1")
    .digest();
  return (key) =>
    crypto.createHmac("sha256", derived).update(key).digest("hex");
}

/**
 * Rate-limit store in Postgres, shared by every API replica on the database.
 * Expired buckets are swept from the request path at most once per
 * `sweepEveryMs` per process, in the background; a failed sweep is logged
 * and retried on a later request.
 */
export function createPostgresRateLimitStore(
  sql: Sql,
  options: PostgresRateLimitStoreOptions = {},
): RateLimitStore {
  const repo = new RateLimitRepository();
  const digest = rateLimitKeyHasher(options.secret);
  const prefix = options.keyPrefix ?? "";
  const hash = (key: string) => digest(prefix + key);
  const now = options.now ?? Date.now;
  const sweepEveryMs = options.sweepEveryMs ?? 60_000;
  let lastSweep = Number.NEGATIVE_INFINITY;

  const maybeSweep = (at: number) => {
    if (at - lastSweep < sweepEveryMs) return;
    lastSweep = at;
    repo.deleteExpired(sql, at).catch((err: unknown) => {
      logger.warn({
        msg: "rate limit sweep failed",
        error: err instanceof Error ? err.name : "unknown",
      });
    });
  };

  return {
    async hit(key, windowMs) {
      const at = now();
      const { count, resetAt } = await repo.hit(sql, hash(key), at, windowMs);
      maybeSweep(at);
      return { count, resetInMs: Math.max(0, resetAt.getTime() - at) };
    },
    async lockedFor(keys) {
      const at = now();
      const until = await repo.lockedUntil(sql, keys.map(hash), at);
      return until ? Math.max(0, until.getTime() - at) : 0;
    },
    async recordFailure(failures, policy) {
      const at = now();
      for (const { key, limit } of failures) {
        await repo.recordFailure(sql, hash(key), at, { ...policy, limit });
      }
    },
    async reset(key) {
      await repo.remove(sql, hash(key));
    },
  };
}
