import crypto from "node:crypto";
import type { Sql } from "postgres";
import {
  RateLimitRepository,
  type AttemptReservation,
  type FailurePolicy,
} from "@librehr/db";
import { logger } from "../middleware/logger.js";

export type { AttemptReservation, FailurePolicy };

/**
 * Where rate limits and failure lockouts keep their counters (issue #35).
 * Keys are plain, namespaced strings ("auth.sign-in.ip:203.0.113.7"); the
 * store hashes them before they leave the process.
 */
export interface RateLimitStore {
  /** Epoch ms for in-process caches of refusals (not for allowing). */
  now(): number;
  /** Counts one request; returns the window's count and ms until it resets. */
  hit(
    key: string,
    windowMs: number,
  ): Promise<{ count: number; resetInMs: number }>;
  /** Ms until every one of `keys` is unlocked; 0 when none is locked. */
  lockedFor(keys: readonly string[]): Promise<number>;
  /**
   * Records one failure against each key with its own limit. Each key is
   * its own atomic statement, not one transaction: if a later key fails,
   * the request errors (fails closed) and earlier keys keep their count.
   */
  recordFailure(
    failures: ReadonlyArray<{ key: string; limit: number }>,
    policy: Omit<FailurePolicy, "limit">,
  ): Promise<void>;
  /**
   * Atomically counts an attempt before it is verified, refused while the
   * key is locked; the attempt reaching `limit` locks it. Clear the key with
   * `reset` when the attempt succeeds.
   */
  reserveAttempt(
    key: string,
    policy: FailurePolicy,
  ): Promise<AttemptReservation>;
  /** Clears a key after a successful attempt. */
  reset(key: string): Promise<void>;
}

export interface PostgresRateLimitStoreOptions {
  /**
   * Server-side secret (SESSION_SECRET) that keys the HMAC of bucket keys, so
   * stored digests of low-entropy values (IPs, emails) cannot be reversed by
   * brute force. Without it a fixed dev key is used, which `requireSecret`
   * forbids.
   */
  secret?: string | undefined;
  /** Throw instead of falling back to the dev key (production). */
  requireSecret?: boolean | undefined;
  /** Separates buckets of apps that share one database (tests only). */
  keyPrefix?: string | undefined;
  /**
   * Test clock in epoch ms. When set it also replaces the database clock;
   * production leaves it unset so all replicas use the database's time.
   */
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
    .createHmac("sha256", secret || DEV_SECRET)
    .update("librehr/rate-limit-key/v1")
    .digest();
  return (key) =>
    crypto.createHmac("sha256", derived).update(key).digest("hex");
}

/**
 * Rate-limit store in Postgres, shared by every API replica on the database.
 * Expired buckets are swept from the request path in the background, at
 * most once per `sweepEveryMs` and one sweep at a time per process; a failed
 * sweep is logged and retried on a later request.
 */
export function createPostgresRateLimitStore(
  sql: Sql,
  options: PostgresRateLimitStoreOptions = {},
): RateLimitStore {
  if (options.requireSecret && !options.secret) {
    throw new Error(
      "SESSION_SECRET is required: it keys the rate-limit bucket hashes",
    );
  }
  const repo = new RateLimitRepository();
  const digest = rateLimitKeyHasher(options.secret);
  const prefix = options.keyPrefix ?? "";
  const hash = (key: string) => digest(prefix + key);
  const testNow = options.now;
  const now = testNow ?? Date.now;
  // Database clock unless a test clock is injected.
  const dbNow = () => (testNow ? testNow() : undefined);
  const sweepEveryMs = options.sweepEveryMs ?? 60_000;
  let lastSweep = Number.NEGATIVE_INFINITY;
  let sweeping = false;

  const maybeSweep = () => {
    const at = now();
    if (sweeping || at - lastSweep < sweepEveryMs) return;
    lastSweep = at;
    sweeping = true;
    repo
      .deleteExpired(sql, { nowMs: dbNow() })
      .catch((err: unknown) => {
        logger.warn({
          msg: "rate limit sweep failed",
          error: err instanceof Error ? err.name : "unknown",
        });
      })
      .finally(() => {
        sweeping = false;
      });
  };

  return {
    now,
    async hit(key, windowMs) {
      const result = await repo.hit(sql, hash(key), windowMs, dbNow());
      maybeSweep();
      return result;
    },
    lockedFor(keys) {
      return repo.lockedForMs(sql, keys.map(hash), dbNow());
    },
    async recordFailure(failures, policy) {
      for (const { key, limit } of failures) {
        await repo.recordFailure(sql, hash(key), { ...policy, limit }, dbNow());
      }
    },
    reserveAttempt(key, policy) {
      return repo.reserveAttempt(sql, hash(key), policy, dbNow());
    },
    async reset(key) {
      await repo.remove(sql, hash(key));
    },
  };
}
