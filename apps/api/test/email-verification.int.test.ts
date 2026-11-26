import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createRoleSeparatedDatabase,
  getTestDatabase,
  type RoleSeparatedDatabase,
  type TestDatabase,
} from "@librehr/testing";
import { TokenRepository, hashBearerToken, withTenant } from "@librehr/db";
import { runMigrations } from "@librehr/db/migrate";
import type { MeResponse, ProblemDetails } from "@librehr/contracts";
import { createApp } from "../src/app.js";
import { BetterAuthAdapter } from "../src/adapters/better-auth.js";
import { hashPassword } from "../src/lib/password.js";
import type { MailMessage, MailPort } from "../src/ports/mail.js";
import { isolatedRateLimitStore } from "./support/rate-limit.js";

// AUTH-001 email verification endpoints: the setup wizard admin starts
// unverified and gets a link; a signed-in user can ask for a new one; the
// link confirms the address once, without a session. Soft gate: unverified
// users keep full access. Runs against the restricted runtime role.
describe("email verification (AUTH-001)", () => {
  let base: TestDatabase;
  let db: RoleSeparatedDatabase;
  let app: ReturnType<typeof createApp>;
  let orgA = "";
  let admin = "";

  const orgB = "a9450000-0000-0000-0000-00000000000b";
  const multi = "c9450000-0000-0000-0000-000000000001";
  const solo = "c9450000-0000-0000-0000-000000000002";
  const limited = "c9450000-0000-0000-0000-000000000003";
  const adminB = "c9450000-0000-0000-0000-000000000004";
  const invitee = "c9450000-0000-0000-0000-000000000005";
  const moved = "c9450000-0000-0000-0000-000000000006";
  const adminEmail = "setup-admin@example.invalid";
  const appUrl = "https://hr.example.invalid";
  const password = "verify-password-123";
  const emailOf = (id: string) => `${id.slice(-1)}-verify@example.invalid`;

  const sent: MailMessage[] = [];
  const mailPort: MailPort = {
    async sendMail(message) {
      sent.push(message);
    },
  };

  /** A fresh client IP per call unless one is given. */
  const post = (
    path: string,
    body: unknown,
    headers: Record<string, string> = {},
    target: ReturnType<typeof createApp> = app,
  ) =>
    target.request(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": crypto.randomUUID(),
        ...headers,
      },
      body: JSON.stringify(body),
    });
  const withCookie = (token: string) => ({
    Cookie: `librehr_session=${token}`,
  });
  const signIn = async (
    email: string,
    target: ReturnType<typeof createApp> = app,
  ): Promise<string> => {
    const res = await post("/v1/auth/sign-in", { email, password }, {}, target);
    const match = /librehr_session=([^;]+)/.exec(
      res.headers.get("set-cookie") ?? "",
    );
    if (!match?.[1]) throw new Error(`no session cookie (${res.status})`);
    return match[1];
  };
  const requestLink = (
    session: string,
    body: unknown = {},
    target: ReturnType<typeof createApp> = app,
  ) => post("/v1/auth/email-verification", body, withCookie(session), target);
  const confirm = (token: string, ip?: string) =>
    post(
      "/v1/auth/email-verification/confirm",
      { token },
      ip ? { "X-Forwarded-For": ip } : {},
    );
  const me = async (session: string): Promise<MeResponse> => {
    const res = await app.request("/v1/me", { headers: withCookie(session) });
    expect(res.status).toBe(200);
    return (await res.json()) as MeResponse;
  };
  const verified = async (id: string) => {
    const [row] = await db.adminSql<{ verified: boolean }[]>`
      SELECT email_verified AS verified FROM users WHERE id = ${id}`;
    return row!.verified;
  };

  /** Waits for a verification email to `to` sent after index `after`. */
  const linkSentTo = async (to: string, after: number) => {
    const message = await vi.waitFor(() => {
      const found = sent.slice(after).find((m) => m.to === to);
      if (!found) throw new Error("no verification email yet");
      return found;
    });
    const match = /#token=([A-Za-z0-9_-]+)/.exec(message.html);
    if (!match?.[1]) throw new Error("no token in the verification link");
    return { message, token: match[1] };
  };
  const freshToken = async (session: string, to: string) => {
    const before = sent.length;
    expect((await requestLink(session, { locale: "en" })).status).toBe(202);
    return (await linkSentTo(to, before)).token;
  };
  const codeOf = async (res: Response) =>
    ((await res.json()) as ProblemDetails).code;

  let wizardToken = "";

  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database) throw new Error("Docker is required for auth tests");
    base = database;
    db = await createRoleSeparatedDatabase(base);
    await runMigrations(db.ownerConnectionString);

    app = createApp({
      sql: db.appSql,
      authPort: new BetterAuthAdapter(db.appSql),
      rateLimitStore: isolatedRateLimitStore(db.appSql),
      mailPort,
      sessionSecret: "a-secure-test-secret-with-at-least-32-characters",
      trustProxy: 1,
      config: { appUrl },
    });

    // The first run: the wizard creates org A and its admin.
    const before = sent.length;
    const wizard = await post("/v1/org/setup-wizard", {
      orgName: "Verify A",
      orgSlug: "verify-a",
      adminName: "Setup Admin",
      adminEmail,
      adminPassword: password,
      defaultLocale: "es",
      timezone: "Europe/Madrid",
      legalEntityName: "Verify A SL",
      legalEntityCif: "B00000000",
      locationName: "HQ",
      locationCity: "Barcelona",
      locationRegion: "Catalonia",
    });
    expect(wizard.status).toBe(200);
    orgA = ((await wizard.json()) as { organizationId: string }).organizationId;
    const link = await linkSentTo(adminEmail, before);
    wizardToken = link.token;
    expect(link.message.html).toContain(
      `${appUrl}/es/verify-email#token=${wizardToken}`,
    );
    const [row] = await db.adminSql<{ id: string }[]>`
      SELECT id FROM users WHERE email = ${adminEmail}`;
    admin = row!.id;

    const sql = db.adminSql;
    await sql`INSERT INTO organizations (id, name, slug, timezone)
      VALUES (${orgB}, 'Verify B', 'verify-b', 'Europe/Madrid')`;
    const hash = await hashPassword(password);
    await sql`INSERT INTO users (id, email, name, password_hash) VALUES
      (${multi}, ${emailOf(multi)}, 'Multi Org', ${hash}),
      (${solo}, ${emailOf(solo)}, 'Solo', ${hash}),
      (${limited}, ${emailOf(limited)}, 'Limited', ${hash}),
      (${adminB}, ${emailOf(adminB)}, 'Admin B', ${hash}),
      (${invitee}, ${emailOf(invitee)}, 'Invitee', ${hash}),
      (${moved}, ${emailOf(moved)}, 'Moved', ${hash})`;
    for (const [org, members] of [
      [orgA, [multi, solo, limited, moved]],
      [orgB, [multi, adminB]],
    ] as const) {
      await withTenant(sql, { organizationId: org }, async (tx) => {
        for (const id of members) {
          const role = id === adminB ? "admin" : "employee";
          await tx`INSERT INTO memberships (organization_id, user_id, role)
            VALUES (${org}, ${id}, ${role})`;
        }
      });
    }
  }, 60000);

  afterAll(async () => {
    if (db) await db.close();
    if (base) await base.close();
  });

  describe("setup wizard admin", () => {
    it("starts unverified with full access, then confirms once without a session", async () => {
      expect(await verified(admin)).toBe(false);
      const session = await signIn(adminEmail);
      expect((await me(session)).emailVerified).toBe(false);

      const res = await confirm(wizardToken);
      expect(res.status).toBe(200);
      expect((await me(session)).emailVerified).toBe(true);

      const again = await confirm(wizardToken);
      expect(again.status).toBe(400);
      expect(await codeOf(again)).toBe("VERIFICATION_TOKEN_INVALID");

      const audit = await db.adminSql<{ organization_id: string }[]>`
        SELECT organization_id FROM audit_log
        WHERE action = 'auth.email_verified' AND resource_id = ${admin}`;
      expect(audit.map((a) => a.organization_id)).toEqual([orgA]);
    });

    it("answers 202 and sends nothing once the email is verified", async () => {
      const session = await signIn(adminEmail);
      const before = sent.length;
      expect((await requestLink(session)).status).toBe(202);
      // A link requested afterwards has arrived, so one for the admin would
      // have too.
      await freshToken(await signIn(emailOf(solo)), emailOf(solo));
      expect(sent.slice(before).some((m) => m.to === adminEmail)).toBe(false);
    });
  });

  describe("requesting a link", () => {
    it("requires a session", async () => {
      const res = await post("/v1/auth/email-verification", {});
      expect(res.status).toBe(401);
    });

    it("refuses personal access tokens", async () => {
      const pat = await withTenant(
        db.adminSql,
        { organizationId: orgA, userId: solo },
        (tx) =>
          new TokenRepository().createToken(tx, {
            userId: solo,
            name: "ci",
            scopes: ["read", "write", "admin"],
          }),
      );
      const res = await post(
        "/v1/auth/email-verification",
        {},
        { Authorization: `Bearer ${pat.plainToken}` },
      );
      expect(res.status).toBe(403);
    });

    it("rejects an unsupported locale with 400", async () => {
      const session = await signIn(emailOf(solo));
      const res = await requestLink(session, { locale: "fr" });
      expect(res.status).toBe(400);
    });

    it("emails a localized link in the org locale by default", async () => {
      const session = await signIn(emailOf(moved));
      const before = sent.length;
      expect((await requestLink(session)).status).toBe(202);
      const { message } = await linkSentTo(emailOf(moved), before);
      expect(message.html).toContain(`${appUrl}/es/verify-email#token=`);
    });

    it("spends the earlier link when a new one is requested", async () => {
      const session = await signIn(emailOf(solo));
      const first = await freshToken(session, emailOf(solo));
      const second = await freshToken(session, emailOf(solo));
      expect(await codeOf(await confirm(first))).toBe(
        "VERIFICATION_TOKEN_INVALID",
      );
      expect((await confirm(second)).status).toBe(200);
      expect(await verified(solo)).toBe(true);
    });

    it("limits links per user, and the database cap holds across IPs", async () => {
      const session = await signIn(emailOf(limited));
      const before = sent.length;
      const ip = crypto.randomUUID();
      const statuses: number[] = [];
      for (let i = 0; i < 4; i++) {
        const res = await post(
          "/v1/auth/email-verification",
          {},
          { ...withCookie(session), "X-Forwarded-For": ip },
        );
        statuses.push(res.status);
        if (res.status === 429) {
          expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
        }
      }
      expect(statuses).toEqual([202, 202, 202, 429]);

      // From another IP the request is accepted, but the database cap of 3
      // links per account per hour sends nothing more.
      expect((await requestLink(session)).status).toBe(202);
      await vi.waitFor(async () => {
        const [row] = await db.adminSql<{ count: number }[]>`
          SELECT count(*)::int AS count FROM email_verification_tokens
          WHERE user_id = ${limited}`;
        expect(row!.count).toBe(3);
      });
      await freshToken(await signIn(emailOf(multi)), emailOf(multi));
      expect(
        sent.slice(before).filter((m) => m.to === emailOf(limited)),
      ).toHaveLength(3);
    });

    it("answers 503 when SMTP or APP_URL is not configured", async () => {
      const unconfigured = createApp({
        sql: db.appSql,
        authPort: new BetterAuthAdapter(db.appSql),
        rateLimitStore: isolatedRateLimitStore(db.appSql),
      });
      const session = await signIn(emailOf(multi), unconfigured);
      const res = await requestLink(session, {}, unconfigured);
      expect(res.status).toBe(503);
      expect(await codeOf(res)).toBe("EMAIL_UNAVAILABLE");
    });
  });

  describe("confirming a link", () => {
    it("rejects a malformed body with 400", async () => {
      const res = await post("/v1/auth/email-verification/confirm", {
        token: "short",
      });
      expect(res.status).toBe(400);
      expect(await codeOf(res)).not.toBe("VERIFICATION_TOKEN_INVALID");
    });

    it("rejects an unknown token", async () => {
      const res = await confirm(crypto.randomBytes(32).toString("base64url"));
      expect(res.status).toBe(400);
      expect(await codeOf(res)).toBe("VERIFICATION_TOKEN_INVALID");
    });

    it("rejects an expired link", async () => {
      const token = await freshToken(
        await signIn(emailOf(moved)),
        emailOf(moved),
      );
      await db.adminSql`UPDATE email_verification_tokens
        SET expires_at = now() - interval '1 second'
        WHERE token_hash = ${hashBearerToken(token)}`;
      expect(await codeOf(await confirm(token))).toBe(
        "VERIFICATION_TOKEN_INVALID",
      );
      expect(await verified(moved)).toBe(false);
    });

    it("rejects a link sent to an address the account no longer has", async () => {
      const token = await freshToken(
        await signIn(emailOf(moved)),
        emailOf(moved),
      );
      await db.adminSql`UPDATE users SET email = 'moved-new@example.invalid'
        WHERE id = ${moved}`;
      expect(await codeOf(await confirm(token))).toBe(
        "VERIFICATION_TOKEN_INVALID",
      );
      expect(await verified(moved)).toBe(false);
    });

    it("audits each of the user's organizations with ids only, and no other", async () => {
      const token = await freshToken(
        await signIn(emailOf(multi)),
        emailOf(multi),
      );
      expect((await confirm(token)).status).toBe(200);
      const audit = await db.adminSql<
        { organization_id: string; metadata: unknown }[]
      >`SELECT organization_id, metadata FROM audit_log
        WHERE action = 'auth.email_verified' AND resource_id = ${multi}
        ORDER BY organization_id`;
      expect(audit.map((a) => a.organization_id).sort()).toEqual(
        [orgA, orgB].sort(),
      );
      expect(JSON.stringify(audit)).not.toContain(emailOf(multi));

      // Cross-tenant: org B's admin sees only org B's entries; Solo (org A
      // only) verified earlier and leaves nothing in org B.
      const res = await app.request("/v1/audit", {
        headers: withCookie(await signIn(emailOf(adminB))),
      });
      expect(res.status).toBe(200);
      const visible = JSON.stringify(await res.json());
      expect(visible).toContain(multi);
      expect(visible).not.toContain(solo);
      expect(visible).not.toContain(admin);
    });

    it("rate limits confirmations from one IP", async () => {
      const ip = crypto.randomUUID();
      const statuses: number[] = [];
      for (let i = 0; i < 11; i++) {
        statuses.push(
          (await confirm(crypto.randomBytes(32).toString("base64url"), ip))
            .status,
        );
      }
      expect(statuses.slice(0, 10).every((s) => s === 400)).toBe(true);
      expect(statuses[10]).toBe(429);
    });
  });

  describe("invitation acceptance", () => {
    it("marks an existing unverified account verified", async () => {
      const token = crypto.randomBytes(32).toString("hex");
      await withTenant(
        db.adminSql,
        { organizationId: orgB },
        (tx) =>
          tx`INSERT INTO invitations (email, role, token, expires_at)
          VALUES (${emailOf(invitee)}, 'employee', ${hashBearerToken(token)},
            now() + interval '1 day')`,
      );
      expect(await verified(invitee)).toBe(false);
      const res = await post("/v1/invitations/accept", {
        token,
        name: "Invitee",
        password,
      });
      expect(res.status).toBe(200);
      expect(await verified(invitee)).toBe(true);
    });
  });
});
