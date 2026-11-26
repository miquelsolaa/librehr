import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { createRateLimiter } from "../src/middleware/rate-limit.js";
import {
  FailureLockout,
  PROVISIONAL_LOCK_MS,
} from "../src/lib/failure-lockout.js";
import {
  createPostgresRateLimitStore,
  rateLimitKeyHasher,
} from "../src/lib/rate-limit-store.js";
import type { Sql } from "postgres";
import { createApp } from "../src/app.js";
import { rateLimitAddress } from "../src/lib/client-ip.js";
import type { AuthPort } from "../src/ports/auth.js";
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
      if (text.startsWith("WITH up AS")) return [{ allowed: true }];
      return text.includes("INSERT INTO rate_limit_buckets") &&
        text.includes("RETURNING")
        ? [{ count: 3, resetInMs: 60_000 }]
        : [];
    });
    return { sql, params, texts };
  };
  const policy = { limit: 5, windowMs: 60_000, lockoutMs: 60_000 };

  it("sends only digests to the database, never the raw key", async () => {
    const { sql, params } = recording();
    const store = createPostgresRateLimitStore(sql, {
      secret: SECRET,
      now: () => 1_000,
    });
    const raw = "kiosk.pin:ip:org:198.51.100.23";
    await store.hit(raw, 60_000);
    await store.recordFailure([{ key: raw, limit: 5 }], policy);
    expect(await store.reserveAttempt(raw, policy)).toEqual({ allowed: true });
    await store.lockedFor([raw]);
    await store.reset(raw);

    const strings = JSON.stringify(params);
    expect(strings).not.toContain("198.51.100.23");
    expect(params).toContain(rateLimitKeyHasher(SECRET)(raw));
  });

  it("uses the database clock unless a test clock is injected", async () => {
    const real = recording();
    await createPostgresRateLimitStore(real.sql).hit("k", 60_000);
    expect(real.texts.join(" ")).toContain("statement_timestamp()");
    expect(real.params.some((p) => p instanceof Date)).toBe(false);

    const fake = recording();
    await createPostgresRateLimitStore(fake.sql, { now: () => 1_000 }).hit(
      "k",
      60_000,
    );
    expect(fake.texts.join(" ")).not.toContain("statement_timestamp()");
    expect(fake.params).toContainEqual(new Date(1_000));
  });

  it("returns the count and the time left in the window", async () => {
    const { sql } = recording();
    const store = createPostgresRateLimitStore(sql, { now: () => 1_000 });
    expect(await store.hit("k", 60_000)).toEqual({
      count: 3,
      resetInMs: 60_000,
    });
  });

  it("refuses to start without a secret when one is required", () => {
    const { sql } = recording();
    expect(() =>
      createPostgresRateLimitStore(sql, { requireSecret: true }),
    ).toThrow(/SESSION_SECRET/);
    expect(() =>
      createPostgresRateLimitStore(sql, { requireSecret: true, secret: "" }),
    ).toThrow(/SESSION_SECRET/);
    expect(() =>
      createPostgresRateLimitStore(sql, {
        requireSecret: true,
        secret: SECRET,
      }),
    ).not.toThrow();
  });

  it("sweeps at most once per interval and one sweep at a time", async () => {
    let release = () => {};
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    let sweeps = 0;
    const sql = (async (strings: TemplateStringsArray) => {
      const text = strings.join("?");
      if (text.includes("DELETE FROM rate_limit_buckets")) {
        sweeps++;
        await blocked;
        return Object.assign([], { count: 0 });
      }
      return text.includes("RETURNING") ? [{ count: 1, resetInMs: 1_000 }] : [];
    }) as unknown as Sql;
    let now = 0;
    const store = createPostgresRateLimitStore(sql, {
      now: () => now,
      sweepEveryMs: 60_000,
    });
    await store.hit("k", 1_000);
    expect(sweeps).toBe(1);
    now = 59_999;
    await store.hit("k", 1_000);
    expect(sweeps).toBe(1);
    // Due, but the first sweep is still running.
    now = 120_000;
    await store.hit("k", 1_000);
    expect(sweeps).toBe(1);
    release();
    await blocked;
    await new Promise((resolve) => setImmediate(resolve));
    now = 180_000;
    await store.hit("k", 1_000);
    expect(sweeps).toBe(2);
  });

  it("refuses the request when the database returns no bucket", async () => {
    const store = createPostgresRateLimitStore(scriptedSql(() => []));
    await expect(store.hit("k", 1_000)).rejects.toThrow(/no valid row/);
  });
});

describe("rateLimitAddress", () => {
  it("groups IPv6 clients by /64 and leaves IPv4 alone", () => {
    expect(rateLimitAddress("203.0.113.7")).toBe("203.0.113.7");
    expect(rateLimitAddress("unknown")).toBe("unknown");
    expect(rateLimitAddress("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(rateLimitAddress("2001:db8:1:2:aaaa::1")).toBe("2001:db8:1:2::/64");
    expect(rateLimitAddress("2001:DB8:1:2:ffff:ffff:ffff:ffff")).toBe(
      "2001:db8:1:2::/64",
    );
    expect(rateLimitAddress("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(rateLimitAddress("2001:db8::1:2:3:4:5")).toBe("2001:db8:0:1::/64");
    expect(rateLimitAddress("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
    expect(rateLimitAddress("::1")).toBe("0:0:0:0::/64");
    expect(rateLimitAddress("64:ff9b::203.0.113.7")).toBe("64:ff9b:0:0::/64");
  });

  it("keys IPv6 addresses that embed an IPv4 address on that IPv4 address", () => {
    // IPv4-mapped, in every spelling.
    expect(rateLimitAddress("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(rateLimitAddress("::FFFF:203.0.113.7")).toBe("203.0.113.7");
    expect(rateLimitAddress("::ffff:cb00:7107")).toBe("203.0.113.7");
    expect(rateLimitAddress("0:0:0:0:0:ffff:cb00:7107")).toBe("203.0.113.7");
    expect(rateLimitAddress("0000:0000:0000:0000:0000:ffff:203.0.113.7")).toBe(
      "203.0.113.7",
    );
    // IPv4-translated.
    expect(rateLimitAddress("::ffff:0:203.0.113.7")).toBe("203.0.113.7");
    expect(rateLimitAddress("::ffff:0:cb00:7107")).toBe("203.0.113.7");
    // Deprecated IPv4-compatible.
    expect(rateLimitAddress("::203.0.113.7")).toBe("203.0.113.7");
    expect(rateLimitAddress("::cb00:7107")).toBe("203.0.113.7");
    // Not embedded: loopback and unspecified stay IPv6.
    expect(rateLimitAddress("::1")).toBe("0:0:0:0::/64");
    expect(rateLimitAddress("::")).toBe("0:0:0:0::/64");
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

  it("evicts the oldest refused key when the refusal cache is full", async () => {
    const inner = memoryRateLimitStore();
    const asked: string[] = [];
    const app = new Hono();
    app.post(
      "/x",
      createRateLimiter({
        name: "test.evict",
        store: {
          ...inner,
          hit: (key, windowMs) => {
            asked.push(key);
            return inner.hit(key, windowMs);
          },
        },
        windowMs: 60_000,
        max: 0,
        trustProxy: 1,
        refusalCacheSize: 2,
      }),
      (c) => c.text("ok"),
    );
    const from = async (ip: string) =>
      (
        await app.request("/x", {
          method: "POST",
          headers: { "X-Forwarded-For": ip },
        })
      ).status;
    // max 0: every key is refused and cached; the cache holds two.
    for (const ip of ["192.0.2.1", "192.0.2.2", "192.0.2.3"]) {
      expect(await from(ip)).toBe(429);
    }
    asked.length = 0;
    // .2 and .3 are cached; .1 (the oldest) was evicted and asks again.
    expect(await from("192.0.2.2")).toBe(429);
    expect(await from("192.0.2.3")).toBe(429);
    expect(asked).toEqual([]);
    expect(await from("192.0.2.1")).toBe(429);
    expect(asked).toEqual(["test.evict:192.0.2.1"]);
  });

  it("refuses locally after a 429 until the window resets, without asking the store", async () => {
    let now = 0;
    const inner = memoryRateLimitStore(() => now);
    let hits = 0;
    const app = appWith({
      ...inner,
      hit: (key, windowMs) => {
        hits++;
        return inner.hit(key, windowMs);
      },
    });
    for (let i = 0; i < 3; i++) await post(app);
    expect(hits).toBe(3);
    now = 30_000;
    const cached = await post(app);
    expect(cached.status).toBe(429);
    expect(cached.headers.get("retry-after")).toBe("30");
    expect(hits).toBe(3);
    // Once the window has reset, the store decides again.
    now = 60_000;
    expect((await post(app)).status).toBe(200);
    expect(hits).toBe(4);
  });

  it("groups IPv6 clients by /64", async () => {
    const app = new Hono();
    app.post(
      "/x",
      createRateLimiter({
        name: "test.v6",
        store: memoryRateLimitStore(),
        windowMs: 60_000,
        max: 1,
        trustProxy: 1,
      }),
      (c) => c.text("ok"),
    );
    const from = (ip: string) =>
      app.request("/x", { method: "POST", headers: { "X-Forwarded-For": ip } });
    expect((await from("2001:db8:1:2::1")).status).toBe(200);
    expect((await from("2001:db8:1:2::ffff")).status).toBe(429);
    expect((await from("2001:db8:1:3::1")).status).toBe(200);
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

  it("reserves at most `limit` attempts, then refuses until the lockout ends", async () => {
    let now = 0;
    const store = memoryRateLimitStore(() => now);
    const lockout = new FailureLockout({ name: "auth.2fa", store, ...policy });
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await lockout.reserve("u1", 3));
    expect(results.map((r) => r.allowed)).toEqual([
      true,
      true,
      true,
      false,
      false,
    ]);
    expect(results[3]).toEqual({ allowed: false, lockedMs: 300_000 });
    now = 300_000;
    expect(await lockout.reserve("u1", 3)).toEqual({ allowed: true });
  });

  it("starts over after a successful attempt resets the key", async () => {
    const store = memoryRateLimitStore();
    const lockout = new FailureLockout({ name: "auth.2fa", store, ...policy });
    await lockout.reserve("u1", 3);
    await lockout.reserve("u1", 3);
    await lockout.reset("u1");
    for (let i = 0; i < 3; i++) {
      expect((await lockout.reserve("u1", 3)).allowed).toBe(true);
    }
    expect((await lockout.reserve("u1", 3)).allowed).toBe(false);
  });

  it("releases a reservation in its own namespace, lifting the lock it set (#178)", async () => {
    const store = memoryRateLimitStore();
    const pins = new FailureLockout({ name: "kiosk.pin", store, ...policy });
    const tfa = new FailureLockout({ name: "auth.2fa", store, ...policy });
    const setter = await pins.reserve("ip", 1);
    expect(setter).toEqual({ allowed: true, lockToken: expect.any(String) });
    await tfa.release("ip", 1, setter);
    expect(await pins.lockedFor(["ip"])).toBe(300_000);
    // A refused reservation carries no token: it cannot lift the lock.
    await pins.release("ip", 1, { allowed: false, lockedMs: 1 });
    expect(await pins.lockedFor(["ip"])).toBe(300_000);
    await pins.release("ip", 1, setter);
    expect(await pins.lockedFor(["ip"])).toBe(0);
  });

  it("keeps the Retry-After of a fresh, maybe provisional, lock short (#178)", () => {
    const lockout = new FailureLockout({
      name: "kiosk.pin",
      store: memoryRateLimitStore(),
      ...policy,
    });
    // Just set: at most PROVISIONAL_LOCK_MS.
    expect(lockout.retryAfterMs(300_000)).toBe(PROVISIONAL_LOCK_MS);
    expect(lockout.retryAfterMs(299_000)).toBe(PROVISIONAL_LOCK_MS - 1_000);
    // Older than PROVISIONAL_LOCK_MS: the full remaining time.
    expect(lockout.retryAfterMs(300_000 - PROVISIONAL_LOCK_MS)).toBe(
      300_000 - PROVISIONAL_LOCK_MS,
    );
    expect(lockout.retryAfterMs(60_000)).toBe(60_000);
    // A lock shorter than the grace is never lengthened.
    const brief = new FailureLockout({
      name: "kiosk.pin",
      store: memoryRateLimitStore(),
      failureWindowMs: 60_000,
      lockoutMs: 1_000,
    });
    expect(brief.retryAfterMs(800)).toBe(800);
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

describe("fail closed (issue #35)", () => {
  it("answers 500 on sign-in when the store fails, without checking credentials", async () => {
    let checked = false;
    const authPort: AuthPort = {
      async verifyCredentials() {
        checked = true;
        return null;
      },
      async createSession() {
        return null;
      },
      async getSession() {
        return null;
      },
      async revokeSession() {},
    };
    const broken = memoryRateLimitStore();
    const app = createApp({
      sql: scriptedSql(() => []),
      authPort,
      rateLimitStore: {
        ...broken,
        hit: () => Promise.reject(new Error("database unavailable")),
      },
    });
    const res = await app.request("/v1/auth/sign-in", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "nobody@example.invalid",
        password: "not-the-password",
      }),
    });
    expect(res.status).toBe(500);
    expect(checked).toBe(false);
  });

  it("keeps a reserved 2FA attempt counted when the check itself fails", async () => {
    // Accepted fail-closed risk: an attempt is reserved before it is
    // checked, so an error during the check still uses up the attempt.
    const user = {
      id: "00000000-0000-4000-8000-000000000001",
      email: "two-factor@example.invalid",
      name: "Two Factor",
    };
    const authPort: AuthPort = {
      async verifyCredentials() {
        return user;
      },
      async createSession() {
        return null;
      },
      async getSession() {
        return null;
      },
      async revokeSession() {},
    };
    const sql = scriptedSql((text) => {
      if (text.startsWith("UPDATE users")) {
        throw new Error("database unavailable");
      }
      return text.includes("FROM users")
        ? [
            {
              ...user,
              emailVerified: true,
              twoFactorEnabled: true,
              twoFactorSecret: "JBSWY3DPEHPK3PXP",
              twoFactorRecoveryCodes: [],
            },
          ]
        : [];
    });
    const app = createApp({
      sql,
      authPort,
      sessionSecret: "test-session-secret-with-at-least-32-chars",
      rateLimitStore: memoryRateLimitStore(),
      twoFactor: { lockout: { maxFailures: 1 } },
    });
    const signIn = () =>
      app.request("/v1/auth/sign-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: user.email,
          password: "a-password",
          twoFactorCode: "abcd-efgh",
        }),
      });
    expect((await signIn()).status).toBe(500);
    const next = await signIn();
    expect(next.status).toBe(429);
    expect(await next.json()).toMatchObject({ code: "TWO_FACTOR_LOCKED" });
  });

  it("refuses to build a production app without a session secret", () => {
    const authPort = {} as AuthPort;
    expect(() =>
      createApp({
        sql: scriptedSql(() => []),
        authPort,
        config: { nodeEnv: "production" },
      }),
    ).toThrow(/SESSION_SECRET/);
  });
});
