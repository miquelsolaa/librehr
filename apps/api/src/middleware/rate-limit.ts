import type { MiddlewareHandler } from "hono";
import { createProblemDetails } from "@librehr/contracts";

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

export function createRateLimiter(options: {
  windowMs: number;
  max: number;
}): MiddlewareHandler {
  const store = new Map<string, RateLimitRecord>();

  return async (c, next) => {
    const ip = c.req.header("x-forwarded-for") || "127.0.0.1";
    const now = Date.now();

    const record = store.get(ip);
    if (!record || record.resetAt <= now) {
      store.set(ip, { count: 1, resetAt: now + options.windowMs });
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
