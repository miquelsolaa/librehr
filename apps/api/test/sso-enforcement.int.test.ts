import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createRoleSeparatedDatabase,
  getTestDatabase,
  type RoleSeparatedDatabase,
  type TestDatabase,
} from "@librehr/testing";
import { hashBearerToken, TokenRepository, withTenant } from "@librehr/db";
import { runMigrations } from "@librehr/db/migrate";
import { generateTotpCode, generateTotpSecret } from "@librehr/core";
import type { ProblemDetails } from "@librehr/contracts";
import { createApp } from "../src/app.js";
import { BetterAuthAdapter } from "../src/adapters/better-auth.js";
import { hashPassword } from "../src/lib/password.js";
import { createPasswordResetToken } from "../src/lib/password-reset.js";
import { isolatedRateLimitStore } from "./support/rate-limit.js";

// AUTH-004 (issue #180): "Require SSO" for password sessions, decided per
// membership. Runs the real adapter and the 0041 lookup functions on the
// restricted runtime role.
describe("SSO enforcement for password sessions (AUTH-004)", () => {
  let base: TestDatabase;
  let db: RoleSeparatedDatabase;
  let enforcing: ReturnType<typeof createApp>;
  let inert: ReturnType<typeof createApp>;

  const orgE = "a9410000-0000-0000-0000-00000000000e"; // enforces SSO
  const orgN = "a9410000-0000-0000-0000-00000000000f"; // does not
  const orgD = "a9410000-0000-0000-0000-00000000000d"; // enforce_sso, disabled config
  const orgT = "a9410000-0000-0000-0000-00000000000c"; // toggled by a test

  const employee = "c9410000-0000-0000-0000-000000000001";
  const employee2fa = "c9410000-0000-0000-0000-000000000002";
  const multi = "c9410000-0000-0000-0000-000000000003";
  const admin2fa = "c9410000-0000-0000-0000-000000000004";
  const adminNo2fa = "c9410000-0000-0000-0000-000000000005";
  const outsider = "c9410000-0000-0000-0000-000000000006";
  const disabledMember = "c9410000-0000-0000-0000-000000000007";
  const toggled = "c9410000-0000-0000-0000-000000000008";
  const resetUser = "c9410000-0000-0000-0000-000000000009";

  const password = "sso-enforcement-password";
  // Every account shares one email domain; orgE lists it in allowed_domains,
  // yet enforcement never reaches members of other organizations.
  const emailOf = (id: string) => `u${id.slice(-2)}@shared.example.invalid`;
  const secrets = new Map<string, string>();

  const post = (
    app: ReturnType<typeof createApp>,
    path: string,
    body: unknown,
  ) =>
    app.request(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": crypto.randomUUID(),
      },
      body: JSON.stringify(body),
    });
  const signIn = (
    id: string,
    app = enforcing,
    extra: Record<string, string> = {},
  ) =>
    post(app, "/v1/auth/sign-in", { email: emailOf(id), password, ...extra });
  const totp = (id: string) => generateTotpCode(secrets.get(id)!);
  const cookieOf = (res: Response): string => {
    const match = /librehr_session=([^;]+)/.exec(
      res.headers.get("set-cookie") ?? "",
    );
    if (!match?.[1]) throw new Error("no session cookie");
    return match[1];
  };
  const me = (token: string, app = enforcing) =>
    app.request("/v1/me", { headers: { Cookie: `librehr_session=${token}` } });
  const problem = async (res: Response) => (await res.json()) as ProblemDetails;
  const sessionCount = async (id: string) => {
    const [row] = await db.adminSql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM sessions WHERE user_id = ${id}`;
    return row!.n;
  };
  const setEnforce = (org: string, enforce: boolean) =>
    db.adminSql`UPDATE sso_configurations SET enforce_sso = ${enforce}
      WHERE organization_id = ${org}`;

  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database) throw new Error("Docker is required for auth tests");
    base = database;
    db = await createRoleSeparatedDatabase(base);
    await runMigrations(db.ownerConnectionString);
    const sql = db.adminSql;

    await sql`INSERT INTO organizations (id, name, slug, timezone) VALUES
      (${orgE}, 'Enforcing', 'sso-e', 'Europe/Madrid'),
      (${orgN}, 'Not enforcing', 'sso-n', 'Europe/Madrid'),
      (${orgD}, 'Disabled config', 'sso-d', 'Europe/Madrid'),
      (${orgT}, 'Toggled', 'sso-t', 'Europe/Madrid')`;
    const hash = await hashPassword(password);
    const users = [
      employee,
      employee2fa,
      multi,
      admin2fa,
      adminNo2fa,
      outsider,
      disabledMember,
      toggled,
      resetUser,
    ];
    for (const id of users) {
      await sql`INSERT INTO users (id, email, name, password_hash)
        VALUES (${id}, ${emailOf(id)}, 'Test User', ${hash})`;
    }
    for (const id of [employee2fa, admin2fa]) {
      const secret = generateTotpSecret();
      secrets.set(id, secret);
      await sql`UPDATE users SET two_factor_enabled = true,
        two_factor_secret = ${secret} WHERE id = ${id}`;
    }

    // multi joins orgE first, so orgE is its default membership.
    const memberships: [string, string, string][] = [
      [orgE, employee, "employee"],
      [orgE, employee2fa, "employee"],
      [orgE, multi, "employee"],
      [orgE, admin2fa, "admin"],
      [orgE, adminNo2fa, "admin"],
      [orgE, resetUser, "employee"],
      [orgN, multi, "employee"],
      [orgN, outsider, "employee"],
      [orgD, disabledMember, "employee"],
      [orgT, toggled, "employee"],
    ];
    for (const [org, id, role] of memberships) {
      await withTenant(
        sql,
        { organizationId: org },
        (tx) =>
          tx`INSERT INTO memberships (organization_id, user_id, role)
          VALUES (${org}, ${id}, ${role})`,
      );
      // Distinct created_at so the default membership is deterministic.
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    const config = (org: string, enabled: boolean, enforce: boolean) =>
      sql`INSERT INTO sso_configurations
        (organization_id, provider, client_id, client_secret, issuer_url,
         enabled, enforce_sso, allowed_domains)
        VALUES (${org}, 'generic_oidc', 'client', 'stored-secret-value',
          'https://idp.example.invalid', ${enabled}, ${enforce},
          ${sql.json(["shared.example.invalid"])})`;
    await config(orgE, true, true);
    await config(orgD, false, true);
    await config(orgT, true, false);

    const appFor = (ssoEnforcement: boolean) =>
      createApp({
        sql: db.appSql,
        authPort: new BetterAuthAdapter(db.appSql, { ssoEnforcement }),
        rateLimitStore: isolatedRateLimitStore(db.appSql),
        sessionSecret: "a-secure-test-secret-with-at-least-32-characters",
        trustProxy: 1,
      });
    enforcing = appFor(true);
    // Community licence, or SSO_ENABLED off (lib/sso-enforcement.ts).
    inert = appFor(false);
  }, 60000);

  afterAll(async () => {
    if (db) await db.close();
    if (base) await base.close();
  });

  describe("password sign-in", () => {
    it("answers 403 SSO_REQUIRED to a member whose only organization enforces, and stores no session", async () => {
      const res = await signIn(employee);
      expect(res.status).toBe(403);
      expect(res.headers.get("content-type")).toContain(
        "application/problem+json",
      );
      const body = await problem(res);
      expect(body.code).toBe("SSO_REQUIRED");
      expect(JSON.stringify(body)).not.toContain(orgE);
      expect(res.headers.get("set-cookie")).toBeNull();
      expect(await sessionCount(employee)).toBe(0);
    });

    it("still answers 401 INVALID_CREDENTIALS to a wrong password (no enumeration)", async () => {
      const res = await post(enforcing, "/v1/auth/sign-in", {
        email: emailOf(employee),
        password: "not-the-password",
      });
      expect(res.status).toBe(401);
      expect((await problem(res)).code).toBe("INVALID_CREDENTIALS");
    });

    it("rejects an invalid body with 400 before any check", async () => {
      const res = await post(enforcing, "/v1/auth/sign-in", { email: "x" });
      expect(res.status).toBe(400);
    });

    it("refuses after the 2FA challenge for a non-admin with TOTP", async () => {
      const challenge = await signIn(employee2fa);
      expect(challenge.status).toBe(200);
      const { challengeToken } = (await challenge.json()) as {
        challengeToken: string;
      };
      const res = await post(enforcing, "/v1/auth/2fa/verify", {
        challengeToken,
        code: totp(employee2fa),
      });
      expect(res.status).toBe(403);
      expect((await problem(res)).code).toBe("SSO_REQUIRED");
      expect(await sessionCount(employee2fa)).toBe(0);
    });

    it("binds a user of an enforcing and a non-enforcing organization to the non-enforcing one", async () => {
      const res = await signIn(multi);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { user: { organizationId: string } };
      expect(body.user.organizationId).toBe(orgN);
      expect((await me(cookieOf(res))).status).toBe(200);
    });

    it("lets an admin with TOTP in as break-glass and audits it in that organization only", async () => {
      const res = await signIn(admin2fa, enforcing, {
        twoFactorCode: totp(admin2fa),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { user: { organizationId: string } };
      expect(body.user.organizationId).toBe(orgE);
      expect((await me(cookieOf(res))).status).toBe(200);

      const rows = await db.adminSql<
        { organization_id: string; metadata: unknown }[]
      >`SELECT organization_id, metadata FROM audit_log
        WHERE action = 'auth.sso.break_glass' AND actor_id = ${admin2fa}`;
      expect(rows).toEqual([
        { organization_id: orgE, metadata: { authMethod: "password" } },
      ]);
    });

    it("refuses an admin without TOTP (forbidden, not break-glass)", async () => {
      const res = await signIn(adminNo2fa);
      expect(res.status).toBe(403);
      expect((await problem(res)).code).toBe("SSO_REQUIRED");
    });

    it("never affects members of other organizations, even with a shared email domain", async () => {
      const res = await signIn(outsider);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { user: { organizationId: string } };
      expect(body.user.organizationId).toBe(orgN);
    });

    it("ignores enforce_sso when the organization's SSO configuration is disabled", async () => {
      expect((await signIn(disabledMember)).status).toBe(200);
    });
  });

  describe("inert without a licence granting sso or with SSO_ENABLED off", () => {
    it("opens password sessions in an enforcing organization and keeps the stored setting", async () => {
      const res = await signIn(employee, inert);
      expect(res.status).toBe(200);
      expect((await me(cookieOf(res), inert)).status).toBe(200);
      const [row] = await db.adminSql<{ enforce_sso: boolean }[]>`
        SELECT enforce_sso FROM sso_configurations
        WHERE organization_id = ${orgE}`;
      expect(row?.enforce_sso).toBe(true);
    });

    it("writes no break-glass audit entry when enforcement is inert", async () => {
      const before = await db.adminSql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM audit_log
        WHERE action = 'auth.sso.break_glass'`;
      const res = await signIn(admin2fa, inert, {
        twoFactorCode: generateTotpCode(
          secrets.get(admin2fa)!,
          Date.now() + 30_000,
        ),
      });
      expect(res.status).toBe(200);
      const after = await db.adminSql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM audit_log
        WHERE action = 'auth.sso.break_glass'`;
      expect(after[0]!.n).toBe(before[0]!.n);
    });
  });

  describe("existing credentials", () => {
    it("refuses an existing password session at lookup while its organization enforces, and restores it when lifted", async () => {
      const res = await signIn(toggled);
      expect(res.status).toBe(200);
      const token = cookieOf(res);
      expect((await me(token)).status).toBe(200);

      await setEnforce(orgT, true);
      expect((await me(token)).status).toBe(401);
      // Nothing was deleted: an inert instance still accepts it.
      expect((await me(token, inert)).status).toBe(200);

      await setEnforce(orgT, false);
      expect((await me(token)).status).toBe(200);
    });

    it("accepts an SSO session in an enforcing organization", async () => {
      const token = crypto.randomBytes(32).toString("hex");
      await db.adminSql`INSERT INTO sessions
        (user_id, token, expires_at, organization_id, auth_method)
        VALUES (${employee}, ${hashBearerToken(token)},
          now() + interval '1 hour', ${orgE}, 'sso')`;
      expect((await me(token)).status).toBe(200);
    });

    it("keeps an existing personal access token working", async () => {
      const pat = `lhr_${crypto.randomBytes(24).toString("hex")}`;
      await withTenant(
        db.adminSql,
        { organizationId: orgE },
        (tx) =>
          tx`INSERT INTO personal_access_tokens
          (organization_id, user_id, name, token_hash, prefix, scopes)
          VALUES (${orgE}, ${employee}, 'Integration',
            ${TokenRepository.hashToken(pat)}, 'lhr_test', '["read"]'::jsonb)`,
      );
      const res = await enforcing.request("/v1/me", {
        headers: { Authorization: `Bearer ${pat}` },
      });
      expect(res.status).toBe(200);
    });

    it("rejects an unauthenticated request with 401", async () => {
      expect((await enforcing.request("/v1/me")).status).toBe(401);
    });
  });

  // Decision Q4: new tokens need an SSO session or a break-glass admin. A
  // password session of anyone else is already refused at lookup, and a
  // token cannot create tokens (interactive-only route).
  describe("personal access token creation", () => {
    const session = async (user: string, method: "password" | "sso") => {
      const token = crypto.randomBytes(32).toString("hex");
      await db.adminSql`INSERT INTO sessions
        (user_id, token, expires_at, organization_id, auth_method)
        VALUES (${user}, ${hashBearerToken(token)},
          now() + interval '1 hour', ${orgE}, ${method})`;
      return token;
    };
    const createToken = (bearer: string) =>
      enforcing.request("/v1/tokens", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${bearer}`,
        },
        body: JSON.stringify({ name: "CI", scopes: ["read"] }),
      });

    it("refuses a member's password session in an enforcing organization", async () => {
      const res = await createToken(await session(employee, "password"));
      expect(res.status).toBe(401);
      const [row] = await db.adminSql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM personal_access_tokens
        WHERE user_id = ${employee} AND name = 'CI'`;
      expect(row!.n).toBe(0);
    });

    it("allows an SSO session", async () => {
      expect((await createToken(await session(employee, "sso"))).status).toBe(
        201,
      );
    });

    it("allows a break-glass admin's password session", async () => {
      expect(
        (await createToken(await session(admin2fa, "password"))).status,
      ).toBe(201);
    });

    it("refuses a token creating another token", async () => {
      const pat = `lhr_${crypto.randomBytes(24).toString("hex")}`;
      await withTenant(
        db.adminSql,
        { organizationId: orgE },
        (tx) =>
          tx`INSERT INTO personal_access_tokens
          (organization_id, user_id, name, token_hash, prefix, scopes)
          VALUES (${orgE}, ${admin2fa}, 'Admin automation',
            ${TokenRepository.hashToken(pat)}, 'lhr_adm1', '["admin"]'::jsonb)`,
      );
      const res = await createToken(pat);
      expect(res.status).toBe(403);
      expect((await problem(res)).code).toBe("TOKEN_SCOPE_INSUFFICIENT");
    });
  });

  it("allows a password reset that still cannot open a session in an enforcing organization", async () => {
    const created = await createPasswordResetToken(
      db.appSql,
      emailOf(resetUser),
    );
    expect(created).not.toBeNull();
    const confirm = await post(enforcing, "/v1/auth/password-reset/confirm", {
      token: created!.token,
      password,
    });
    expect(confirm.status).toBe(200);
    const res = await signIn(resetUser);
    expect(res.status).toBe(403);
    expect((await problem(res)).code).toBe("SSO_REQUIRED");
  });

  describe("invitation accept", () => {
    const invite = async (org: string, email: string) => {
      const token = crypto.randomBytes(32).toString("hex");
      await withTenant(
        db.adminSql,
        { organizationId: org },
        (tx) =>
          tx`INSERT INTO invitations (organization_id, email, role, token, expires_at)
          VALUES (${org}, ${email}, 'employee', ${hashBearerToken(token)},
            now() + interval '7 days')`,
      );
      return token;
    };

    it("accepts into an enforcing organization, then answers 403 SSO_REQUIRED without a session", async () => {
      const email = "invitee@shared.example.invalid";
      const token = await invite(orgE, email);
      const res = await post(enforcing, "/v1/invitations/accept", {
        token,
        name: "New Invitee",
        password,
      });
      expect(res.status).toBe(403);
      expect((await problem(res)).code).toBe("SSO_REQUIRED");
      expect(res.headers.get("set-cookie")).toBeNull();

      const [user] = await db.adminSql<{ id: string }[]>`
        SELECT id FROM users WHERE email = ${email}`;
      expect(user).toBeDefined();
      expect(await sessionCount(user!.id)).toBe(0);
      const memberships = await db.adminSql<{ organization_id: string }[]>`
        SELECT organization_id FROM memberships WHERE user_id = ${user!.id}`;
      expect(memberships.map((m) => m.organization_id)).toEqual([orgE]);
      const [accepted] = await db.adminSql<{ accepted_at: Date | null }[]>`
        SELECT accepted_at FROM invitations WHERE email = ${email}`;
      expect(accepted?.accepted_at).not.toBeNull();
    });

    it("opens a session when accepting into a non-enforcing organization", async () => {
      const token = await invite(orgN, "invitee-n@shared.example.invalid");
      const res = await post(enforcing, "/v1/invitations/accept", {
        token,
        name: "Other Invitee",
        password,
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { user: { organizationId: string } };
      expect(body.user.organizationId).toBe(orgN);
    });
  });
});
