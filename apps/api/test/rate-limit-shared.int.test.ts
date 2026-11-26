import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createRoleSeparatedDatabase,
  getTestDatabase,
  type RoleSeparatedDatabase,
  type TestDatabase,
} from "@librehr/testing";
import { runMigrations } from "@librehr/db/migrate";
import { createApp } from "../src/app.js";
import { BetterAuthAdapter } from "../src/adapters/better-auth.js";
import { FailureLockout } from "../src/lib/failure-lockout.js";
import {
  createPostgresRateLimitStore,
  rateLimitKeyHasher,
} from "../src/lib/rate-limit-store.js";

// Issue #35: rate limits and lockouts are shared by every API replica on one
// database, expire, and are stored under keyed hashes only.
describe("shared rate limits across API instances (issue #35)", () => {
  let base: TestDatabase;
  let db: RoleSeparatedDatabase;
  const sessionSecret = crypto.randomBytes(32).toString("hex");

  /** One "replica": its own app and store, on the shared database. */
  const replica = (now?: () => number) =>
    createApp({
      sql: db.appSql,
      authPort: new BetterAuthAdapter(db.appSql),
      sessionSecret,
      trustProxy: 1,
      ...(now
        ? {
            rateLimitStore: createPostgresRateLimitStore(db.appSql, {
              secret: sessionSecret,
              now,
            }),
          }
        : {}),
    });
  const signIn = (
    app: ReturnType<typeof createApp>,
    ip: string,
    email: string,
  ) =>
    app.request("/v1/auth/sign-in", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
      body: JSON.stringify({ email, password: "not-the-password" }),
    });

  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database) throw new Error("Docker is required for rate-limit tests");
    base = database;
    db = await createRoleSeparatedDatabase(base);
    await runMigrations(db.ownerConnectionString);
  }, 60000);

  afterAll(async () => {
    if (db) await db.close();
    if (base) await base.close();
  });

  it("counts sign-in attempts against one budget on both instances", async () => {
    const a = replica();
    const b = replica();
    const ip = "203.0.113.21";
    const email = `${crypto.randomUUID()}@example.invalid`;
    const statuses: number[] = [];
    for (let i = 0; i < 10; i++) {
      statuses.push((await signIn(i % 2 ? b : a, ip, email)).status);
    }
    expect(statuses).toEqual(Array(10).fill(401));
    // The 11th attempt is refused on either instance.
    expect((await signIn(a, ip, email)).status).toBe(429);
    const res = await signIn(b, ip, email);
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ code: "RATE_LIMIT_EXCEEDED" });
  });

  it("opens a new window on every instance once the old one ends", async () => {
    let now = Date.parse("2026-06-01T10:00:00Z");
    const clock = () => now;
    const a = replica(clock);
    const b = replica(clock);
    const ip = "203.0.113.22";
    const email = `${crypto.randomUUID()}@example.invalid`;
    for (let i = 0; i < 10; i++) await signIn(a, ip, email);
    expect((await signIn(b, ip, email)).status).toBe(429);
    now += 60_000;
    expect((await signIn(b, ip, email)).status).toBe(401);
    expect((await signIn(a, ip, email)).status).toBe(401);
  });

  it("shares a lockout between instances until it expires", async () => {
    let now = Date.parse("2026-06-01T11:00:00Z");
    const lockout = () =>
      new FailureLockout({
        name: "auth.2fa",
        store: createPostgresRateLimitStore(db.appSql, {
          secret: sessionSecret,
          now: () => now,
        }),
        failureWindowMs: 15 * 60_000,
        lockoutMs: 15 * 60_000,
      });
    const a = lockout();
    const b = lockout();
    const user = `user:${crypto.randomUUID()}`;
    for (let i = 0; i < 5; i++) {
      await (i % 2 ? b : a).recordFailure([{ key: user, limit: 5 }]);
    }
    expect(await a.lockedFor([user])).toBe(15 * 60_000);
    expect(await b.lockedFor([user])).toBe(15 * 60_000);

    now += 15 * 60_000 - 1;
    expect(await b.lockedFor([user])).toBe(1);
    now += 1;
    expect(await a.lockedFor([user])).toBe(0);
    expect(await b.lockedFor([user])).toBe(0);
  });

  it("stores keyed hashes only, never the IP or the email", async () => {
    const ip = "198.51.100.77";
    const email = `hashed-${crypto.randomUUID()}@example.invalid`;
    await signIn(replica(), ip, email);

    const rows = await db.adminSql<{ key: string }[]>`
      SELECT key FROM rate_limit_buckets`;
    expect(rows.length).toBeGreaterThan(0);
    for (const { key } of rows) {
      expect(key).toMatch(/^[0-9a-f]{64}$/);
    }
    const dump = JSON.stringify(
      await db.adminSql`SELECT * FROM rate_limit_buckets`,
    );
    expect(dump).not.toContain(ip);
    expect(dump).not.toContain(email);
    // The per-IP sign-in bucket is the HMAC of its namespaced key.
    const expected = rateLimitKeyHasher(sessionSecret)(`auth.sign-in.ip:${ip}`);
    expect(rows.map((r) => r.key)).toContain(expected);
  });
});
