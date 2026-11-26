import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createRoleSeparatedDatabase,
  getTestDatabase,
  type RoleSeparatedDatabase,
  type TestDatabase,
} from "@librehr/testing";
import { hashBearerToken, withTenant } from "@librehr/db";
import { runMigrations } from "@librehr/db/migrate";
import { generateTotpSecret } from "@librehr/core";
import type { ProblemDetails } from "@librehr/contracts";
import { createApp } from "../src/app.js";
import { BetterAuthAdapter } from "../src/adapters/better-auth.js";
import { hashPassword } from "../src/lib/password.js";
import type { MailMessage, MailPort } from "../src/ports/mail.js";
import { isolatedRateLimitStore } from "./support/rate-limit.js";

// AUTH-001: password reset. Links expire in 1 h and are single use; the
// request endpoint never reveals whether an account exists; every auth
// endpoint is rate limited. Runs against the restricted runtime role.
describe("password reset (AUTH-001)", () => {
  let base: TestDatabase;
  let db: RoleSeparatedDatabase;
  let app: ReturnType<typeof createApp>;

  const orgA = "a9100000-0000-0000-0000-00000000000a";
  const orgB = "a9100000-0000-0000-0000-00000000000b";
  const user = "c9100000-0000-0000-0000-000000000001";
  const ssoOnly = "c9100000-0000-0000-0000-000000000002";
  const twoFactor = "c9100000-0000-0000-0000-000000000003";
  const capUser = "c9100000-0000-0000-0000-000000000004";
  const unverified = "c9100000-0000-0000-0000-000000000005";
  const appUrl = "https://hr.example.invalid";
  const oldPassword = "old-password-123";
  const newPassword = "new-password-456";
  const emailOf = (id: string) => `${id.slice(-1)}-reset@example.invalid`;

  const sent: MailMessage[] = [];
  const mailPort: MailPort = {
    async sendMail(message) {
      sent.push(message);
    },
  };

  /** A fresh client IP per call, so only the per-account limit applies. */
  const post = (
    path: string,
    body: unknown,
    ip: string = crypto.randomUUID(),
  ) =>
    app.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
      body: JSON.stringify(body),
    });

  const requestReset = (email: string, locale = "en", ip?: string) =>
    post("/v1/auth/password-reset", { email, locale }, ip);
  const confirmReset = (token: string, password: string) =>
    post("/v1/auth/password-reset/confirm", { token, password });
  const signIn = (id: string, password: string) =>
    post("/v1/auth/sign-in", { email: emailOf(id), password });

  /** Waits for a reset email to `to` sent after index `after`; returns its token. */
  const tokenSentTo = async (to: string, after: number): Promise<string> => {
    const message = await vi.waitFor(() => {
      const found = sent.slice(after).find((m) => m.to === to);
      if (!found) throw new Error("no reset email yet");
      return found;
    });
    const match = /#token=([A-Za-z0-9_-]+)/.exec(message.html);
    if (!match?.[1]) throw new Error("no token in the reset link");
    return match[1];
  };

  const freshToken = async (id: string): Promise<string> => {
    const before = sent.length;
    expect((await requestReset(emailOf(id))).status).toBe(202);
    return tokenSentTo(emailOf(id), before);
  };

  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database) throw new Error("Docker is required for auth tests");
    base = database;
    db = await createRoleSeparatedDatabase(base);
    await runMigrations(db.ownerConnectionString);

    const sql = db.adminSql;
    await sql`INSERT INTO organizations (id, name, slug, timezone) VALUES
      (${orgA}, 'Reset A', 'reset-a', 'Europe/Madrid'),
      (${orgB}, 'Reset B', 'reset-b', 'Europe/Madrid')`;
    const hash = await hashPassword(oldPassword);
    // Reset links go only to verified addresses (AUTH-001).
    await sql`INSERT INTO users (id, email, name, password_hash, email_verified)
      VALUES
      (${user}, ${emailOf(user)}, 'Reset User', ${hash}, true),
      (${ssoOnly}, ${emailOf(ssoOnly)}, 'SSO User', NULL, true),
      (${twoFactor}, ${emailOf(twoFactor)}, 'Two Factor', ${hash}, true),
      (${capUser}, ${emailOf(capUser)}, 'Capped', ${hash}, true),
      (${unverified}, ${emailOf(unverified)}, 'Unverified', ${hash}, false)`;
    await sql`UPDATE users SET two_factor_enabled = true,
      two_factor_secret = ${generateTotpSecret()} WHERE id = ${twoFactor}`;
    for (const [org, ids] of [
      [orgA, [user, ssoOnly, twoFactor]],
      [orgB, [user]],
    ] as const) {
      await withTenant(sql, { organizationId: org }, async (tx) => {
        for (const id of ids) {
          await tx`INSERT INTO memberships (organization_id, user_id, role)
            VALUES (${org}, ${id}, 'employee')`;
        }
      });
    }

    app = createApp({
      sql: db.appSql,
      authPort: new BetterAuthAdapter(db.appSql),
      rateLimitStore: isolatedRateLimitStore(db.appSql),
      mailPort,
      sessionSecret: "a-secure-test-secret-with-at-least-32-characters",
      // Honour X-Forwarded-For, so each request can come from its own IP.
      trustProxy: 1,
      config: { appUrl },
      // Tests request many links for one account; the cap has its own test.
      passwordReset: { maxLinksPerAccountPerHour: 1000 },
    });
  }, 60000);

  afterAll(async () => {
    if (db) await db.close();
    if (base) await base.close();
  });

  describe("requesting a reset", () => {
    it("answers 202 for an unknown email and sends nothing", async () => {
      const before = sent.length;
      expect((await requestReset("nobody@example.invalid")).status).toBe(202);
      // Mail for a known account requested afterwards has arrived, so mail
      // for the unknown one would have too.
      await freshToken(user);
      expect(
        sent.slice(before).some((m) => m.to === "nobody@example.invalid"),
      ).toBe(false);
    });

    it("sends nothing to an account without a password (single sign-on only)", async () => {
      const before = sent.length;
      expect((await requestReset(emailOf(ssoOnly))).status).toBe(202);
      await freshToken(user);
      expect(sent.slice(before).some((m) => m.to === emailOf(ssoOnly))).toBe(
        false,
      );
    });

    it("sends nothing to an account whose email is unverified", async () => {
      const before = sent.length;
      expect((await requestReset(emailOf(unverified))).status).toBe(202);
      await freshToken(user);
      expect(sent.slice(before).some((m) => m.to === emailOf(unverified))).toBe(
        false,
      );
      const rows = await db.adminSql`
        SELECT 1 FROM password_reset_tokens WHERE user_id = ${unverified}`;
      expect(rows).toHaveLength(0);
    });

    it("emails an absolute, localized link and stores only the token hash", async () => {
      const before = sent.length;
      expect((await requestReset(emailOf(user), "ca")).status).toBe(202);
      const token = await tokenSentTo(emailOf(user), before);
      const message = sent.slice(before).find((m) => m.to === emailOf(user))!;
      expect(message.html).toContain(
        `${appUrl}/ca/reset-password#token=${token}`,
      );
      expect(message.text).toContain(token);

      const rows = await db.adminSql<{ token_hash: string }[]>`
        SELECT token_hash FROM password_reset_tokens
        WHERE user_id = ${user} AND used_at IS NULL`;
      expect(rows).toHaveLength(1);
      expect(rows[0]!.token_hash).toBe(hashBearerToken(token));
    });

    it("rejects an invalid body with 400", async () => {
      const res = await post("/v1/auth/password-reset", { email: "nope" });
      expect(res.status).toBe(400);
    });

    it("rate limits repeated requests for one account", async () => {
      const ip = crypto.randomUUID();
      const email = "limited@example.invalid";
      const statuses: number[] = [];
      for (let i = 0; i < 6; i++) {
        statuses.push((await requestReset(email, "en", ip)).status);
      }
      expect(statuses.slice(0, 5).every((s) => s === 202)).toBe(true);
      expect(statuses[5]).toBe(429);
    });
  });

  describe("abuse limits", () => {
    it("caps links per account across IPs and still answers 202", async () => {
      const capped = createApp({
        sql: db.appSql,
        authPort: new BetterAuthAdapter(db.appSql),
        rateLimitStore: isolatedRateLimitStore(db.appSql),
        mailPort,
        trustProxy: 1,
        config: { appUrl },
      });
      const before = sent.length;
      for (let i = 0; i < 5; i++) {
        const res = await capped.request("/v1/auth/password-reset", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Forwarded-For": crypto.randomUUID(),
          },
          body: JSON.stringify({ email: emailOf(capUser) }),
        });
        expect(res.status).toBe(202);
      }
      await vi.waitFor(async () => {
        const [row] = await db.adminSql<{ count: number }[]>`
          SELECT count(*)::int AS count FROM password_reset_tokens
          WHERE user_id = ${capUser}`;
        expect(row!.count).toBe(3);
      });
      // A later request for another account has been mailed, so any
      // further mail to the capped account would have been too.
      await freshToken(user);
      expect(
        sent.slice(before).filter((m) => m.to === emailOf(capUser)),
      ).toHaveLength(3);
    });

    it("rate limits confirmations from one IP", async () => {
      const ip = crypto.randomUUID();
      const statuses: number[] = [];
      for (let i = 0; i < 11; i++) {
        statuses.push(
          (
            await post(
              "/v1/auth/password-reset/confirm",
              {
                token: crypto.randomBytes(32).toString("base64url"),
                password: "rate-limit-password",
              },
              ip,
            )
          ).status,
        );
      }
      expect(statuses.slice(0, 10).every((s) => s === 400)).toBe(true);
      expect(statuses[10]).toBe(429);
    });

    it("accepts requests without SMTP or APP_URL but sends and stores nothing", async () => {
      const unconfigured = createApp({
        sql: db.appSql,
        authPort: new BetterAuthAdapter(db.appSql),
        rateLimitStore: isolatedRateLimitStore(db.appSql),
      });
      const [before] = await db.adminSql<{ count: number }[]>`
        SELECT count(*)::int AS count FROM password_reset_tokens`;
      const res = await unconfigured.request("/v1/auth/password-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailOf(user) }),
      });
      expect(res.status).toBe(202);
      const [after] = await db.adminSql<{ count: number }[]>`
        SELECT count(*)::int AS count FROM password_reset_tokens`;
      expect(after!.count).toBe(before!.count);
    });

    it("gives the runtime role no function that maps a bare user id to organizations", async () => {
      // 0021 withdrew such lookups; reset functions are keyed on the token hash.
      const exposed = await db.adminSql<{ name: string }[]>`
        SELECT p.proname AS name FROM pg_proc p
        WHERE p.proname LIKE 'librehr_auth_%'
          AND has_function_privilege('librehr_app', p.oid, 'EXECUTE')
          AND NOT ('text'::regtype = ANY (p.proargtypes::regtype[]))`;
      expect(exposed).toEqual([]);
      const [row] = await db.appSql<{ userId: string | null }[]>`
        SELECT librehr_auth_reset_password(
          ${hashBearerToken("guessed")}, 'not-a-real-hash'
        ) AS "userId"`;
      expect(row!.userId).toBeNull();
    });
  });

  describe("confirming a reset", () => {
    it("sets the new password, revokes every session and audits each organization", async () => {
      expect((await signIn(user, oldPassword)).status).toBe(200);
      const countSessions = async () => {
        const [row] = await db.adminSql<{ count: number }[]>`
          SELECT count(*)::int AS count FROM sessions WHERE user_id = ${user}`;
        return row!.count;
      };
      expect(await countSessions()).toBeGreaterThan(0);

      const token = await freshToken(user);
      expect((await confirmReset(token, newPassword)).status).toBe(200);

      expect(await countSessions()).toBe(0);
      expect((await signIn(user, oldPassword)).status).toBe(401);
      expect((await signIn(user, newPassword)).status).toBe(200);

      const audit = await db.adminSql<
        { organization_id: string; metadata: unknown }[]
      >`SELECT organization_id, metadata FROM audit_log
        WHERE action = 'auth.password_reset' AND resource_id = ${user}
        ORDER BY organization_id`;
      expect(audit.map((a) => a.organization_id)).toEqual([orgA, orgB]);
      expect(JSON.stringify(audit)).not.toContain(emailOf(user));
    });

    it("accepts a link only once", async () => {
      const token = await freshToken(user);
      expect((await confirmReset(token, "another-password-1")).status).toBe(
        200,
      );
      const again = await confirmReset(token, "another-password-2");
      expect(again.status).toBe(400);
      expect(((await again.json()) as ProblemDetails).code).toBe(
        "RESET_TOKEN_INVALID",
      );
    });

    it("rejects an expired link", async () => {
      const token = await freshToken(user);
      await db.adminSql`UPDATE password_reset_tokens
        SET expires_at = now() - interval '1 second'
        WHERE user_id = ${user} AND used_at IS NULL`;
      const res = await confirmReset(token, "expired-password-1");
      expect(res.status).toBe(400);
      expect(((await res.json()) as ProblemDetails).code).toBe(
        "RESET_TOKEN_INVALID",
      );
    });

    it("sets links to expire one hour after the request", async () => {
      await freshToken(user);
      const [row] = await db.adminSql<{ seconds: number }[]>`
        SELECT extract(epoch FROM expires_at - created_at)::int AS seconds
        FROM password_reset_tokens
        WHERE user_id = ${user} AND used_at IS NULL`;
      expect(row!.seconds).toBe(3600);
    });

    it("cancels an earlier link when a new one is requested", async () => {
      const first = await freshToken(user);
      const second = await freshToken(user);
      expect((await confirmReset(first, "first-password-1")).status).toBe(400);
      expect((await confirmReset(second, "second-password-1")).status).toBe(
        200,
      );
    });

    it("rejects an unknown token", async () => {
      const res = await confirmReset(
        crypto.randomBytes(32).toString("base64url"),
        "unknown-password-1",
      );
      expect(res.status).toBe(400);
    });

    it("refuses a too-short password and keeps the link usable", async () => {
      const token = await freshToken(user);
      expect((await confirmReset(token, "short")).status).toBe(400);
      expect((await confirmReset(token, "long-enough-password")).status).toBe(
        200,
      );
    });

    it("revokes the account's personal access tokens in every organization, and no one else's", async () => {
      const insertToken = async (org: string, owner: string) => {
        await withTenant(db.adminSql, { organizationId: org }, async (tx) => {
          await tx`INSERT INTO personal_access_tokens
            (organization_id, user_id, name, token_hash, prefix, scopes)
            VALUES (${org}, ${owner}, 'Integration',
              ${hashBearerToken(crypto.randomUUID())}, 'lhr_test', '[]'::jsonb)`;
        });
      };
      await insertToken(orgA, user);
      await insertToken(orgB, user);
      await insertToken(orgA, twoFactor);

      const token = await freshToken(user);
      expect((await confirmReset(token, "token-revoke-password")).status).toBe(
        200,
      );

      const remaining = await db.adminSql<{ user_id: string }[]>`
        SELECT user_id FROM personal_access_tokens`;
      expect(remaining.map((r) => r.user_id)).toEqual([twoFactor]);

      const [latest] = await db.adminSql<{ metadata: unknown }[]>`
        SELECT metadata FROM audit_log
        WHERE action = 'auth.password_reset' AND resource_id = ${user}
          AND organization_id = ${orgB}
        ORDER BY created_at DESC LIMIT 1`;
      expect(latest!.metadata).toEqual({ revokedTokens: 1 });
    });

    it("deletes reset links older than 30 days when a link is requested", async () => {
      await db.adminSql`INSERT INTO password_reset_tokens
        (user_id, token_hash, expires_at, used_at, created_at)
        VALUES (${twoFactor}, ${hashBearerToken("old-link")},
          now() - interval '31 days' + interval '1 hour',
          now() - interval '31 days', now() - interval '31 days')`;
      expect(
        (await requestReset("nobody-retention@example.invalid")).status,
      ).toBe(202);
      await vi.waitFor(async () => {
        const rows = await db.adminSql`
          SELECT 1 FROM password_reset_tokens
          WHERE token_hash = ${hashBearerToken("old-link")}`;
        expect(rows).toHaveLength(0);
      });
    });

    it("lets only one of two simultaneous confirmations through", async () => {
      const token = await freshToken(user);
      const results = await Promise.all([
        confirmReset(token, "race-password-one"),
        confirmReset(token, "race-password-two"),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
    });

    it("handles a new link request racing a confirmation without errors", async () => {
      const token = await freshToken(user);
      const [requested, confirmed] = await Promise.all([
        requestReset(emailOf(user)),
        confirmReset(token, "racing-password-1"),
      ]);
      expect(requested.status).toBe(202);
      expect([200, 400]).toContain(confirmed.status);
    });

    it("keeps two-factor authentication on after a reset", async () => {
      const token = await freshToken(twoFactor);
      expect((await confirmReset(token, newPassword)).status).toBe(200);
      const res = await signIn(twoFactor, newPassword);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ requiresTwoFactor: true });
    });
  });
});
