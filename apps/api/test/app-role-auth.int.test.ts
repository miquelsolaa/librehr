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
import { createApp } from "../src/app.js";
import { BetterAuthAdapter } from "../src/adapters/better-auth.js";
import { hashPassword } from "../src/lib/password.js";

// ORG-006, AUTH-001/002, ADM-006: the API runs as librehr_app (NOBYPASSRLS)
// against a database owned by a NOSUPERUSER NOBYPASSRLS role, as in production.
describe("API on the restricted runtime role", () => {
  let base: TestDatabase;
  let db: RoleSeparatedDatabase;
  let app: ReturnType<typeof createApp>;

  const orgA = "a7000000-0000-0000-0000-00000000000a";
  const orgB = "b7000000-0000-0000-0000-00000000000b";
  const userId = "c7000000-0000-0000-0000-00000000000c";
  const email = "two-orgs@example.invalid";
  const password = "two-orgs-password";
  const recoveryCode = "abcd-1234";
  const sessionSecret = "a-secure-test-secret-with-at-least-32-characters";

  const json = (path: string, body: unknown, token?: string) =>
    app.request(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  const me = (token: string) =>
    app.request("/v1/me", { headers: { Authorization: `Bearer ${token}` } });
  // The session token is only in the httpOnly cookie, never in the body.
  const cookieToken = (res: Response): string => {
    const match = /librehr_session=([^;]+)/.exec(
      res.headers.get("set-cookie") ?? "",
    );
    if (!match?.[1]) throw new Error("no session cookie");
    return match[1];
  };
  const signIn = async () => {
    const res = await json("/v1/auth/sign-in", { email, password });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      user: { organizationId: string };
    };
    expect(body).not.toHaveProperty("token");
    return { ...body, token: cookieToken(res) };
  };

  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database)
      throw new Error("Docker is required for app-role integration tests");
    base = database;
    db = await createRoleSeparatedDatabase(base);
    await runMigrations(db.ownerConnectionString);

    const sql = db.adminSql;
    await sql`INSERT INTO organizations (id, name, slug) VALUES
      (${orgA}, 'Org A', 'app-role-a'), (${orgB}, 'Org B', 'app-role-b')`;
    await sql`INSERT INTO users (id, email, name, password_hash) VALUES
      (${userId}, ${email}, 'Two Orgs', ${await hashPassword(password)})`;
    // Org A's membership is inserted first but is the newer one: the default
    // must follow created_at, not insertion or physical order.
    await withTenant(sql, { organizationId: orgA }, async (tx) => {
      await tx`INSERT INTO memberships (organization_id, user_id, role, created_at)
        VALUES (${orgA}, ${userId}, 'admin', '2026-02-01T00:00:00Z')`;
      await tx`INSERT INTO employees (organization_id, first_name, last_name, email)
        VALUES (${orgA}, 'Ana', 'Alpha', 'ana@example.invalid')`;
    });
    await withTenant(sql, { organizationId: orgB }, async (tx) => {
      await tx`INSERT INTO memberships (organization_id, user_id, role, created_at)
        VALUES (${orgB}, ${userId}, 'employee', '2026-01-01T00:00:00Z')`;
    });

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

  it("connects without BYPASSRLS and sees no tenant rows without a tenant context", async () => {
    const [role] = await db.appSql<
      { rolsuper: boolean; rolbypassrls: boolean }[]
    >`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    expect(role).toEqual({ rolsuper: false, rolbypassrls: false });

    const [all] = await db.adminSql<
      { n: number }[]
    >`SELECT count(*)::int AS n FROM employees`;
    expect(all?.n).toBeGreaterThan(0);

    const [none] = await db.appSql<
      { n: number }[]
    >`SELECT count(*)::int AS n FROM employees`;
    expect(none?.n).toBe(0);

    const wrongOrg = await withTenant(
      db.appSql,
      { organizationId: orgB },
      (tx) =>
        tx<
          { n: number }[]
        >`SELECT count(*)::int AS n FROM employees WHERE organization_id = ${orgA}`,
    );
    expect(wrongOrg[0]?.n).toBe(0);
  });

  it("denies UPDATE and DELETE on append-only tables by privilege", async () => {
    for (const statement of [
      "UPDATE time_events SET reason = 'x'",
      "DELETE FROM leave_ledger",
      "UPDATE audit_log SET action = 'x'",
    ]) {
      await expect(
        withTenant(db.appSql, { organizationId: orgA }, (tx) =>
          tx.unsafe(statement),
        ),
      ).rejects.toThrow(/permission denied/i);
    }
  });

  it("signs in to the oldest membership and keeps that org on the session", async () => {
    for (let i = 0; i < 3; i++) {
      const body = await signIn();
      expect(body.user.organizationId).toBe(orgB);
      const res = await me(body.token);
      expect(res.status).toBe(200);
      const profile = (await res.json()) as {
        user: { organizationId: string; role: string };
        organization: { id: string };
      };
      expect(profile.organization.id).toBe(orgB);
      expect(profile.user.role).toBe("employee");
    }
    const sessions = await db.adminSql<
      { organization_id: string | null }[]
    >`SELECT organization_id FROM sessions WHERE user_id = ${userId}`;
    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions.every((s) => s.organization_id === orgB)).toBe(true);
  });

  it("resolves the session's stored org and rejects it once the membership is gone", async () => {
    const pinned = crypto.randomBytes(32).toString("hex");
    const legacy = crypto.randomBytes(32).toString("hex");
    await db.adminSql`INSERT INTO sessions (user_id, token, expires_at, organization_id) VALUES
      (${userId}, ${pinned}, now() + interval '1 hour', ${orgA}),
      (${userId}, ${legacy}, now() + interval '1 hour', NULL)`;

    const pinnedMe = (await (await me(pinned)).json()) as {
      organization: { id: string };
      user: { role: string };
    };
    expect(pinnedMe.organization.id).toBe(orgA);
    expect(pinnedMe.user.role).toBe("admin");

    // Legacy sessions without an org fall back to the oldest membership.
    const legacyMe = (await (await me(legacy)).json()) as {
      organization: { id: string };
    };
    expect(legacyMe.organization.id).toBe(orgB);

    const revoked = crypto.randomBytes(32).toString("hex");
    const otherUser = "d7000000-0000-0000-0000-00000000000d";
    await db.adminSql`INSERT INTO users (id, email, name) VALUES (${otherUser}, 'gone@example.invalid', 'Gone')`;
    await db.adminSql`INSERT INTO sessions (user_id, token, expires_at, organization_id)
      VALUES (${otherUser}, ${revoked}, now() + interval '1 hour', ${orgA})`;
    expect((await me(revoked)).status).toBe(401);
  });

  it("signs out by revoking the session", async () => {
    const { token } = await signIn();
    expect((await json("/v1/auth/sign-out", {}, token)).status).toBe(200);
    expect((await me(token)).status).toBe(401);
  });

  it("issues a 2FA session in the same deterministic org", async () => {
    const twoFactorEmail = "two-factor@example.invalid";
    const twoFactorUser = "e7000000-0000-0000-0000-00000000000e";
    const hashedCode = crypto
      .createHash("sha256")
      .update(recoveryCode)
      .digest("hex");
    await db.adminSql`INSERT INTO users (id, email, name, password_hash, two_factor_enabled, two_factor_secret, two_factor_recovery_codes)
      VALUES (${twoFactorUser}, ${twoFactorEmail}, 'Two Factor', ${await hashPassword(password)}, true, 'JBSWY3DPEHPK3PXP', ${db.adminSql.json([hashedCode])})`;
    await withTenant(
      db.adminSql,
      { organizationId: orgA },
      (tx) =>
        tx`INSERT INTO memberships (organization_id, user_id, role, created_at) VALUES (${orgA}, ${twoFactorUser}, 'manager', '2026-03-01T00:00:00Z')`,
    );
    await withTenant(
      db.adminSql,
      { organizationId: orgB },
      (tx) =>
        tx`INSERT INTO memberships (organization_id, user_id, role, created_at) VALUES (${orgB}, ${twoFactorUser}, 'employee', '2026-04-01T00:00:00Z')`,
    );

    const challenge = (await (
      await json("/v1/auth/sign-in", { email: twoFactorEmail, password })
    ).json()) as { challengeToken: string };
    const res = await json("/v1/auth/2fa/verify", {
      challengeToken: challenge.challengeToken,
      code: recoveryCode,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      user: { organizationId: string; role: string };
    };
    expect(body).not.toHaveProperty("token");
    expect(body.user).toMatchObject({ organizationId: orgA, role: "manager" });
    const profile = (await (await me(cookieToken(res))).json()) as {
      organization: { id: string };
    };
    expect(profile.organization.id).toBe(orgA);
  });

  it("authenticates personal access tokens and rejects unknown ones", async () => {
    const created = await withTenant(
      db.adminSql,
      { organizationId: orgA, userId },
      (tx) =>
        new TokenRepository().createToken(tx, {
          userId,
          name: "ci",
          scopes: ["read"],
        }),
    );
    const res = await me(created.plainToken);
    expect(res.status).toBe(200);
    const profile = (await res.json()) as {
      user: { id: string };
      organization: { id: string };
    };
    expect(profile.user.id).toBe(userId);
    expect(profile.organization.id).toBe(orgA);

    expect((await me("lhr_not-a-real-token")).status).toBe(401);
  });

  it("reads and accepts an invitation before any tenant context exists", async () => {
    const token = crypto.randomBytes(32).toString("hex");
    await withTenant(
      db.adminSql,
      { organizationId: orgA },
      (tx) =>
        tx`INSERT INTO invitations (email, role, token, expires_at)
        VALUES ('invitee@example.invalid', 'employee', ${token}, now() + interval '1 day')`,
    );

    const details = await app.request(`/v1/invitations/${token}`);
    expect(details.status).toBe(200);
    expect(await details.json()).toMatchObject({
      email: "invitee@example.invalid",
      orgName: "Org A",
    });

    const accepted = await json("/v1/invitations/accept", {
      token,
      name: "Invited Person",
      password: "invitee-password",
    });
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({
      user: { organizationId: orgA, role: "employee" },
    });

    expect((await app.request("/v1/invitations/unknown-token")).status).toBe(
      404,
    );
  });

  it("finds the SSO provider for a domain across organizations", async () => {
    await withTenant(
      db.adminSql,
      { organizationId: orgB },
      (tx) =>
        tx`INSERT INTO sso_configurations (provider, client_id, client_secret, issuer_url, enabled, allowed_domains)
        VALUES ('generic_oidc', 'client-b', 'secret', 'https://idp.example.invalid', true, ${tx.json(["@Sso-B.example.invalid"])})`,
    );

    const res = await json("/v1/sso/authorize", {
      email: "person@sso-b.example.invalid",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { authorizationUrl: string };
    expect(body.authorizationUrl).toContain("client_id=client-b");

    const missing = await json("/v1/sso/authorize", {
      domain: "unknown.example.invalid",
    });
    expect(missing.status).toBe(404);
  });
});
