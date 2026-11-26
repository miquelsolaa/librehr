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
import { createApp, type AppConfig } from "../src/app.js";
import { BetterAuthAdapter } from "../src/adapters/better-auth.js";
import {
  businessEdition,
  hasBusinessEdition,
} from "./support/business-edition.js";
import { FakeOidcProvider } from "./support/fake-oidc-provider.js";
import { isolatedRateLimitStore } from "./support/rate-limit.js";

// AUTH-004 (PR 4 of 5): authorize with state/nonce/PKCE and the OIDC
// callback, against an in-process provider injected as `oidcHttp`.
describe.skipIf(!hasBusinessEdition)("SSO sign-in callback (AUTH-004)", () => {
  let base: TestDatabase;
  let db: RoleSeparatedDatabase;
  let app: ReturnType<typeof createApp>;

  const orgA = "a9000000-0000-0000-0000-00000000000a";
  const orgB = "b9000000-0000-0000-0000-00000000000b";
  const member = "c9000000-0000-0000-0000-00000000000c";
  const twoFactorUser = "d9000000-0000-0000-0000-00000000000d";
  const outsider = "e9000000-0000-0000-0000-00000000000e";
  const admin = "f9000000-0000-0000-0000-00000000000f";
  const recoveryCode = "cccc-3333";
  const sessionSecret = "a-secure-test-secret-with-at-least-32-characters";
  const appUrl = "https://hr.example.test";
  const publicApiUrl = "https://api.hr.example.test";
  const idp = new FakeOidcProvider(
    "https://idp.example.test/realms/a",
    "client-a",
    "secret-a",
  );
  const edition = businessEdition();

  const build = (config: Partial<AppConfig> = {}) =>
    createApp({
      sql: db.appSql,
      rateLimitStore: isolatedRateLimitStore(db.appSql),
      authPort: new BetterAuthAdapter(db.appSql),
      sessionSecret,
      license: edition.license,
      extensions: edition.extensions,
      config: {
        appUrl,
        publicApiUrl,
        ssoEnabled: true,
        oidcHttp: idp.http,
        ...config,
      },
    });
  const cookie = (res: Response, name: string) =>
    new RegExp(`${name}=([^;]*)`).exec(
      res.headers.get("set-cookie") ?? "",
    )?.[1];

  /** POST /authorize; returns the provider URL and the state cookie. */
  const start = async (locale?: string) => {
    const res = await app.request("/v1/sso/authorize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "x@a.example.test", locale }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { authorizationUrl: string };
    return {
      res,
      body,
      url: body.authorizationUrl,
      stateCookie: cookie(res, "librehr_sso_state")!,
    };
  };
  const callback = (query: Record<string, string>, stateCookie?: string) =>
    app.request(`/v1/sso/callback?${new URLSearchParams(query).toString()}`, {
      headers: stateCookie
        ? { Cookie: `librehr_sso_state=${stateCookie}` }
        : {},
    });
  /** The whole round trip for a person the provider signs in. */
  const signIn = async (claims: Record<string, unknown>, locale?: string) => {
    const { url, stateCookie } = await start(locale);
    return callback(idp.approve(url, claims), stateCookie);
  };
  const ssoError = (res: Response) =>
    new URL(res.headers.get("location") ?? "").searchParams.get("sso_error");
  const auditRows = (action: string) =>
    db.adminSql<{ actor_id: string | null; metadata: unknown }[]>`
      SELECT actor_id, metadata FROM audit_log
      WHERE organization_id = ${orgA} AND action = ${action}
      ORDER BY created_at`;

  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database) throw new Error("Docker is required for this suite");
    base = database;
    db = await createRoleSeparatedDatabase(base);
    await runMigrations(db.ownerConnectionString);

    const sql = db.adminSql;
    await sql`INSERT INTO organizations (id, name, slug) VALUES
      (${orgA}, 'Org A', 'sso-cb-a'), (${orgB}, 'Org B', 'sso-cb-b')`;
    const hashed = crypto
      .createHash("sha256")
      .update(recoveryCode)
      .digest("hex");
    await sql`INSERT INTO users (id, email, name) VALUES
      (${member}, 'member@a.example.test', 'Member'),
      (${outsider}, 'outsider@a.example.test', 'Outsider'),
      (${admin}, 'admin@a.example.test', 'Admin')`;
    await sql`INSERT INTO users (id, email, name, two_factor_enabled, two_factor_secret, two_factor_recovery_codes)
      VALUES (${twoFactorUser}, '2fa@a.example.test', 'Two Factor', true,
        'JBSWY3DPEHPK3PXP', ${sql.json([hashed])})`;
    await withTenant(sql, { organizationId: orgA }, async (tx) => {
      await tx`INSERT INTO memberships (organization_id, user_id, role) VALUES
        (${orgA}, ${member}, 'employee'), (${orgA}, ${twoFactorUser}, 'employee'),
        (${orgA}, ${admin}, 'admin')`;
    });
    // The outsider's email is in org A's domain, but only org B has them.
    await withTenant(sql, { organizationId: orgB }, async (tx) => {
      await tx`INSERT INTO memberships (organization_id, user_id, role)
        VALUES (${orgB}, ${outsider}, 'employee')`;
    });
    await sql`INSERT INTO sso_configurations
      (organization_id, provider, client_id, client_secret, issuer_url,
       enabled, enforce_sso, allowed_domains)
      VALUES (${orgA}, 'generic_oidc', 'client-a', 'secret-a', ${idp.issuer},
       true, false, ${sql.json(["a.example.test"])})`;
    app = build();
  }, 60000);

  afterAll(async () => {
    if (db) await db.close();
    if (base) await base.close();
  });

  it("starts a PKCE flow and keeps state out of the response body", async () => {
    const { res, body, url, stateCookie } = await start();
    expect(Object.keys(body)).toEqual(["authorizationUrl"]);
    const params = new URL(url).searchParams;
    expect(url.startsWith(`${idp.issuer}/authorize?`)).toBe(true);
    expect(params.get("code_challenge_method")).toBe("S256");
    expect(params.get("code_challenge")).toMatch(/^[\w-]{43}$/);
    expect(params.get("nonce")).toMatch(/^[\w-]{43}$/);
    expect(params.get("redirect_uri")).toBe(`${publicApiUrl}/v1/sso/callback`);
    expect(params.get("state")).toBe(stateCookie);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Path=\/v1\/sso\/callback/);
    expect(setCookie).toMatch(/SameSite=Lax/i);
  });

  it("signs a member in, pinned to the configuration's organization", async () => {
    const res = await signIn(
      { sub: "sub-member", email: "member@a.example.test" },
      "es",
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${appUrl}/es/sso/complete`);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    const token = cookie(res, "librehr_session");
    expect(token).toBeTruthy();
    const me = await app.request("/v1/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(
      ((await me.json()) as { organization: { id: string } }).organization.id,
    ).toBe(orgA);

    const audit = await auditRows("auth.sso.sign_in");
    expect(audit).toHaveLength(1);
    expect(audit[0]).toEqual({
      actor_id: member,
      metadata: { provider: "generic_oidc", step: "session" },
    });
    // Later sign-ins match the linked subject.
    const again = await signIn({
      sub: "sub-member",
      email: "member@a.example.test",
    });
    expect(again.headers.get("location")).toBe(`${appUrl}/ca/sso/complete`);
  });

  it("refuses a callback without this browser's state cookie, without spending it", async () => {
    const { url, stateCookie } = await start();
    const query = idp.approve(url, {
      sub: "sub-member",
      email: "member@a.example.test",
    });
    expect(ssoError(await callback(query))).toBe("SSO_STATE_INVALID");
    expect(ssoError(await callback(query, "forged-state"))).toBe(
      "SSO_STATE_INVALID",
    );
    const res = await callback(query, stateCookie);
    expect(res.headers.get("location")).toBe(`${appUrl}/ca/sso/complete`);
    // Replaying the finished callback is refused.
    const replay = await callback(query, stateCookie);
    expect(ssoError(replay)).toBe("SSO_STATE_INVALID");
    expect(cookie(replay, "librehr_session")).toBeUndefined();
  });

  it("refuses an expired request", async () => {
    const { url, stateCookie } = await start("en");
    await db.adminSql`UPDATE sso_login_requests SET expires_at = now() - interval '1 second'
      WHERE consumed_at IS NULL`;
    const res = await callback(idp.approve(url, { sub: "s" }), stateCookie);
    expect(res.headers.get("location")).toBe(
      `${appUrl}/en/sign-in?sso_error=SSO_EXPIRED`,
    );
  });

  it("reports a provider error without echoing its text, and audits it", async () => {
    const { url, stateCookie } = await start();
    const { state } = idp.approve(url, {});
    const res = await callback(
      { state, error: "access_denied", error_description: "<script>" },
      stateCookie,
    );
    expect(res.headers.get("location")).toBe(
      `${appUrl}/ca/sign-in?sso_error=SSO_PROVIDER_ERROR`,
    );
    const audit = await auditRows("auth.sso.sign_in_failed");
    expect(audit.at(-1)).toEqual({
      actor_id: null,
      metadata: { reason: "provider_error", provider: "generic_oidc" },
    });
  });

  it("refuses a failed code exchange", async () => {
    idp.tokenStatus = 500;
    try {
      const res = await signIn({
        sub: "sub-member",
        email: "member@a.example.test",
      });
      expect(ssoError(res)).toBe("SSO_EXCHANGE_FAILED");
    } finally {
      idp.tokenStatus = 200;
    }
  });

  it.each([
    ["a nonce mismatch", { nonce: "other" }, "SSO_TOKEN_INVALID"],
    ["a bad signature", { foreignKey: true }, "SSO_TOKEN_INVALID"],
    ["another audience", { aud: "client-b" }, "SSO_TOKEN_INVALID"],
    [
      "an unverified email",
      { email_verified: false },
      "SSO_EMAIL_NOT_VERIFIED",
    ],
  ])("refuses %s", async (_, claims, code) => {
    const res = await signIn({
      sub: "sub-member",
      email: "member@a.example.test",
      ...claims,
    });
    expect(ssoError(res)).toBe(code);
    expect(cookie(res, "librehr_session")).toBeUndefined();
  });

  it.each([
    [
      "an email outside the allowed domains",
      "member@b.example.test",
      "SSO_DOMAIN_NOT_ALLOWED",
    ],
    ["an email with no account", "nobody@a.example.test", "SSO_NO_ACCOUNT"],
    // Cross-tenant: a member of org B only never gets a session in org A.
    [
      "a member of another organization only",
      "outsider@a.example.test",
      "SSO_NO_ACCOUNT",
    ],
  ])("refuses %s", async (_, email, code) => {
    const res = await signIn({ sub: `sub-${email}`, email });
    expect(ssoError(res)).toBe(code);
    expect(cookie(res, "librehr_session")).toBeUndefined();
  });

  it("refuses a second subject for an already linked member", async () => {
    const res = await signIn({
      sub: "sub-other",
      email: "member@a.example.test",
    });
    expect(ssoError(res)).toBe("SSO_IDENTITY_CONFLICT");
  });

  it("asks a 2FA user for the TOTP step, in the URL fragment", async () => {
    const res = await signIn({ sub: "sub-2fa", email: "2fa@a.example.test" });
    expect(cookie(res, "librehr_session")).toBeUndefined();
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.pathname).toBe("/ca/sign-in");
    expect(location.search).toBe("");
    const challengeToken = decodeURIComponent(
      location.hash.replace("#sso_challenge=", ""),
    );
    const verified = await app.request("/v1/auth/2fa/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ challengeToken, code: recoveryCode }),
    });
    expect(verified.status).toBe(200);
    expect(await verified.json()).toMatchObject({
      user: { organizationId: orgA },
    });
  });

  it("rate-limits the callback", async () => {
    const limited = build();
    let status = 0;
    for (let i = 0; i < 31; i += 1) {
      status = (await limited.request("/v1/sso/callback")).status;
    }
    expect(status).toBe(429);
  });

  describe("configuration", () => {
    let adminToken: string;
    const save = (target: ReturnType<typeof createApp>, issuerUrl: string) =>
      target.request("/v1/sso/config", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          provider: "generic_oidc",
          clientId: "client-a",
          issuerUrl,
          enabled: true,
          allowedDomains: ["a.example.test"],
        }),
      });
    const issuerError = async (res: Response) => {
      expect(res.status).toBe(400);
      const body = (await res.json()) as { errors: { field: string }[] };
      return body.errors.map((e) => e.field);
    };

    beforeAll(async () => {
      const session = await new BetterAuthAdapter(db.appSql).createSession({
        id: admin,
        email: "admin@a.example.test",
        name: "Admin",
        organizationId: orgA,
        twoFactorEnabled: false,
      });
      adminToken = session!.token;
    });

    it("shows the redirect URI the API sends", async () => {
      const res = await app.request("/v1/sso/config", {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(await res.json()).toMatchObject({
        redirectUri: `${publicApiUrl}/v1/sso/callback`,
      });
    });

    it("refuses a Microsoft multi-tenant or plain-http issuer", async () => {
      for (const issuer of [
        "https://login.microsoftonline.com/common/v2.0",
        "http://idp.example.test/realms/a",
      ]) {
        expect(await issuerError(await save(app, issuer))).toEqual([
          "issuerUrl",
        ]);
      }
    });

    it("refuses an issuer on an internal address (SSRF guard)", async () => {
      const guarded = build({
        oidcHttp: undefined,
        resolveHost: async () => ["169.254.169.254"],
      });
      expect(
        await issuerError(await save(guarded, "https://idp.internal.test")),
      ).toEqual(["issuerUrl"]);
    });
  });
});
