import crypto from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";
import { createProblemDetails } from "@librehr/contracts";
import { clientIp, rateLimitAddress } from "../lib/client-ip.js";
import type { RateLimitStore } from "../lib/rate-limit-store.js";

export interface RateLimiterOptions {
  /**
   * Bucket namespace, unique per limiter ("auth.sign-in.account"). Limiters
   * share one store, so two limiters with the same name share their counts.
   */
  name: string;
  store: RateLimitStore;
  windowMs: number;
  max: number;
  /** Trusted reverse-proxy hops (TRUST_PROXY); 0 ignores X-Forwarded-For. */
  trustProxy?: number | undefined;
  /**
   * Optional account identifier (email, user id) added to the bucket key, so
   * limits apply per IP and account. Return null when the request has none.
   */
  account?:
    ((c: Context) => Promise<string | null> | string | null) | undefined;
  /** Bound on the in-process cache of refused keys (default 10 000). */
  refusalCacheSize?: number | undefined;
}

const DEFAULT_REFUSAL_CACHE_SIZE = 10_000;

/**
 * Fixed-window rate limiter. Counters live in the shared store (Postgres in
 * production), so every API replica draws on the same budget per client.
 *
 * Once the store refuses a key, this process refuses it locally until the
 * window resets, so a flood from one client does not reach the database or
 * contend on its row. The cache only ever refuses: allowing is decided by
 * the store alone.
 */
export function createRateLimiter(
  options: RateLimiterOptions,
): MiddlewareHandler {
  const trustProxy = options.trustProxy ?? 0;
  const { store } = options;
  const blockedUntil = new Map<string, number>();
  const cacheSize = options.refusalCacheSize ?? DEFAULT_REFUSAL_CACHE_SIZE;

  const tooMany = (c: Context, retryInMs: number) =>
    c.json(
      createProblemDetails({
        status: 429,
        title: "Too Many Requests",
        detail: "Rate limit exceeded. Please wait before retrying.",
        code: "RATE_LIMIT_EXCEEDED",
      }),
      429,
      {
        "Content-Type": "application/problem+json",
        "Retry-After": Math.max(1, Math.ceil(retryInMs / 1000)).toString(),
      },
    );

  // When full, the oldest entry (Map insertion order) is evicted: O(1), and
  // an evicted key is simply asked about at the store again.
  const remember = (key: string, until: number) => {
    blockedUntil.delete(key);
    if (blockedUntil.size >= cacheSize) {
      const oldest = blockedUntil.keys().next();
      if (!oldest.done) blockedUntil.delete(oldest.value);
    }
    blockedUntil.set(key, until);
  };

  return async (c, next) => {
    // IPv6 clients are grouped by /64 (lib/client-ip.ts).
    const ip = rateLimitAddress(clientIp(c, trustProxy));
    const account = options.account ? await options.account(c) : null;
    // The account is normalized and hashed here; the store then HMACs the
    // whole key, so neither the IP nor the account is stored in clear.
    const key = account
      ? `${options.name}:${ip}|${crypto.createHash("sha256").update(account.trim().toLowerCase()).digest("hex")}`
      : `${options.name}:${ip}`;

    const now = store.now();
    const cached = blockedUntil.get(key);
    if (cached !== undefined) {
      if (cached > now) return tooMany(c, cached - now);
      blockedUntil.delete(key);
    }

    const { count, resetInMs } = await store.hit(key, options.windowMs);
    if (count > options.max) {
      remember(key, now + resetInMs);
      return tooMany(c, resetInMs);
    }

    await next();
  };
}
