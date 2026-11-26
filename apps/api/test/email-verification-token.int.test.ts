import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createRoleSeparatedDatabase,
  getTestDatabase,
  type RoleSeparatedDatabase,
  type TestDatabase,
} from "@librehr/testing";
import { hashBearerToken } from "@librehr/db";
import { runMigrations } from "@librehr/db/migrate";
import { hashPassword } from "../src/lib/password.js";
import {
  createEmailVerificationToken,
  verifyEmailWithToken,
} from "../src/lib/email-verification.js";

// AUTH-001: creating and confirming verification links as the restricted
// runtime role. The endpoints that use these arrive in a later change.
describe("email verification tokens (AUTH-001)", () => {
  let base: TestDatabase;
  let db: RoleSeparatedDatabase;

  const user = "c9440000-0000-0000-0000-000000000001";
  const capped = "c9440000-0000-0000-0000-000000000002";
  const done = "c9440000-0000-0000-0000-000000000003";
  const sso = "c9440000-0000-0000-0000-000000000004";
  const emailOf = (id: string) => `${id.slice(-1)}-token@example.invalid`;
  const password = "token-password-123";
  const verified = async (id: string) => {
    const [row] = await db.adminSql<{ v: boolean }[]>`
      SELECT email_verified AS v FROM users WHERE id = ${id}`;
    return row!.v;
  };

  const tokens = (userId: string) =>
    db.adminSql<{ email: string; used: boolean; ttl_hours: number }[]>`
      SELECT email, used_at IS NOT NULL AS used,
        round(extract(epoch FROM expires_at - created_at) / 3600)::int
          AS ttl_hours
      FROM email_verification_tokens
      WHERE user_id = ${userId} ORDER BY created_at, id`;

  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database) throw new Error("Docker is required for auth tests");
    base = database;
    db = await createRoleSeparatedDatabase(base);
    await runMigrations(db.ownerConnectionString);
    const hash = await hashPassword(password);
    await db.adminSql`
      INSERT INTO users (id, email, name, email_verified, password_hash)
      VALUES (${user}, ${emailOf(user)}, 'Token User', false, ${hash}),
        (${capped}, ${emailOf(capped)}, 'Capped User', false, ${hash}),
        (${done}, ${emailOf(done)}, 'Verified User', true, ${hash}),
        (${sso}, ${emailOf(sso)}, 'SSO User', false, NULL)`;
  }, 60000);

  afterAll(async () => {
    if (db) await db.close();
    if (base) await base.close();
  });

  it("binds a 24 h link to the account's address and spends earlier links", async () => {
    const first = await createEmailVerificationToken(db.appSql, user);
    expect(first).toMatchObject({ email: emailOf(user) });
    const second = await createEmailVerificationToken(db.appSql, user, {
      ttlMs: 2 * 60 * 60 * 1000,
    });
    expect(second).not.toBeNull();

    const rows = await tokens(user);
    expect(rows).toEqual([
      { email: emailOf(user), used: true, ttl_hours: 24 },
      { email: emailOf(user), used: false, ttl_hours: 2 },
    ]);
    const [stored] = await db.adminSql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM email_verification_tokens
      WHERE token_hash = ${hashBearerToken(second!.token)}`;
    expect(stored!.count).toBe(1);

    expect(
      await verifyEmailWithToken(db.appSql, first!.token, password),
    ).toEqual({ status: "invalid_token" });
    expect(
      await verifyEmailWithToken(db.appSql, second!.token, password),
    ).toEqual({ status: "verified", userId: user });
    expect(
      await verifyEmailWithToken(db.appSql, second!.token, password),
    ).toEqual({ status: "invalid_token" });
  });

  it("needs the account password, and a wrong one spends nothing", async () => {
    await db.adminSql`UPDATE users SET email_verified = false
      WHERE id = ${user}`;
    const link = await createEmailVerificationToken(db.appSql, user);
    expect(
      await verifyEmailWithToken(db.appSql, link!.token, "not-the-password"),
    ).toEqual({ status: "invalid_password" });
    expect(await verified(user)).toBe(false);
    expect(
      await verifyEmailWithToken(db.appSql, link!.token, password),
    ).toEqual({ status: "verified", userId: user });
    expect(await verified(user)).toBe(true);
  });

  it("refuses an account without a password", async () => {
    const link = await createEmailVerificationToken(db.appSql, sso);
    expect(
      await verifyEmailWithToken(db.appSql, link!.token, password),
    ).toEqual({ status: "invalid_password" });
    expect(await verified(sso)).toBe(false);
  });

  it("creates nothing for a verified or unknown account", async () => {
    expect(await createEmailVerificationToken(db.appSql, done)).toBeNull();
    expect(
      await createEmailVerificationToken(
        db.appSql,
        "c9440000-0000-0000-0000-0000000000ff",
      ),
    ).toBeNull();
    expect(await tokens(done)).toEqual([]);
  });

  it("caps links per account per hour in the database", async () => {
    for (let i = 0; i < 3; i++) {
      expect(
        await createEmailVerificationToken(db.appSql, capped),
      ).not.toBeNull();
    }
    expect(await createEmailVerificationToken(db.appSql, capped)).toBeNull();
    expect(await tokens(capped)).toHaveLength(3);
  });

  it("deletes links older than 30 days on every request", async () => {
    await db.adminSql`
      INSERT INTO email_verification_tokens
        (user_id, email, token_hash, expires_at, created_at)
      VALUES (${done}, ${emailOf(done)}, 'stale-hash',
        now() - interval '30 days', now() - interval '31 days')`;
    await createEmailVerificationToken(db.appSql, done);
    expect(await tokens(done)).toEqual([]);
  });

  it("rejects a non-positive lifetime", async () => {
    await expect(
      createEmailVerificationToken(db.appSql, user, { ttlMs: 0 }),
    ).rejects.toThrow(RangeError);
  });
});
