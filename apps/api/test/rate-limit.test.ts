import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { createRateLimiter } from "../src/middleware/rate-limit.js";
import { FailureLockout } from "../src/lib/failure-lockout.js";
import {
  createPostgresRateLimitStore,
  rateLimitKeyHasher,
} from "../src/lib/rate-limit-store.js";
import { memoryRateLimitStore } from "./support/rate-limit.js";
import { scriptedSql } from "./support/scripted-sql.js";

const SECRET = "a-test-session-secret-with-at-least-32-chars";

describe("rate-limit key hashing (issue #35)", () => {
  it("is a keyed, deterministic 64-char hex digest", () => {
    const hash = rateLimitKeyHasher(SECRET);
    const key = "auth.sign-in.ip:203.0.113.7";
    expect(hash(key)).toMatch(/^[0-9a-f]{64}$/);
    expect(hash(key)).toBe(rateLimitKeyHasher(SECRET)(key));
    expect(hash(key)).not.toBe(rateLimitKeyHasher(`${SECRET}-other`)(key));
    expect(hash(key)).not.toBe(hash("auth.sign-in.ip:203.0.113.8"));
  });
});

describe("Postgres rate-limit store", () => {
  const recording = () => {
    const params: unknown[] = [];
    const texts: string[] = [];
    const sql = scriptedSql((text, p) => {
      texts.push(text);
      params.push(...p);
      return text.includes("INSERT INTO rate_limit_buckets") &&
        text.includes("RETURNING")
        ? [{ count: 3, resetAt: new Date(61_000) }]
        : [];
    });
    return { sql, params, texts };
  };

  it("sends only digests to the database, never the raw key", async () => {
    const { sql, params } = recording();
    const store = createPostgresRateLimitStore(sql, {
      secret: SECRET,
      now: () => 1_000,
    });
    const raw = "kiosk.pin:ip:org:198.51.100.23";
    await store.hit(raw, 60_000);
    await store.recordFailure([{ key: raw, limit: 5 }], {
      windowMs: 60_000,
      lockoutMs: 60_000,
    });
    await store.lockedFor([raw]);
    await store.reset(raw);

    const strings = JSON.stringify(params);
    expect(strings).not.toContain("198.51.100.23");
    expect(params).toContain(rateLimitKeyHasher(SECRET)(raw));
  });

  it("returns the count and the time left in the window", async () => {
    const { sql } = recording();
    const store = createPostgresRateLimitStore(sql, { now: () => 1_000 });
    expect(await store.hit("k", 60_000)).toEqual({
      count: 3,
      resetInMs: 60_000,
    });
  });

  it("sweeps expired buckets at most once per interval", async () => {
    const { sql, texts } = recording();
    let now = 0;
    const store = createPostgresRateLimitStore(sql, {
      now: () => now,
      sweepEveryMs: 60_000,
    });
    const sweeps = () =>
      texts.filter((t) =>
        t.startsWith("DELETE FROM rate_limit_buckets WHERE expires_at"),
      ).length;
    await store.hit("k", 1_000);
    await store.hit("k", 1_000);
    expect(sweeps()).toBe(1);
    now = 59_999;
    await store.hit("k", 1_000);
    expect(sweeps()).toBe(1);
    now = 60_000;
    await store.hit("k", 1_000);
    expect(sweeps()).toBe(2);
  });

  it("refuses the request when the database returns no bucket", async () => {
    const store = createPostgresRateLimitStore(scriptedSql(() => []));
    await expect(store.hit("k", 1_000)).rejects.toThrow(/no valid row/);
  });
});

describe("createRateLimiter", () => {
  const appWith = (store = memoryRateLimitStore(), max = 2) => {
    const app = new Hono();
    app.post(
      "/x",
      createRateLimiter({
        name: "test.x",
        store,
        windowMs: 60_000,
        max,
        account: async (c) => c.req.header("x-account") ?? null,
      }),
      (c) => c.text("ok"),
    );
    return app;
  };
  const post = (app: Hono, account?: string) =>
    app.request("/x", {
      method: "POST",
      headers: account ? { "x-account": account } : {},
    });

  it("answers 429 problem+json with Retry-After past the limit", async () => {
    const app = appWith();
    expect((await post(app)).status).toBe(200);
    expect((await post(app)).status).toBe(200);
    const res = await post(app);
    expect(res.status).toBe(429);
    expect(res.headers.get("content-type")).toContain(
      "application/problem+json",
    );
    expect(res.headers.get("retry-after")).toBe("60");
    expect(await res.json()).toMatchObject({ code: "RATE_LIMIT_EXCEEDED" });
  });

  it("keeps one bucket per account, case- and space-insensitive", async () => {
    const app = appWith(memoryRateLimitStore(), 1);
    expect((await post(app, "Ana@Example.invalid")).status).toBe(200);
    expect((await post(app, " ana@example.invalid ")).status).toBe(429);
    expect((await post(app, "bo@example.invalid")).status).toBe(200);
  });

  it("never hands the raw account to the store", async () => {
    const keys: string[] = [];
    const inner = memoryRateLimitStore();
    const app = appWith({
      ...inner,
      hit: (key, windowMs) => {
        keys.push(key);
        return inner.hit(key, windowMs);
      },
    });
    await post(app, "ana@example.invalid");
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^test\.x:/);
    expect(keys[0]).not.toContain("ana@example.invalid");
  });

  it("shares the budget between limiters on one store with the same name", async () => {
    const store = memoryRateLimitStore();
    const first = appWith(store);
    const second = appWith(store);
    expect((await post(first)).status).toBe(200);
    expect((await post(second)).status).toBe(200);
    expect((await post(first)).status).toBe(429);
  });
});

describe("FailureLockout", () => {
  const policy = { failureWindowMs: 60_000, lockoutMs: 300_000 };

  it("locks a key at its limit and namespaces keys per lockout", async () => {
    let now = 0;
    const store = memoryRateLimitStore(() => now);
    const pins = new FailureLockout({ name: "kiosk.pin", store, ...policy });
    const tfa = new FailureLockout({ name: "auth.2fa", store, ...policy });

    await pins.recordFailure([{ key: "u1", limit: 2 }]);
    expect(await pins.lockedFor(["u1"])).toBe(0);
    await pins.recordFailure([{ key: "u1", limit: 2 }]);
    expect(await pins.lockedFor(["u1"])).toBe(300_000);
    expect(await tfa.lockedFor(["u1"])).toBe(0);

    now = 300_000;
    expect(await pins.lockedFor(["u1"])).toBe(0);
  });

  it("clears failures on reset", async () => {
    const store = memoryRateLimitStore();
    const lockout = new FailureLockout({ name: "auth.2fa", store, ...policy });
    await lockout.recordFailure([{ key: "u1", limit: 2 }]);
    await lockout.reset("u1");
    await lockout.recordFailure([{ key: "u1", limit: 2 }]);
    expect(await lockout.lockedFor(["u1"])).toBe(0);
  });
});
