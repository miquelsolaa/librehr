import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
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
  const T0 = Date.parse("2026-03-29T00:59:00Z");
  const policy = { limit: 3, windowMs: 60_000, lockoutMs: 300_000 };

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

  it("is a global table: no organization_id, writable by the runtime role", async () => {
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
    const k = key();
    expect((await repo.hit(db.appSql, k, T0, 60_000)).count).toBe(1);
  });

  it("refuses a raw (unhashed) key", async () => {
    await expect(
      repo.hit(db.appSql, "ip:203.0.113.7", T0, 60_000),
    ).rejects.toThrow(/rate_limit_buckets_key_digest/);
  });

  it("counts in a fixed window that restarts once it has ended", async () => {
    const k = key();
    expect(await repo.hit(db.appSql, k, T0, 60_000)).toEqual({
      count: 1,
      resetAt: new Date(T0 + 60_000),
    });
    expect((await repo.hit(db.appSql, k, T0 + 59_999, 60_000)).count).toBe(2);
    // The window ends at T0 + 60 s exactly.
    expect(await repo.hit(db.appSql, k, T0 + 60_000, 60_000)).toEqual({
      count: 1,
      resetAt: new Date(T0 + 120_000),
    });
  });

  it("never loses a count under concurrent hits", async () => {
    const k = key();
    await Promise.all(
      Array.from({ length: 40 }, () => repo.hit(db.appSql, k, T0, 60_000)),
    );
    expect((await repo.hit(db.appSql, k, T0, 60_000)).count).toBe(41);
  });

  it("locks a key at the failure limit until the lockout ends", async () => {
    const k = key();
    await repo.recordFailure(db.appSql, k, T0, policy);
    await repo.recordFailure(db.appSql, k, T0 + 1_000, policy);
    expect(await repo.lockedUntil(db.appSql, [k], T0 + 1_000)).toBeNull();
    await repo.recordFailure(db.appSql, k, T0 + 2_000, policy);
    expect(await repo.lockedUntil(db.appSql, [k], T0 + 2_000)).toEqual(
      new Date(T0 + 302_000),
    );
    expect(await repo.lockedUntil(db.appSql, [k], T0 + 302_000)).toBeNull();
  });

  it("forgets failures older than the window", async () => {
    const k = key();
    await repo.recordFailure(db.appSql, k, T0, policy);
    await repo.recordFailure(db.appSql, k, T0 + 1_000, policy);
    // More than 60 s after the window opened: the first two no longer count,
    // so this third failure does not lock.
    await repo.recordFailure(db.appSql, k, T0 + 60_001, policy);
    expect(await repo.lockedUntil(db.appSql, [k], T0 + 60_001)).toBeNull();
    await repo.recordFailure(db.appSql, k, T0 + 60_002, policy);
    await repo.recordFailure(db.appSql, k, T0 + 60_003, policy);
    expect(await repo.lockedUntil(db.appSql, [k], T0 + 60_003)).not.toBeNull();
  });

  it("still counts a failure exactly windowMs after the window opened", async () => {
    const k = key();
    await repo.recordFailure(db.appSql, k, T0, policy);
    await repo.recordFailure(db.appSql, k, T0 + 1_000, policy);
    await repo.recordFailure(db.appSql, k, T0 + 60_000, policy);
    expect(await repo.lockedUntil(db.appSql, [k], T0 + 60_000)).toEqual(
      new Date(T0 + 360_000),
    );
  });

  it("keeps a lockout longer than the window through a sweep", async () => {
    const k = key();
    await repo.recordFailure(db.appSql, k, T0, { ...policy, limit: 1 });
    await repo.deleteExpired(db.appSql, T0 + 120_000);
    expect(await repo.lockedUntil(db.appSql, [k], T0 + 120_000)).toEqual(
      new Date(T0 + 300_000),
    );
  });

  it("locks on the first failure with a limit of 1, and reports the latest lock", async () => {
    const a = key();
    const b = key();
    await repo.recordFailure(db.appSql, a, T0, { ...policy, limit: 1 });
    await repo.recordFailure(db.appSql, b, T0 + 5_000, { ...policy, limit: 1 });
    expect(await repo.lockedUntil(db.appSql, [a, b], T0 + 5_000)).toEqual(
      new Date(T0 + 305_000),
    );
  });

  it("clears a key on remove", async () => {
    const k = key();
    await repo.recordFailure(db.appSql, k, T0, { ...policy, limit: 1 });
    await repo.remove(db.appSql, k);
    expect(await repo.lockedUntil(db.appSql, [k], T0)).toBeNull();
  });

  it("deletes expired buckets only", async () => {
    const live = key();
    const locked = key();
    const old = key();
    const later = T0 + 3_600_000;
    await repo.hit(db.appSql, old, T0, 60_000);
    await repo.recordFailure(db.appSql, locked, later - 1_000, {
      ...policy,
      limit: 1,
    });
    await repo.hit(db.appSql, live, later, 60_000);
    await repo.deleteExpired(db.appSql, later);
    const rows = await db.adminSql<{ key: string }[]>`
      SELECT key FROM rate_limit_buckets
      WHERE key IN (${live}, ${locked}, ${old})`;
    expect(rows.map((r) => r.key).sort()).toEqual([live, locked].sort());
  });
});
