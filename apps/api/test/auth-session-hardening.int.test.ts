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
import { generateTotpCode, generateTotpSecret } from "@librehr/core";
import type { ProblemDetails } from "@librehr/contracts";
import { createApp } from "../src/app.js";
import { BetterAuthAdapter } from "../src/adapters/better-auth.js";
import { hashPassword } from "../src/lib/password.js";

// AUTH-001/002/003, EMP-007: cookie-only sessions, CSRF, 2FA lifecycle,
// encrypted TOTP secrets, rate limiting and access revocation at termination,
// against the restricted runtime role.
describe("auth and session hardening", () => {
  let base: TestDatabase;
  let db: RoleSeparatedDatabase;
  let app: ReturnType<typeof createApp>;

  const org = "a9000000-0000-0000-0000-00000000000a";
  const admin = "c9000000-0000-0000-0000-000000000001";
  const leaver = "c9000000-0000-0000-0000-000000000002";
  const futureLeaver = "c9000000-0000-0000-0000-000000000003";
  const twoFactor = "c9000000-0000-0000-0000-000000000004";
  const legacy = "c9000000-0000-0000-0000-000000000005";
  const leaverEmployee = "e9000000-0000-0000-0000-000000000002";
  const futureEmployee = "e9000000-0000-0000-0000-000000000003";
  const password = "hardening-password";
  const sessionSecret = "a-secure-test-secret-with-at-least-32-characters";
  const legacySecret = generateTotpSecret();

  const emailOf = (id: string) => `${id.slice(-1)}-hardening@example.invalid`;

  const post = (
    path: string,
    body: unknown,
    headers: Record<string, string> = {},
    target = app,
  ) =>
    target.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  const cookieOf = (res: Response): string => {
    const match = /librehr_session=([^;]+)/.exec(
      res.headers.get("set-cookie") ?? "",
    );
    if (!match?.[1]) throw new Error("no session cookie");
    return match[1];
  };
  const withCookie = (token: string) => ({
    Cookie: `librehr_session=${token}`,
  });
  const me = (token: string) =>
    app.request("/v1/me", { headers: withCookie(token) });
  const signIn = async (userId: string, extra: Record<string, string> = {}) => {
    const res = await post(
      "/v1/auth/sign-in",
      { email: emailOf(userId), password, ...extra },
      { "X-Forwarded-For": crypto.randomUUID() },
    );
    return res;
  };
  const storedSecret = async (userId: string) => {
    const [row] = await db.adminSql<{ secret: string | null }[]>`
      SELECT two_factor_secret AS secret FROM users WHERE id = ${userId}`;
    return row?.secret ?? null;
  };
  const localDate = async (offsetDays: number) => {
    const [row] = await db.adminSql<{ d: string }[]>`
      SELECT ((now() AT TIME ZONE 'Europe/Madrid')::date + ${offsetDays}::int)::text AS d`;
    return row!.d;
  };

  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database) throw new Error("Docker is required for auth tests");
    base = database;
    db = await createRoleSeparatedDatabase(base);
    await runMigrations(db.ownerConnectionString);

    const sql = db.adminSql;
    await sql`INSERT INTO organizations (id, name, slug, timezone)
      VALUES (${org}, 'Hardening', 'hardening', 'Europe/Madrid')`;
    const hash = await hashPassword(password);
    for (const id of [admin, leaver, futureLeaver, twoFactor, legacy]) {
      await sql`INSERT INTO users (id, email, name, password_hash)
        VALUES (${id}, ${emailOf(id)}, 'Test User', ${hash})`;
    }
    await sql`UPDATE users SET two_factor_enabled = true,
      two_factor_secret = ${legacySecret} WHERE id = ${legacy}`;
    await withTenant(sql, { organizationId: org }, async (tx) => {
      for (const [id, role] of [
        [admin, "admin"],
        [leaver, "employee"],
        [futureLeaver, "employee"],
        [twoFactor, "employee"],
        [legacy, "employee"],
      ] as const) {
        await tx`INSERT INTO memberships (organization_id, user_id, role)
          VALUES (${org}, ${id}, ${role})`;
      }
      await tx`INSERT INTO employees (id, organization_id, user_id, first_name, last_name, email) VALUES
        (${leaverEmployee}, ${org}, ${leaver}, 'Lea', 'Ver', 'lea@example.invalid'),
        (${futureEmployee}, ${org}, ${futureLeaver}, 'Fu', 'Ture', 'fu@example.invalid')`;
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

  describe("session cookie", () => {
    it("sets an httpOnly SameSite=Lax cookie and keeps the token out of the body", async () => {
      const res = await signIn(admin);
      expect(res.status).toBe(200);
      const cookie = res.headers.get("set-cookie") ?? "";
      expect(cookie).toMatch(/librehr_session=[0-9a-f]{64}/);
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Lax/i);
      expect(cookie).toMatch(/Path=\//);
      const maxAge = Number(/Max-Age=(\d+)/.exec(cookie)?.[1]);
      expect(maxAge).toBeGreaterThan(7 * 24 * 3600 - 60);
      expect(maxAge).toBeLessThanOrEqual(7 * 24 * 3600);
      expect(cookie).not.toMatch(/Secure/i);

      const body = (await res.json()) as Record<string, unknown>;
      expect(body).not.toHaveProperty("token");
      expect(JSON.stringify(body)).not.toContain(cookieOf(res));

      expect((await me(cookieOf(res))).status).toBe(200);
    });

    it("marks the cookie Secure in production", async () => {
      const prod = createApp({
        sql: db.appSql,
        authPort: new BetterAuthAdapter(db.appSql),
        sessionSecret,
        nodeEnv: "production",
      });
      const res = await post(
        "/v1/auth/sign-in",
        { email: emailOf(admin), password },
        {},
        prod,
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("set-cookie")).toMatch(/;\s*Secure/i);
    });

    it("signs out by revoking the cookie session server-side and clearing the cookie", async () => {
      const token = cookieOf(await signIn(admin));
      const res = await post("/v1/auth/sign-out", {}, withCookie(token));
      expect(res.status).toBe(200);
      expect(res.headers.get("set-cookie")).toMatch(
        /librehr_session=;.*Max-Age=0/i,
      );
      expect((await me(token)).status).toBe(401);
      const [row] = await db.adminSql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM sessions WHERE token = ${token}`;
      expect(row?.n).toBe(0);
    });
  });

  describe("CSRF", () => {
    it("rejects a cross-origin POST carrying the session cookie", async () => {
      const token = cookieOf(await signIn(admin));
      const evil = await post(
        "/v1/auth/sign-out",
        {},
        { ...withCookie(token), Origin: "https://evil.example" },
      );
      expect(evil.status).toBe(403);
      expect(((await evil.json()) as ProblemDetails).code).toBe(
        "CSRF_REJECTED",
      );

      const crossSite = await post(
        "/v1/auth/sign-out",
        {},
        { ...withCookie(token), "Sec-Fetch-Site": "cross-site" },
      );
      expect(crossSite.status).toBe(403);

      // The session survived both attempts.
      expect((await me(token)).status).toBe(200);

      const fromApp = await post(
        "/v1/auth/sign-out",
        {},
        { ...withCookie(token), Origin: "http://localhost:3000" },
      );
      expect(fromApp.status).toBe(200);
      expect((await me(token)).status).toBe(401);
    });
  });

  describe("two-factor authentication", () => {
    let token: string;
    let secret: string;

    it("enables 2FA and stores the secret encrypted", async () => {
      token = cookieOf(await signIn(twoFactor));
      const setup = (await (
        await post("/v1/auth/2fa/setup", {}, withCookie(token))
      ).json()) as { secret: string; recoveryCodes: string[] };
      secret = setup.secret;

      const res = await post(
        "/v1/auth/2fa/enable",
        {
          secret,
          code: generateTotpCode(secret),
          recoveryCodes: setup.recoveryCodes,
        },
        withCookie(token),
      );
      expect(res.status).toBe(200);

      const stored = await storedSecret(twoFactor);
      expect(stored).not.toBeNull();
      expect(stored).not.toContain(secret);
      expect(JSON.parse(stored!)).toHaveProperty("ciphertext");
    });

    it("refuses to enable 2FA again (409) without overwriting the secret", async () => {
      const before = await storedSecret(twoFactor);
      const other = generateTotpSecret();
      const res = await post(
        "/v1/auth/2fa/enable",
        { secret: other, code: generateTotpCode(other), recoveryCodes: [] },
        withCookie(token),
      );
      expect(res.status).toBe(409);
      expect(((await res.json()) as ProblemDetails).code).toBe(
        "TWO_FACTOR_ALREADY_ENABLED",
      );
      expect(await storedSecret(twoFactor)).toBe(before);
    });

    it("refuses to disable 2FA without a code or with a wrong one", async () => {
      const missing = await post("/v1/auth/2fa/disable", {}, withCookie(token));
      expect(missing.status).toBe(401);
      expect(missing.headers.get("content-type")).toContain(
        "application/problem+json",
      );

      const wrongCode =
        generateTotpCode(secret) === "000000" ? "111111" : "000000";
      const wrong = await post(
        "/v1/auth/2fa/disable",
        { code: wrongCode },
        withCookie(token),
      );
      expect(wrong.status).toBe(401);
      expect(((await wrong.json()) as ProblemDetails).code).toBe(
        "INVALID_2FA_CODE",
      );
      const [row] = await db.adminSql<{ on: boolean }[]>`
        SELECT two_factor_enabled AS on FROM users WHERE id = ${twoFactor}`;
      expect(row?.on).toBe(true);
    });

    it("disables 2FA with a valid code and audit-logs it without secrets", async () => {
      const res = await post(
        "/v1/auth/2fa/disable",
        { code: generateTotpCode(secret) },
        withCookie(token),
      );
      expect(res.status).toBe(200);
      expect(await storedSecret(twoFactor)).toBeNull();

      const entries = await withTenant(
        db.adminSql,
        { organizationId: org },
        (tx) =>
          tx<{ action: string; metadata: unknown }[]>`
          SELECT action, metadata FROM audit_log
          WHERE actor_id = ${twoFactor} AND action LIKE 'auth.2fa.%'
          ORDER BY created_at`,
      );
      expect(entries.map((e) => e.action)).toEqual([
        "auth.2fa.enable",
        "auth.2fa.disable",
      ]);
      expect(JSON.stringify(entries)).not.toContain(secret);
    });

    it("re-encrypts a legacy plaintext secret after a successful verification", async () => {
      expect(await storedSecret(legacy)).toBe(legacySecret);
      const res = await signIn(legacy, {
        twoFactorCode: generateTotpCode(legacySecret),
      });
      expect(res.status).toBe(200);
      const stored = await storedSecret(legacy);
      expect(stored).not.toBe(legacySecret);
      expect(stored).not.toContain(legacySecret);

      // Still verifies after re-encryption.
      const again = await signIn(legacy, {
        twoFactorCode: generateTotpCode(legacySecret),
      });
      expect(again.status).toBe(200);
    });
  });

  describe("termination (EMP-007)", () => {
    it("revokes sessions and tokens at termination and refuses new sign-ins", async () => {
      const token = cookieOf(await signIn(leaver));
      const pat = await withTenant(
        db.adminSql,
        { organizationId: org, userId: leaver },
        (tx) =>
          new TokenRepository().createToken(tx, {
            userId: leaver,
            name: "ci",
            scopes: ["employees:read"],
          }),
      );
      expect((await me(token)).status).toBe(200);

      const adminToken = cookieOf(await signIn(admin));
      const res = await post(
        `/v1/employees/${leaverEmployee}/terminate`,
        { terminationDate: await localDate(0), terminationReason: "other" },
        withCookie(adminToken),
      );
      expect(res.status).toBe(200);

      expect((await me(token)).status).toBe(401);
      const patRes = await app.request("/v1/me", {
        headers: { Authorization: `Bearer ${pat.plainToken}` },
      });
      expect(patRes.status).toBe(401);
      const [left] = await db.adminSql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM sessions WHERE user_id = ${leaver}`;
      expect(left?.n).toBe(0);

      const again = await signIn(leaver);
      expect(again.status).toBe(401);
      expect(again.headers.get("set-cookie")).toBeNull();
    });

    it("enforces a future-dated termination once its date arrives", async () => {
      const token = cookieOf(await signIn(futureLeaver));
      const adminToken = cookieOf(await signIn(admin));
      const res = await post(
        `/v1/employees/${futureEmployee}/terminate`,
        { terminationDate: await localDate(1), terminationReason: "other" },
        withCookie(adminToken),
      );
      expect(res.status).toBe(200);
      // Not yet effective: access continues until the date.
      expect((await me(token)).status).toBe(200);

      // The date arrives (simulated by moving it into the past).
      const yesterday = await localDate(-1);
      await withTenant(
        db.adminSql,
        { organizationId: org },
        (tx) =>
          tx`UPDATE employees SET termination_date = ${yesterday} WHERE id = ${futureEmployee}`,
      );
      expect((await me(token)).status).toBe(401);
      expect((await signIn(futureLeaver)).status).toBe(401);
    });
  });

  describe("rate limiting", () => {
    it("does not reset the sign-in limit when X-Forwarded-For is spoofed (TRUST_PROXY=0)", async () => {
      const limited = createApp({
        sql: db.appSql,
        authPort: new BetterAuthAdapter(db.appSql),
        sessionSecret,
      });
      const statuses: number[] = [];
      for (let i = 0; i < 12; i++) {
        const res = await post(
          "/v1/auth/sign-in",
          { email: emailOf(admin), password: "wrong-password" },
          { "X-Forwarded-For": `198.51.100.${i}` },
          limited,
        );
        statuses.push(res.status);
      }
      expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
      expect(statuses.slice(10)).toEqual([429, 429]);
    });
  });
});
