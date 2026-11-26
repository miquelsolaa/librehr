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
import { withTenant } from "../src/with-tenant.js";
import { hashBearerToken } from "../src/crypto/token-hash.js";

// AUTH-001: email verification links (migration 0043). The confirm function
// runs as the restricted runtime role, without a session or tenant context.
describe("email_verification_tokens and librehr_auth_verify_email (0043)", () => {
  let base: TestDatabase;
  let db: RoleSeparatedDatabase;

  const orgA = "a9430000-0000-0000-0000-00000000000a";
  const orgB = "a9430000-0000-0000-0000-00000000000b";
  const orgC = "a9430000-0000-0000-0000-00000000000c";
  const user = "c9430000-0000-0000-0000-000000000001";
  const other = "c9430000-0000-0000-0000-000000000002";
  const emailOf = (id: string) => `${id.slice(-1)}-verify@example.invalid`;

  /** Inserts a token for `userId` as the admin; returns the raw token. */
  const issue = async (
    userId: string,
    opts: { email?: string; expiresIn?: string } = {},
  ) => {
    const token = crypto.randomBytes(32).toString("base64url");
    await db.adminSql`
      INSERT INTO email_verification_tokens
        (user_id, email, token_hash, expires_at)
      VALUES (${userId}, ${opts.email ?? emailOf(userId)},
        ${hashBearerToken(token)},
        now() + ${opts.expiresIn ?? "1 day"}::interval)`;
    return token;
  };
  const verify = async (token: string) => {
    const [row] = await db.appSql<{ userId: string | null }[]>`
      SELECT librehr_auth_verify_email(${hashBearerToken(token)}) AS "userId"`;
    return row!.userId;
  };
  const verified = async (userId: string) => {
    const [row] = await db.adminSql<{ v: boolean }[]>`
      SELECT email_verified AS v FROM users WHERE id = ${userId}`;
    return row!.v;
  };
  const reset = (userId: string) =>
    db.adminSql`UPDATE users SET email_verified = false WHERE id = ${userId}`;

  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database) throw new Error("Docker is required for role tests");
    base = database;
    db = await createRoleSeparatedDatabase(base);
    await runMigrations(db.ownerConnectionString);

    const sql = db.adminSql;
    await sql`INSERT INTO organizations (id, name, slug, timezone) VALUES
      (${orgA}, 'Verify A', 'verify-a', 'Europe/Madrid'),
      (${orgB}, 'Verify B', 'verify-b', 'Europe/Madrid'),
      (${orgC}, 'Verify C', 'verify-c', 'Europe/Madrid')`;
    await sql`INSERT INTO users (id, email, name) VALUES
      (${user}, ${emailOf(user)}, 'Verify User'),
      (${other}, ${emailOf(other)}, 'Other User')`;
    for (const [org, ids] of [
      [orgA, [user]],
      [orgB, [user]],
      [orgC, [other]],
    ] as const) {
      await withTenant(sql, { organizationId: org }, async (tx) => {
        for (const id of ids) {
          await tx`INSERT INTO memberships (organization_id, user_id, role)
            VALUES (${org}, ${id}, 'employee')`;
        }
      });
    }
  }, 60000);

  afterAll(async () => {
    if (db) await db.close();
    if (base) await base.close();
  });

  it("is a global table usable by the runtime role, and the function is hardened", async () => {
    const [table] = await db.adminSql<{ rls: boolean }[]>`
      SELECT relrowsecurity AS rls FROM pg_class
      WHERE relname = 'email_verification_tokens'`;
    expect(table).toEqual({ rls: false });
    const [grants] = await db.adminSql<Record<string, boolean>[]>`
      SELECT
        has_table_privilege(${APP_ROLE}, 'email_verification_tokens', 'SELECT') AS s,
        has_table_privilege(${APP_ROLE}, 'email_verification_tokens', 'INSERT') AS i,
        has_table_privilege(${APP_ROLE}, 'email_verification_tokens', 'UPDATE') AS u,
        has_table_privilege(${APP_ROLE}, 'email_verification_tokens', 'DELETE') AS d,
        has_table_privilege(${APP_ROLE}, 'email_verification_tokens', 'TRUNCATE') AS t`;
    expect(grants).toEqual({ s: true, i: true, u: true, d: true, t: false });

    const [fn] = await db.adminSql<
      {
        prosecdef: boolean;
        proconfig: string[] | null;
        public_exec: boolean;
        app_exec: boolean;
      }[]
    >`
      SELECT p.prosecdef, p.proconfig,
             has_function_privilege('public', p.oid, 'EXECUTE') AS public_exec,
             has_function_privilege(${APP_ROLE}, p.oid, 'EXECUTE') AS app_exec
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'librehr_auth_verify_email'`;
    expect(fn).toMatchObject({
      prosecdef: true,
      public_exec: false,
      app_exec: true,
    });
    expect(fn!.proconfig).toContain("search_path=pg_catalog, public");
  });

  it("verifies once, spends every other link and audits each of the user's organizations", async () => {
    await reset(user);
    const earlier = await issue(user);
    const token = await issue(user);
    expect(await verify(token)).toBe(user);
    expect(await verified(user)).toBe(true);

    // Single use, and the user's other unused link is spent too.
    expect(await verify(token)).toBeNull();
    await reset(user);
    expect(await verify(earlier)).toBeNull();
    expect(await verified(user)).toBe(false);

    const audit = await db.adminSql<
      { organization_id: string; actor_id: string; metadata: unknown }[]
    >`SELECT organization_id, actor_id, metadata FROM audit_log
      WHERE action = 'auth.email_verified' AND resource_id = ${user}
      ORDER BY organization_id`;
    expect(audit.map((a) => a.organization_id)).toEqual([orgA, orgB]);
    expect(audit.every((a) => a.actor_id === user)).toBe(true);
    // Ids only: the address never reaches the audit log.
    expect(JSON.stringify(audit)).not.toContain("verify@example.invalid");
  });

  it("writes nothing into an organization the user does not belong to", async () => {
    await reset(user);
    expect(await verify(await issue(user))).toBe(user);
    const [row] = await db.adminSql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM audit_log
      WHERE organization_id = ${orgC} AND action = 'auth.email_verified'`;
    expect(row!.count).toBe(0);
    // The runtime role sees the entry in org A, and not from org C.
    const visibleIn = (organizationId: string, userId: string) =>
      withTenant(
        db.appSql,
        { organizationId, userId },
        (tx) => tx<{ id: string }[]>`
          SELECT id FROM audit_log
          WHERE resource_id = ${user} AND action = 'auth.email_verified'`,
      );
    expect((await visibleIn(orgA, user)).length).toBeGreaterThan(0);
    expect(await visibleIn(orgC, other)).toEqual([]);
  });

  it("refuses an expired link", async () => {
    await reset(user);
    expect(
      await verify(await issue(user, { expiresIn: "-1 second" })),
    ).toBeNull();
    expect(await verified(user)).toBe(false);
  });

  it("refuses a link sent to an address that is no longer the account's email", async () => {
    await reset(user);
    const token = await issue(user, { email: "old-verify@example.invalid" });
    expect(await verify(token)).toBeNull();
    expect(await verified(user)).toBe(false);
  });

  it("refuses an unknown token or NULL, and restores the caller's settings", async () => {
    expect(await verify("guessed")).toBeNull();
    const [nul] = await db.appSql<{ userId: string | null }[]>`
      SELECT librehr_auth_verify_email(NULL) AS "userId"`;
    expect(nul!.userId).toBeNull();

    await reset(other);
    const token = await issue(other);
    const settings = await db.appSql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_org', ${orgC}, true)`;
      await tx`SELECT librehr_auth_verify_email(${hashBearerToken(token)})`;
      const [row] = await tx<{ org: string; lookup: string | null }[]>`
        SELECT current_setting('app.current_org', true) AS org,
               current_setting('librehr.identity_lookup', true) AS lookup`;
      return row;
    });
    expect(settings).toEqual({ org: orgC, lookup: "" });
    expect(await verified(other)).toBe(true);
  });
});
