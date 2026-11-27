import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createRoleSeparatedDatabase,
  getTestDatabase,
  type RoleSeparatedDatabase,
  type TestDatabase,
} from "@librehr/testing";
import { withTenant } from "@librehr/db";
import { runMigrations } from "@librehr/db/migrate";
import { createApp } from "../src/app.js";
import { BetterAuthAdapter } from "../src/adapters/better-auth.js";
import type { ApiExtension } from "../src/extensions/types.js";
import { createChallengeToken } from "../src/lib/two-factor-challenge.js";
import { isolatedRateLimitStore } from "./support/rate-limit.js";

// AUTH-004 (PR 2 of 5): what the API hands a Business extension to finish a
// sign-in. A test extension stands in for ee/ so this runs in Community too.
describe("Extension context for Business sign-in", () => {
  let base: TestDatabase;
  let db: RoleSeparatedDatabase;
  let app: ReturnType<typeof createApp>;

  const orgA = "a8000000-0000-0000-0000-00000000000a";
  const orgB = "b8000000-0000-0000-0000-00000000000b";
  const orgC = "c8000000-0000-0000-0000-00000000000c";
  const member = "d8000000-0000-0000-0000-00000000000d";
  const twoFactorUser = "e8000000-0000-0000-0000-00000000000e";
  const recoveryCodes = ["aaaa-1111", "bbbb-2222"];
  const sessionSecret = "a-secure-test-secret-with-at-least-32-characters";
  const appUrl = "https://hr.example.test";

  const testExtension: ApiExtension = {
    feature: "sso",
    register(router, context) {
      router.post("/test/sign-in", async (c) => {
        const body = (await c.req.json()) as {
          userId: string;
          organizationId: string;
        };
        const result = await context.completeSignIn(c, body);
        return c.json({
          ...result,
          ...("expiresAt" in result
            ? { expiresAt: result.expiresAt.toISOString() }
            : {}),
        });
      });
      router.get(
        "/test/limited",
        context.rateLimit("test.limited", { windowMs: 60_000, max: 1 }),
        (c) => c.json({ ok: true }),
      );
      router.get("/test/fetch", async (c) => {
        const res = await context.oidcHttp({
          method: "GET",
          url: "https://169.254.169.254/latest/meta-data",
        });
        return c.json(res);
      });
      router.get("/test/app-url", (c) => c.json({ appUrl: context.appUrl }));
    },
  };

  const post = (path: string, body: unknown, token?: string) =>
    app.request(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  const cookieToken = (res: Response): string | null =>
    /librehr_session=([^;]+)/.exec(res.headers.get("set-cookie") ?? "")?.[1] ??
    null;
  const authMethodOf = async (token: string) => {
    const [row] = await db.adminSql<{ auth_method: string }[]>`
      SELECT auth_method FROM sessions
      WHERE token = ${crypto.createHash("sha256").update(token).digest("hex")}`;
    return row?.auth_method;
  };
  const meOrg = async (token: string) => {
    const res = await app.request("/v1/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    return ((await res.json()) as { organization: { id: string } }).organization
      .id;
  };

  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database) throw new Error("Docker is required for this suite");
    base = database;
    db = await createRoleSeparatedDatabase(base);
    await runMigrations(db.ownerConnectionString);

    const sql = db.adminSql;
    await sql`INSERT INTO organizations (id, name, slug) VALUES
      (${orgA}, 'Org A', 'ext-ctx-a'), (${orgB}, 'Org B', 'ext-ctx-b'),
      (${orgC}, 'Org C', 'ext-ctx-c')`;
    const hashed = recoveryCodes.map((code) =>
      crypto.createHash("sha256").update(code).digest("hex"),
    );
    await sql`INSERT INTO users (id, email, name) VALUES
      (${member}, 'ext-member@example.invalid', 'Ext Member')`;
    await sql`INSERT INTO users (id, email, name, two_factor_enabled, two_factor_secret, two_factor_recovery_codes)
      VALUES (${twoFactorUser}, 'ext-2fa@example.invalid', 'Ext Two Factor', true,
        'JBSWY3DPEHPK3PXP', ${sql.json(hashed)})`;
    // Org A is each user's default (oldest) membership; sign-in must still
    // land in the organization the extension names.
    for (const [org, createdAt] of [
      [orgA, "2026-01-01T00:00:00Z"],
      [orgB, "2026-02-01T00:00:00Z"],
    ] as const) {
      await withTenant(sql, { organizationId: org }, async (tx) => {
        await tx`INSERT INTO memberships (organization_id, user_id, role, created_at)
          VALUES (${org}, ${member}, 'employee', ${createdAt}),
                 (${org}, ${twoFactorUser}, 'employee', ${createdAt})`;
      });
    }

    // Org B requires SSO with enforcement on (AUTH-004): a session opened
    // through the extension must be an SSO session, or it would be refused.
    await withTenant(sql, { organizationId: orgB }, async (tx) => {
      await tx`INSERT INTO sso_configurations
        (organization_id, provider, client_id, client_secret, issuer_url,
         enabled, enforce_sso, allowed_domains)
        VALUES (${orgB}, 'generic_oidc', 'client', 'stored-secret-value',
          'https://idp.example.invalid', true, true,
          ${tx.json(["example.invalid"])})`;
    });

    app = createApp({
      sql: db.appSql,
      rateLimitStore: isolatedRateLimitStore(db.appSql),
      authPort: new BetterAuthAdapter(db.appSql, { ssoEnforcement: true }),
      sessionSecret,
      extensions: [testExtension],
      config: { appUrl },
    });
  }, 60000);

  afterAll(async () => {
    if (db) await db.close();
    if (base) await base.close();
  });

  it("opens a session pinned to the named organization, not the default", async () => {
    const res = await post("/v1/sso/test/sign-in", {
      userId: member,
      organizationId: orgB,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      outcome: string;
      user: { organizationId: string };
    };
    expect(body).toMatchObject({
      outcome: "signed_in",
      user: { organizationId: orgB },
    });
    expect(body).not.toHaveProperty("token");
    const token = cookieToken(res);
    expect(token).not.toBeNull();
    expect(await meOrg(token!)).toBe(orgB);
    expect(await authMethodOf(token!)).toBe("sso");
  });

  it("opens nothing in an organization the user is not a member of", async () => {
    const res = await post("/v1/sso/test/sign-in", {
      userId: member,
      organizationId: orgC,
    });
    expect(await res.json()).toEqual({ outcome: "no_membership" });
    expect(cookieToken(res)).toBeNull();
  });

  it("opens nothing for an unknown user", async () => {
    const res = await post("/v1/sso/test/sign-in", {
      userId: crypto.randomUUID(),
      organizationId: orgA,
    });
    expect(await res.json()).toEqual({ outcome: "no_membership" });
    expect(cookieToken(res)).toBeNull();
  });

  it("asks a 2FA user for the TOTP step and keeps the organization after it", async () => {
    const res = await post("/v1/sso/test/sign-in", {
      userId: twoFactorUser,
      organizationId: orgB,
    });
    const body = (await res.json()) as {
      outcome: string;
      challengeToken: string;
    };
    expect(body.outcome).toBe("two_factor_required");
    expect(cookieToken(res)).toBeNull();

    const verified = await post("/v1/auth/2fa/verify", {
      challengeToken: body.challengeToken,
      code: recoveryCodes[0],
    });
    expect(verified.status).toBe(200);
    expect(await verified.json()).toMatchObject({
      user: { organizationId: orgB },
    });
    expect(await meOrg(cookieToken(verified)!)).toBe(orgB);
    expect(await authMethodOf(cookieToken(verified)!)).toBe("sso");
  });

  it("refuses a 2FA challenge for an organization the user is not in", async () => {
    const challengeToken = createChallengeToken(
      { userId: twoFactorUser, organizationId: orgC },
      sessionSecret,
    );
    const res = await post("/v1/auth/2fa/verify", {
      challengeToken,
      code: recoveryCodes[1],
    });
    expect(res.status).toBe(401);
    expect(cookieToken(res)).toBeNull();
  });

  it("rate-limits extension routes on the shared store", async () => {
    expect((await app.request("/v1/sso/test/limited")).status).toBe(200);
    const limited = await app.request("/v1/sso/test/limited");
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).not.toBeNull();
  });

  it("refuses provider URLs on internal addresses by default", async () => {
    const res = await app.request("/v1/sso/test/fetch");
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      code: "OUTBOUND_URL_NOT_ALLOWED",
    });
  });

  it("passes APP_URL for redirects after sign-in", async () => {
    const res = await app.request("/v1/sso/test/app-url");
    expect(await res.json()).toEqual({ appUrl });
  });
});
