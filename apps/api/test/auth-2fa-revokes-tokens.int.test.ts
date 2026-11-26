import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createRoleSeparatedDatabase,
  getTestDatabase,
  type RoleSeparatedDatabase,
  type TestDatabase,
} from "@librehr/testing";
import { TokenRepository, withTenant } from "@librehr/db";
import { runMigrations } from "@librehr/db/migrate";
import { generateTotpCode } from "@librehr/core";
import type { TwoFactorEnableResponse } from "@librehr/contracts";
import { createApp } from "../src/app.js";
import { BetterAuthAdapter } from "../src/adapters/better-auth.js";
import { hashPassword } from "../src/lib/password.js";

// AUTH-003, issue #35: enabling 2FA revokes the account's personal access
// tokens in every organization (migration 0037), in the same transaction that
// promotes the secret and ends the other sessions. Runs against the
// restricted runtime role, so RLS applies.
describe("enabling 2FA revokes personal access tokens", () => {
  let base: TestDatabase;
  let db: RoleSeparatedDatabase;
  let app: ReturnType<typeof createApp>;

  const orgA = "a9100000-0000-0000-0000-00000000000a";
  const orgB = "a9100000-0000-0000-0000-00000000000b";
  /** Member of both organizations, with a token in each. */
  const owner = "c9100000-0000-0000-0000-000000000001";
  const colleague = "c9100000-0000-0000-0000-000000000002";
  const outsider = "c9100000-0000-0000-0000-000000000003";
  const noTokens = "c9100000-0000-0000-0000-000000000004";
  const atomic = "c9100000-0000-0000-0000-000000000005";
  const password = "pat-revocation-password";
  const sessionSecret = "a-secure-test-secret-with-at-least-32-characters";
  const tokenRepo = new TokenRepository();
  const fn = "public.librehr_revoke_user_tokens(uuid)";

  const emailOf = (id: string) => `${id.slice(-1)}-patrevoke@example.invalid`;

  const post = (path: string, body: unknown, headers: Record<string, string>) =>
    app.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  const withCookie = (token: string) => ({
    Cookie: `librehr_session=${token}`,
  });
  const signIn = async (userId: string): Promise<string> => {
    const res = await post(
      "/v1/auth/sign-in",
      { email: emailOf(userId), password },
      { "X-Forwarded-For": crypto.randomUUID() },
    );
    const match = /librehr_session=([^;]+)/.exec(
      res.headers.get("set-cookie") ?? "",
    );
    if (!match?.[1]) throw new Error("no session cookie");
    return match[1];
  };
  const meWithSession = (session: string) =>
    app.request("/v1/me", { headers: withCookie(session) });
  const meWithPat = (plainToken: string) =>
    app.request("/v1/me", {
      headers: { Authorization: `Bearer ${plainToken}` },
    });
  const createPat = (organizationId: string, userId: string, name: string) =>
    withTenant(db.adminSql, { organizationId, userId }, (tx) =>
      tokenRepo.createToken(tx, { userId, name, scopes: ["read"] }),
    );
  /** Sets up 2FA and confirms it from `session`. */
  const enable2fa = async (session: string) => {
    const setupRes = await post("/v1/auth/2fa/setup", {}, withCookie(session));
    expect(setupRes.status).toBe(200);
    const { secret } = (await setupRes.json()) as { secret: string };
    return post(
      "/v1/auth/2fa/enable",
      { code: generateTotpCode(secret) },
      withCookie(session),
    );
  };
  const patCount = async (userId: string) => {
    const [row] = await db.adminSql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM personal_access_tokens
      WHERE user_id = ${userId}`;
    return row?.n ?? -1;
  };
  const twoFactorOn = async (userId: string) => {
    const [row] = await db.adminSql<{ on: boolean }[]>`
      SELECT two_factor_enabled AS on FROM users WHERE id = ${userId}`;
    return row?.on;
  };
  const revokeEntries = (organizationId: string, actorId: string) =>
    withTenant(
      db.adminSql,
      { organizationId },
      (tx) =>
        tx<
          {
            organizationId: string;
            resourceId: string | null;
            metadata: unknown;
          }[]
        >`
          SELECT organization_id AS "organizationId",
                 resource_id AS "resourceId", metadata
          FROM audit_log
          WHERE actor_id = ${actorId} AND action = 'token.revoke'`,
    );

  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database) throw new Error("Docker is required for auth tests");
    base = database;
    db = await createRoleSeparatedDatabase(base);
    await runMigrations(db.ownerConnectionString);

    const sql = db.adminSql;
    await sql`INSERT INTO organizations (id, name, slug, timezone) VALUES
      (${orgA}, 'Pat A', 'pat-a', 'Europe/Madrid'),
      (${orgB}, 'Pat B', 'pat-b', 'Europe/Madrid')`;
    const hash = await hashPassword(password);
    for (const id of [owner, colleague, outsider, noTokens, atomic]) {
      await sql`INSERT INTO users (id, email, name, password_hash)
        VALUES (${id}, ${emailOf(id)}, 'Test User', ${hash})`;
    }
    // Inserted in order, so the owner's default (oldest) membership is orgA.
    for (const [organizationId, userId, role] of [
      [orgA, owner, "admin"],
      [orgB, owner, "employee"],
      [orgA, colleague, "admin"],
      [orgA, noTokens, "employee"],
      [orgA, atomic, "employee"],
      [orgB, outsider, "admin"],
    ] as const) {
      await withTenant(
        sql,
        { organizationId },
        (tx) =>
          tx`INSERT INTO memberships (organization_id, user_id, role)
          VALUES (${organizationId}, ${userId}, ${role})`,
      );
    }

    app = createApp({
      sql: db.appSql,
      authPort: new BetterAuthAdapter(db.appSql),
      sessionSecret,
    });
  }, 60000);

  afterAll(async () => {
    if (db) await db.close();
    if (base) await base.close();
  });

  it("revokes the user's tokens in every organization and audits each in its own", async () => {
    const inA = await createPat(orgA, owner, "ci-a");
    const inB = await createPat(orgB, owner, "ci-b");
    const colleaguePat = await createPat(orgA, colleague, "colleague-ci");
    const outsiderPat = await createPat(orgB, outsider, "outsider-ci");
    for (const pat of [inA, inB, colleaguePat, outsiderPat]) {
      expect((await meWithPat(pat.plainToken)).status).toBe(200);
    }

    const session = await signIn(owner);
    const otherSession = await signIn(owner);
    const res = await enable2fa(session);
    expect(res.status).toBe(200);
    expect((await res.json()) as TwoFactorEnableResponse).toEqual({
      success: true,
      revokedTokens: 2,
    });

    // Both of the owner's tokens are gone, including the other organization's.
    expect((await meWithPat(inA.plainToken)).status).toBe(401);
    expect((await meWithPat(inB.plainToken)).status).toBe(401);
    expect(await patCount(owner)).toBe(0);
    // The enabling session is kept; the other one ends, as before.
    expect((await meWithSession(session)).status).toBe(200);
    expect((await meWithSession(otherSession)).status).toBe(401);

    // Other users' tokens, in either organization, are untouched.
    expect((await meWithPat(colleaguePat.plainToken)).status).toBe(200);
    expect((await meWithPat(outsiderPat.plainToken)).status).toBe(200);
    expect(await patCount(colleague)).toBe(1);
    expect(await patCount(outsider)).toBe(1);

    // One token.revoke per token, each in the token's own organization.
    const auditA = await revokeEntries(orgA, owner);
    const auditB = await revokeEntries(orgB, owner);
    expect(auditA).toEqual([
      {
        organizationId: orgA,
        resourceId: inA.token.id,
        metadata: { reason: "2fa_enabled" },
      },
    ]);
    expect(auditB).toEqual([
      {
        organizationId: orgB,
        resourceId: inB.token.id,
        metadata: { reason: "2fa_enabled" },
      },
    ]);
    const [enabled] = await withTenant(
      db.adminSql,
      { organizationId: orgA },
      (tx) =>
        tx<{ metadata: unknown }[]>`
          SELECT metadata FROM audit_log
          WHERE actor_id = ${owner} AND action = 'auth.2fa.enable'`,
    );
    expect(enabled?.metadata).toMatchObject({ revokedTokens: 2 });
    // Ids only: no token secret, hash or name reaches the audit log.
    const logged = JSON.stringify([auditA, auditB, enabled]);
    for (const pat of [inA, inB]) {
      expect(logged).not.toContain(pat.plainToken);
      expect(logged).not.toContain(pat.token.tokenHash);
      expect(logged).not.toContain(pat.token.name);
    }
  });

  it("reports zero revoked tokens when the user has none", async () => {
    const res = await enable2fa(await signIn(noTokens));
    expect(res.status).toBe(200);
    expect((await res.json()) as TwoFactorEnableResponse).toEqual({
      success: true,
      revokedTokens: 0,
    });
  });

  it("changes nothing when a later step of the transaction fails", async () => {
    const pat = await createPat(orgA, atomic, "atomic-ci");
    const session = await signIn(atomic);
    const otherSession = await signIn(atomic);

    // Test-only: make the first token.revoke audit insert fail, i.e. after
    // the promotion, the session revocation and the token delete ran.
    await db.adminSql.unsafe(`
      CREATE FUNCTION test_fail_token_revoke() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.action = 'token.revoke' THEN
          RAISE EXCEPTION 'forced failure (test)';
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER test_fail_token_revoke BEFORE INSERT ON audit_log
        FOR EACH ROW EXECUTE FUNCTION test_fail_token_revoke();
    `);
    try {
      const res = await enable2fa(session);
      expect(res.status).toBe(500);
    } finally {
      await db.adminSql.unsafe(`
        DROP TRIGGER IF EXISTS test_fail_token_revoke ON audit_log;
        DROP FUNCTION IF EXISTS test_fail_token_revoke();
      `);
    }

    expect(await twoFactorOn(atomic)).toBe(false);
    expect((await meWithPat(pat.plainToken)).status).toBe(200);
    expect(await patCount(atomic)).toBe(1);
    expect((await meWithSession(session)).status).toBe(200);
    expect((await meWithSession(otherSession)).status).toBe(200);
    expect(await revokeEntries(orgA, atomic)).toEqual([]);
  });

  describe("librehr_revoke_user_tokens (migration 0037)", () => {
    it("is executable by the runtime role only", async () => {
      const [grants] = await db.adminSql<
        { app: boolean; publicRole: boolean; securityDefiner: boolean }[]
      >`
        SELECT has_function_privilege('librehr_app', ${fn}, 'EXECUTE') AS app,
               has_function_privilege('public', ${fn}, 'EXECUTE') AS "publicRole",
               p.prosecdef AS "securityDefiner"
        FROM pg_proc p WHERE p.oid = ${fn}::regprocedure`;
      expect(grants).toEqual({
        app: true,
        publicRole: false,
        securityDefiner: true,
      });

      // Another role cannot call it.
      const other = `librehr_test_other_${crypto.randomBytes(4).toString("hex")}`;
      await db.adminSql.unsafe(`CREATE ROLE ${other} NOLOGIN`);
      try {
        await expect(
          db.adminSql.begin(async (tx) => {
            await tx.unsafe(`SET LOCAL ROLE ${other}`);
            await tx.unsafe(
              `SELECT * FROM public.librehr_revoke_user_tokens('${owner}'::uuid)`,
            );
          }),
        ).rejects.toThrow(/permission denied/);
      } finally {
        await db.adminSql.unsafe(`DROP ROLE IF EXISTS ${other}`);
      }
    });

    it("deletes only the given user's tokens and restores the tenant setting", async () => {
      const targetA = await createPat(orgA, colleague, "target-a");
      const keepB = await createPat(orgB, outsider, "keep-b");
      const before = {
        colleague: await patCount(colleague),
        outsider: await patCount(outsider),
      };

      const { rows, orgAfter } = await withTenant(
        db.appSql,
        { organizationId: orgA, userId: colleague },
        async (tx) => ({
          rows: await tokenRepo.revokeAllForUser(tx, colleague),
          orgAfter: (
            await tx<{ org: string }[]>`
              SELECT current_setting('app.current_org', true) AS org`
          )[0]?.org,
        }),
      );

      expect(rows.map((r) => r.organizationId)).toEqual(
        Array(before.colleague).fill(orgA),
      );
      expect(rows.map((r) => r.id)).toContain(targetA.token.id);
      expect(orgAfter).toBe(orgA);
      expect(await patCount(colleague)).toBe(0);
      expect(await patCount(outsider)).toBe(before.outsider);
      expect((await meWithPat(keepB.plainToken)).status).toBe(200);
    });
  });
});
