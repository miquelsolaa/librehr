import crypto from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";
import { createProblemDetails } from "@librehr/contracts";
import { clientIp } from "../lib/client-ip.js";

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

export interface RateLimiterOptions {
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
}

// Expired buckets are swept once the store grows past this many entries.
const SWEEP_THRESHOLD = 10_000;

/**
 * Fixed-window, in-memory rate limiter.
 *
 * Limitation: the counters live in this process only. With several API
 * replicas each one keeps its own buckets, so the effective limit is
 * multiplied by the replica count. LibreHR's supported deployment is a single
 * API instance (docs/guides/self-hosting.md); a shared store is needed before
 * scaling out.
 */
export function createRateLimiter(
  options: RateLimiterOptions,
): MiddlewareHandler {
  const store = new Map<string, RateLimitRecord>();
  const trustProxy = options.trustProxy ?? 0;

  return async (c, next) => {
    const ip = clientIp(c, trustProxy);
    const account = options.account ? await options.account(c) : null;
    // Hash the account so emails never sit in memory dumps in clear text.
    const key = account
      ? `${ip}|${crypto.createHash("sha256").update(account.trim().toLowerCase()).digest("hex")}`
      : ip;
    const now = Date.now();

    if (store.size > SWEEP_THRESHOLD) {
      for (const [k, record] of store) {
        if (record.resetAt <= now) store.delete(k);
      }
    }

    const record = store.get(key);
    if (!record || record.resetAt <= now) {
      store.set(key, { count: 1, resetAt: now + options.windowMs });
    } else {
      record.count++;
      if (record.count > options.max) {
        const problem = createProblemDetails({
          status: 429,
          title: "Too Many Requests",
          detail: "Rate limit exceeded. Please wait before retrying.",
          code: "RATE_LIMIT_EXCEEDED",
        });
        return c.json(problem, 429, {
          "Content-Type": "application/problem+json",
          "Retry-After": Math.ceil((record.resetAt - now) / 1000).toString(),
        });
      }
    }

    await next();
  };
}
