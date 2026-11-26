import crypto from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";
import { createProblemDetails } from "@librehr/contracts";
import { clientIp } from "../lib/client-ip.js";
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
}

/**
 * Fixed-window rate limiter. Counters live in the shared store (Postgres in
 * production), so every API replica draws on the same budget per client.
 */
export function createRateLimiter(
  options: RateLimiterOptions,
): MiddlewareHandler {
  const trustProxy = options.trustProxy ?? 0;

  return async (c, next) => {
    const ip = clientIp(c, trustProxy);
    const account = options.account ? await options.account(c) : null;
    // The account is normalized and hashed here; the store then HMACs the
    // whole key, so neither the IP nor the account is stored in clear.
    const key = account
      ? `${options.name}:${ip}|${crypto.createHash("sha256").update(account.trim().toLowerCase()).digest("hex")}`
      : `${options.name}:${ip}`;

    const { count, resetInMs } = await options.store.hit(key, options.windowMs);
    if (count > options.max) {
      const problem = createProblemDetails({
        status: 429,
        title: "Too Many Requests",
        detail: "Rate limit exceeded. Please wait before retrying.",
        code: "RATE_LIMIT_EXCEEDED",
      });
      return c.json(problem, 429, {
        "Content-Type": "application/problem+json",
        "Retry-After": Math.ceil(resetInMs / 1000).toString(),
      });
    }

    await next();
  };
}
