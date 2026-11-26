import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  APP_ROLE,
  createRoleSeparatedDatabase,
  getTestDatabase,
  type RoleSeparatedDatabase,
  type TestDatabase,
} from "@librehr/testing";
import { runMigrations } from "../src/migrate.js";
import { RateLimitRepository } from "../src/repositories/rate-limit.repository.js";

// Issue #35: shared rate-limit and lockout buckets (migration 0038), used by
// the runtime role without a tenant context.
describe("rate_limit_buckets (0038)", () => {
  let base: TestDatabase;
  let db: RoleSeparatedDatabase;
  const repo = new RateLimitRepository();
  const key = () => crypto.randomBytes(32).toString("hex");
  // Far in the future, so no sweep on the real clock ever touches these rows.
  const T0 = Date.parse("2099-03-29T00:59:00Z");
  const policy = { limit: 3, windowMs: 60_000, lockoutMs: 300_000 };
  const row = async (k: string) => {
    const [r] = await db.adminSql<{ count: number; locked: boolean }[]>`
      SELECT count, locked_until IS NOT NULL AS locked
      FROM rate_limit_buckets WHERE key = ${k}`;
    return r;
  };

  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database) throw new Error("Docker is required for role tests");
    base = database;
    db = await createRoleSeparatedDatabase(base);
    await runMigrations(db.ownerConnectionString);
  }, 60000);

  afterAll(async () => {
    if (db) await db.close();
    if (base) await base.close();
  });

  it("is a global table: no organization_id, fillfactor 70, usable by the runtime role", async () => {
    const columns = await db.adminSql<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'rate_limit_buckets' ORDER BY ordinal_position`;
    expect(columns.map((c) => c.column_name)).toEqual([
      "key",
      "window_start",
      "count",
      "locked_until",
      "expires_at",
    ]);
    const [table] = await db.adminSql<
      { options: string[] | null; persistence: string; rls: boolean }[]
    >`
      SELECT reloptions AS options, relpersistence AS persistence,
             relrowsecurity AS rls
      FROM pg_class WHERE relname = 'rate_limit_buckets'`;
    expect(table).toEqual({
      options: ["fillfactor=70"],
      persistence: "p",
      rls: false,
    });
    const [grants] = await db.adminSql<Record<string, boolean>[]>`
      SELECT
        has_table_privilege(${APP_ROLE}, 'rate_limit_buckets', 'SELECT') AS s,
        has_table_privilege(${APP_ROLE}, 'rate_limit_buckets', 'INSERT') AS i,
        has_table_privilege(${APP_ROLE}, 'rate_limit_buckets', 'UPDATE') AS u,
        has_table_privilege(${APP_ROLE}, 'rate_limit_buckets', 'DELETE') AS d`;
    expect(grants).toEqual({ s: true, i: true, u: true, d: true });

    // Every operation as the runtime role, on the database clock.
    const k = key();
    expect(await repo.hit(db.appSql, k, 60_000)).toMatchObject({ count: 1 });
    await repo.recordFailure(db.appSql, k, { ...policy, limit: 1 });
    expect(await repo.lockedForMs(db.appSql, [k])).toBeGreaterThan(0);
    expect(await repo.reserveAttempt(db.appSql, k, policy)).toMatchObject({
      allowed: false,
    });
    await repo.remove(db.appSql, k);
    expect(await repo.deleteExpired(db.appSql)).toBeGreaterThanOrEqual(0);
  });

  it("refuses a raw (unhashed) key", async () => {
    await expect(
      repo.hit(db.appSql, "ip:203.0.113.7", 60_000, T0),
    ).rejects.toThrow(/rate_limit_buckets_key_digest/);
  });

  it("counts in a fixed window that restarts once it has ended", async () => {
    const k = key();
    expect(await repo.hit(db.appSql, k, 60_000, T0)).toEqual({
      count: 1,
      resetInMs: 60_000,
    });
    expect(await repo.hit(db.appSql, k, 60_000, T0 + 59_999)).toEqual({
      count: 2,
      resetInMs: 1,
    });
    // The window ends at T0 + 60 s exactly.
    expect(await repo.hit(db.appSql, k, 60_000, T0 + 60_000)).toEqual({
      count: 1,
      resetInMs: 60_000,
    });
  });

  it("never loses a count under concurrent hits", async () => {
    const k = key();
    await Promise.all(
      Array.from({ length: 40 }, () => repo.hit(db.appSql, k, 60_000, T0)),
    );
    expect((await repo.hit(db.appSql, k, 60_000, T0)).count).toBe(41);
  });

  it("locks a key at the failure limit until the lockout ends", async () => {
    const k = key();
    await repo.recordFailure(db.appSql, k, policy, T0);
    await repo.recordFailure(db.appSql, k, policy, T0 + 1_000);
    expect(await repo.lockedForMs(db.appSql, [k], T0 + 1_000)).toBe(0);
    await repo.recordFailure(db.appSql, k, policy, T0 + 2_000);
    expect(await repo.lockedForMs(db.appSql, [k], T0 + 2_000)).toBe(300_000);
    expect(await repo.lockedForMs(db.appSql, [k], T0 + 301_999)).toBe(1);
    expect(await repo.lockedForMs(db.appSql, [k], T0 + 302_000)).toBe(0);
  });

  it("keeps the count and lock consistent under 40 concurrent failures", async () => {
    const k = key();
    await Promise.all(
      Array.from({ length: 40 }, () =>
        repo.recordFailure(db.appSql, k, { ...policy, limit: 5 }, T0),
      ),
    );
    // Serialized upserts: every 5th failure locks and restarts the count.
    expect(await row(k)).toEqual({ count: 0, locked: true });
    expect(await repo.lockedForMs(db.appSql, [k], T0)).toBe(300_000);
  });

  it("forgets failures older than the window", async () => {
    const k = key();
    await repo.recordFailure(db.appSql, k, policy, T0);
    await repo.recordFailure(db.appSql, k, policy, T0 + 1_000);
    // More than 60 s after the window opened: the first two no longer count,
    // so this third failure does not lock.
    await repo.recordFailure(db.appSql, k, policy, T0 + 60_001);
    expect(await repo.lockedForMs(db.appSql, [k], T0 + 60_001)).toBe(0);
    await repo.recordFailure(db.appSql, k, policy, T0 + 60_002);
    await repo.recordFailure(db.appSql, k, policy, T0 + 60_003);
    expect(await repo.lockedForMs(db.appSql, [k], T0 + 60_003)).toBe(300_000);
  });

  it("still counts a failure exactly windowMs after the window opened", async () => {
    const k = key();
    await repo.recordFailure(db.appSql, k, policy, T0);
    await repo.recordFailure(db.appSql, k, policy, T0 + 1_000);
    await repo.recordFailure(db.appSql, k, policy, T0 + 60_000);
    expect(await repo.lockedForMs(db.appSql, [k], T0 + 60_000)).toBe(300_000);
  });

  it("locks on the first failure with a limit of 1, and reports the latest lock", async () => {
    const a = key();
    const b = key();
    await repo.recordFailure(db.appSql, a, { ...policy, limit: 1 }, T0);
    await repo.recordFailure(db.appSql, b, { ...policy, limit: 1 }, T0 + 5_000);
    expect(await repo.lockedForMs(db.appSql, [a, b], T0 + 5_000)).toBe(300_000);
  });

  it("allows at most `limit` concurrent reservations, then refuses until the lock ends", async () => {
    const k = key();
    const results = await Promise.all(
      Array.from({ length: 25 }, () =>
        repo.reserveAttempt(db.appSql, k, { ...policy, limit: 5 }, T0),
      ),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(5);
    for (const r of results.filter((r) => !r.allowed)) {
      expect(r).toEqual({ allowed: false, lockedMs: expect.any(Number) });
    }
    expect(
      await repo.reserveAttempt(db.appSql, k, policy, T0 + 299_000),
    ).toEqual({ allowed: false, lockedMs: 1_000 });
    expect(
      await repo.reserveAttempt(db.appSql, k, policy, T0 + 300_000),
    ).toEqual({ allowed: true });
  });

  it("clears reservations when a successful attempt removes the key", async () => {
    const k = key();
    for (let i = 0; i < 2; i++) {
      await repo.reserveAttempt(db.appSql, k, policy, T0);
    }
    await repo.remove(db.appSql, k);
    for (let i = 0; i < 3; i++) {
      expect(await repo.reserveAttempt(db.appSql, k, policy, T0)).toEqual({
        allowed: true,
      });
    }
    expect((await repo.reserveAttempt(db.appSql, k, policy, T0)).allowed).toBe(
      false,
    );
  });

  it("keeps a lockout longer than the window through a sweep", async () => {
    const k = key();
    await repo.recordFailure(db.appSql, k, { ...policy, limit: 1 }, T0);
    await repo.deleteExpired(db.appSql, { nowMs: T0 + 120_000 });
    expect(await repo.lockedForMs(db.appSql, [k], T0 + 120_000)).toBe(180_000);
  });

  it("never loses a window restarted while a sweep runs at the expiry boundary", async () => {
    const t = T0 + 10_000_000;
    const keys = Array.from({ length: 30 }, key);
    for (const k of keys) await repo.hit(db.appSql, k, 60_000, t);
    // At t + 60 001 every bucket has expired: hits restart them while sweeps
    // delete expired rows.
    const at = t + 60_001;
    await Promise.all([
      ...keys.map((k) => repo.hit(db.appSql, k, 60_000, at)),
      repo.deleteExpired(db.appSql, { nowMs: at, batch: 7 }),
      repo.deleteExpired(db.appSql, { nowMs: at, batch: 7 }),
    ]);
    // Either the sweep came first and the hit inserted a new row, or the hit
    // restarted the row and the sweep skipped it: one fresh row per key.
    const rows = await db.adminSql<{ count: number }[]>`
      SELECT count FROM rate_limit_buckets WHERE key = ANY(${keys}::text[])`;
    expect(rows.map((r) => r.count)).toEqual(keys.map(() => 1));
  });

  it("deletes expired buckets in batches until none are left", async () => {
    const t = T0 + 20_000_000;
    const old = Array.from({ length: 25 }, key);
    const live = key();
    for (const k of old) await repo.hit(db.appSql, k, 1_000, t);
    await repo.hit(db.appSql, live, 600_000, t);
    const deleted = await repo.deleteExpired(db.appSql, {
      nowMs: t + 2_000,
      batch: 10,
    });
    expect(deleted).toBeGreaterThanOrEqual(25);
    const rows = await db.adminSql<{ key: string }[]>`
      SELECT key FROM rate_limit_buckets WHERE key = ANY(${[...old, live]}::text[])`;
    expect(rows.map((r) => r.key)).toEqual([live]);
  });
});
