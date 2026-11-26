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
// tokens in the same transaction that ends its other sessions. Other users'
// tokens and other organizations' tokens are untouched. Runs against the
// restricted runtime role, so RLS applies.
describe("enabling 2FA revokes personal access tokens", () => {
  let base: TestDatabase;
  let db: RoleSeparatedDatabase;
  let app: ReturnType<typeof createApp>;

  const orgA = "a9100000-0000-0000-0000-00000000000a";
  const orgB = "a9100000-0000-0000-0000-00000000000b";
  const owner = "c9100000-0000-0000-0000-000000000001";
  const colleague = "c9100000-0000-0000-0000-000000000002";
  const outsider = "c9100000-0000-0000-0000-000000000003";
  const noTokens = "c9100000-0000-0000-0000-000000000004";
  const password = "pat-revocation-password";
  const sessionSecret = "a-secure-test-secret-with-at-least-32-characters";
  const tokenRepo = new TokenRepository();

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
  const withPat = (plainToken: string) =>
    app.request("/v1/me", {
      headers: { Authorization: `Bearer ${plainToken}` },
    });
  const createPat = (organizationId: string, userId: string, name: string) =>
    withTenant(db.adminSql, { organizationId, userId }, (tx) =>
      tokenRepo.createToken(tx, { userId, name, scopes: ["read"] }),
    );
  const enable2fa = async (userId: string) => {
    const session = await signIn(userId);
    const setupRes = await post("/v1/auth/2fa/setup", {}, withCookie(session));
    expect(setupRes.status).toBe(200);
    const { secret } = (await setupRes.json()) as { secret: string };
    const res = await post(
      "/v1/auth/2fa/enable",
      { code: generateTotpCode(secret) },
      withCookie(session),
    );
    return { res, session };
  };
  const patCount = async (userId: string) => {
    const [row] = await db.adminSql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM personal_access_tokens
      WHERE user_id = ${userId}`;
    return row?.n ?? -1;
  };

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
    for (const id of [owner, colleague, outsider, noTokens]) {
      await sql`INSERT INTO users (id, email, name, password_hash)
        VALUES (${id}, ${emailOf(id)}, 'Test User', ${hash})`;
    }
    for (const [organizationId, userId, role] of [
      [orgA, owner, "admin"],
      [orgA, colleague, "admin"],
      [orgA, noTokens, "employee"],
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

  it("revokes the user's tokens, keeps others' and other organizations' tokens, and audits ids only", async () => {
    const ownPats = [
      await createPat(orgA, owner, "ci"),
      await createPat(orgA, owner, "backup"),
    ];
    const colleaguePat = await createPat(orgA, colleague, "colleague-ci");
    const outsiderPat = await createPat(orgB, outsider, "outsider-ci");
    for (const pat of [...ownPats, colleaguePat, outsiderPat]) {
      expect((await withPat(pat.plainToken)).status).toBe(200);
    }

    const { res, session } = await enable2fa(owner);
    expect(res.status).toBe(200);
    expect((await res.json()) as TwoFactorEnableResponse).toEqual({
      success: true,
      revokedTokens: 2,
    });

    // The owner's tokens no longer authenticate and are gone.
    for (const pat of ownPats) {
      expect((await withPat(pat.plainToken)).status).toBe(401);
    }
    expect(await patCount(owner)).toBe(0);
    // The session that enabled 2FA is kept.
    expect(
      (await app.request("/v1/me", { headers: withCookie(session) })).status,
    ).toBe(200);

    // Another user in the same organization keeps their token.
    expect((await withPat(colleaguePat.plainToken)).status).toBe(200);
    expect(await patCount(colleague)).toBe(1);
    // Another organization's token is untouched.
    expect((await withPat(outsiderPat.plainToken)).status).toBe(200);
    expect(await patCount(outsider)).toBe(1);

    const entries = await withTenant(
      db.adminSql,
      { organizationId: orgA },
      (tx) =>
        tx<{ action: string; resourceId: string | null; metadata: unknown }[]>`
          SELECT action, resource_id AS "resourceId", metadata FROM audit_log
          WHERE actor_id = ${owner}
            AND action IN ('token.revoke', 'auth.2fa.enable')
          ORDER BY created_at, action`,
    );
    const revoked = entries.filter((e) => e.action === "token.revoke");
    expect(revoked.map((e) => e.resourceId).sort()).toEqual(
      ownPats.map((p) => p.token.id).sort(),
    );
    for (const entry of revoked) {
      expect(entry.metadata).toEqual({ reason: "2fa_enabled" });
    }
    const enabled = entries.find((e) => e.action === "auth.2fa.enable");
    expect(enabled?.metadata).toMatchObject({ revokedTokens: 2 });
    // Ids only: neither token secrets nor their names reach the audit log.
    const logged = JSON.stringify(entries);
    for (const pat of ownPats) {
      expect(logged).not.toContain(pat.plainToken);
      expect(logged).not.toContain(pat.token.tokenHash);
      expect(logged).not.toContain(pat.token.name);
    }

    // Nothing was audited in the other organization.
    const [otherOrg] = await withTenant(
      db.adminSql,
      { organizationId: orgB },
      (tx) =>
        tx<{ n: number }[]>`SELECT count(*)::int AS n FROM audit_log
          WHERE action = 'token.revoke'`,
    );
    expect(otherOrg?.n).toBe(0);
  });

  it("reports zero revoked tokens when the user has none", async () => {
    const { res } = await enable2fa(noTokens);
    expect(res.status).toBe(200);
    expect((await res.json()) as TwoFactorEnableResponse).toEqual({
      success: true,
      revokedTokens: 0,
    });
  });
});
