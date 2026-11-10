import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createRoleSeparatedDatabase,
  getTestDatabase,
  seedScopedOrg,
  type FixturePerson,
  type RoleSeparatedDatabase,
  type ScopedOrgFixture,
  type TestDatabase,
} from "@librehr/testing";
import { InvitationRepository, TokenRepository, withTenant } from "@librehr/db";
import { runMigrations } from "@librehr/db/migrate";
import type { Auditor, ProblemDetails } from "@librehr/contracts";
import { createApp } from "../src/app.js";
import { BetterAuthAdapter } from "../src/adapters/better-auth.js";
import { hashPassword } from "../src/lib/password.js";

const DAY = 24 * 60 * 60 * 1000;
const inDays = (days: number) =>
  new Date(Date.now() + days * DAY).toISOString();

// TIM-008: time-boxed auditor access, exercised through the real session and
// personal access token lookups (BetterAuthAdapter + librehr_auth_* SQL
// functions) against the restricted runtime role.
describe("auditor access expiry (TIM-008)", () => {
  let base: TestDatabase;
  let db: RoleSeparatedDatabase;
  let app: ReturnType<typeof createApp>;
  let a: ScopedOrgFixture;
  let b: ScopedOrgFixture;
  const password = "auditor-access-password";

  const request = (
    method: string,
    path: string,
    token: string,
    body?: unknown,
  ) =>
    app.request(path, {
      method,
      headers: {
        Cookie: `librehr_session=${token}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const signIn = async (person: FixturePerson) => {
    const res = await app.request("/v1/auth/sign-in", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: person.email, password }),
    });
    const match = /librehr_session=([^;]+)/.exec(
      res.headers.get("set-cookie") ?? "",
    );
    return { status: res.status, token: match?.[1] ?? "" };
  };
  const session = async (person: FixturePerson) => {
    const res = await signIn(person);
    expect(res.status).toBe(200);
    return res.token;
  };
  const me = (token: string) => request("GET", "/v1/me", token);
  const meWithPat = (pat: string) =>
    app.request("/v1/me", { headers: { Authorization: `Bearer ${pat}` } });
  const patFor = (person: FixturePerson) =>
    withTenant(
      db.adminSql,
      { organizationId: person.organizationId, userId: person.id },
      async (tx) =>
        (
          await new TokenRepository().createToken(tx, {
            userId: person.id,
            name: "inspection",
            scopes: ["read"],
          })
        ).plainToken,
    );
  const expireNow = (person: FixturePerson) =>
    db.adminSql`UPDATE memberships SET access_expires_at = now() - interval '1 second'
      WHERE user_id = ${person.id} AND organization_id = ${person.organizationId}`;
  const patchAccess = (token: string, userId: string, body: unknown) =>
    request("PATCH", `/v1/auditors/${userId}/access`, token, body);

  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database) throw new Error("Docker is required for this suite");
    base = database;
    db = await createRoleSeparatedDatabase(base);
    await runMigrations(db.ownerConnectionString);
    a = await seedScopedOrg(db.adminSql, "audexp-a");
    b = await seedScopedOrg(db.adminSql, "audexp-b");
    const hash = await hashPassword(password);
    await db.adminSql`UPDATE users SET password_hash = ${hash}`;
    app = createApp({
      sql: db.appSql,
      authPort: new BetterAuthAdapter(db.appSql),
      sessionSecret: "a-secure-test-secret-with-at-least-32-characters",
    });
  }, 90000);

  afterAll(async () => {
    if (db) await db.close();
    if (base) await base.close();
  });

  describe("expiry through the real lookups", () => {
    it("refuses an expired auditor's session, token and sign-in, and restores them on extension", async () => {
      const auditorToken = await session(a.auditor);
      const pat = await patFor(a.auditor);
      expect((await me(auditorToken)).status).toBe(200);
      expect((await meWithPat(pat)).status).toBe(200);

      await expireNow(a.auditor);
      expect((await me(auditorToken)).status).toBe(401);
      expect((await meWithPat(pat)).status).toBe(401);
      expect((await signIn(a.auditor)).status).toBe(401);

      const adminToken = await session(a.admin);
      const res = await patchAccess(adminToken, a.auditor.id, {
        accessExpiresAt: inDays(10),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as Auditor;
      expect(body.userId).toBe(a.auditor.id);
      expect(new Date(body.accessExpiresAt!).getTime()).toBeGreaterThan(
        Date.now(),
      );

      expect((await me(auditorToken)).status).toBe(200);
      expect((await meWithPat(pat)).status).toBe(200);
    });

    it("revokes immediately and deletes the auditor's sessions and tokens here", async () => {
      const auditorToken = await session(a.auditor);
      const pat = await patFor(a.auditor);
      const adminToken = await session(a.admin);

      const res = await patchAccess(adminToken, a.auditor.id, { revoke: true });
      expect(res.status).toBe(200);
      expect((await me(auditorToken)).status).toBe(401);
      expect((await meWithPat(pat)).status).toBe(401);
      const [left] = await db.adminSql<{ sessions: number; tokens: number }[]>`
        SELECT (SELECT count(*)::int FROM sessions WHERE user_id = ${a.auditor.id}) AS sessions,
               (SELECT count(*)::int FROM personal_access_tokens
                 WHERE user_id = ${a.auditor.id} AND organization_id = ${a.orgId}) AS tokens`;
      expect(left).toEqual({ sessions: 0, tokens: 0 });
      expect((await signIn(a.auditor)).status).toBe(401);

      const rows = await withTenant(
        db.adminSql,
        { organizationId: a.orgId },
        (tx) => tx<
          { actorId: string; resourceType: string; metadata: unknown }[]
        >`
          SELECT actor_id::text AS "actorId", resource_type AS "resourceType", metadata
          FROM audit_log
          WHERE action = 'membership.access_update' AND resource_id = ${a.auditor.id}
          ORDER BY created_at`,
      );
      expect(rows).toHaveLength(2);
      expect(rows[1]).toMatchObject({
        actorId: a.admin.id,
        resourceType: "membership",
        metadata: { revoked: true },
      });
      expect(rows[0]?.metadata).toMatchObject({ revoked: false });
      for (const row of rows) {
        const text = JSON.stringify(row.metadata);
        expect(text).not.toContain("@");
        expect(text).not.toContain(a.auditor.name);
        expect(Object.keys(row.metadata as object).sort()).toEqual([
          "newExpiresAt",
          "previousExpiresAt",
          "revoked",
        ]);
      }
    });
  });

  describe("GET /v1/auditors and PATCH /v1/auditors/:userId/access", () => {
    it("requires authentication", async () => {
      expect((await app.request("/v1/auditors")).status).toBe(401);
    });

    it("forbids non-admins", async () => {
      for (const person of [a.manager, a.peer]) {
        const token = await session(person);
        expect((await request("GET", "/v1/auditors", token)).status).toBe(403);
        expect(
          (
            await patchAccess(token, b.auditor.id, {
              accessExpiresAt: inDays(5),
            })
          ).status,
        ).toBe(403);
      }
    });

    it("lists only the organization's auditors", async () => {
      const token = await session(b.admin);
      const res = await request("GET", "/v1/auditors", token);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: Auditor[] };
      expect(body.items.map((i) => i.userId)).toEqual([b.auditor.id]);
      expect(body.items[0]?.accessExpiresAt).not.toBeNull();
    });

    it("answers 404 for another organization's auditor and for non-auditors", async () => {
      const token = await session(b.admin);
      for (const userId of [a.auditor.id, b.peer.id, crypto.randomUUID()]) {
        const res = await patchAccess(token, userId, {
          accessExpiresAt: inDays(5),
        });
        expect(res.status).toBe(404);
      }
      expect(
        (await patchAccess(token, "not-a-uuid", { revoke: true })).status,
      ).toBe(404);
    });

    it("rejects end dates in the past or beyond the organization's maximum", async () => {
      const token = await session(b.admin);
      const past = await patchAccess(token, b.auditor.id, {
        accessExpiresAt: inDays(-1),
      });
      expect(past.status).toBe(400);
      expect(((await past.json()) as ProblemDetails).code).toBe(
        "AUDITOR_ACCESS_END_IN_PAST",
      );
      const far = await patchAccess(token, b.auditor.id, {
        accessExpiresAt: inDays(91),
      });
      expect(far.status).toBe(400);
      expect(far.headers.get("content-type")).toContain(
        "application/problem+json",
      );
      expect(((await far.json()) as ProblemDetails).code).toBe(
        "AUDITOR_ACCESS_END_TOO_FAR",
      );
      expect(
        (await patchAccess(token, b.auditor.id, { revoke: false })).status,
      ).toBe(400);
    });

    it("applies the maximum set in the organization settings, audit-logged", async () => {
      const token = await session(b.admin);
      const settings = await request("PATCH", "/v1/settings/security", token, {
        auditorAccessMaxDays: 120,
      });
      expect(settings.status).toBe(200);
      expect(await settings.json()).toEqual({
        requireTwoFactor: false,
        auditorAccessMaxDays: 120,
      });
      expect(
        (
          await patchAccess(token, b.auditor.id, {
            accessExpiresAt: inDays(110),
          })
        ).status,
      ).toBe(200);
      const [entry] = await withTenant(
        db.adminSql,
        { organizationId: b.orgId },
        (tx) => tx<{ metadata: unknown }[]>`
          SELECT metadata FROM audit_log
          WHERE action = 'organization.security_updated'`,
      );
      expect(entry?.metadata).toEqual({ auditorAccessMaxDays: 120 });
      expect(
        (
          await request("PATCH", "/v1/settings/security", token, {
            auditorAccessMaxDays: 367,
          })
        ).status,
      ).toBe(400);
    });
  });

  describe("auditor invitations", () => {
    const invite = (token: string, body: unknown) =>
      request("POST", "/v1/invitations", token, body);

    it("requires a future end date within the maximum for auditors only", async () => {
      const token = await session(a.admin);
      const email = "inspector@example.invalid";
      const cases: [unknown, number][] = [
        [{ email, role: "auditor" }, 400],
        [{ email, role: "auditor", accessExpiresAt: inDays(-1) }, 400],
        [{ email, role: "auditor", accessExpiresAt: inDays(91) }, 400],
        [{ email, role: "employee", accessExpiresAt: inDays(5) }, 400],
      ];
      for (const [body, status] of cases) {
        expect((await invite(token, body)).status).toBe(status);
      }

      const end = inDays(30);
      const res = await invite(token, {
        email,
        role: "auditor",
        accessExpiresAt: end,
      });
      expect(res.status).toBe(201);
      const created = (await res.json()) as {
        id: string;
        accessExpiresAt: string;
      };
      expect(new Date(created.accessExpiresAt).toISOString()).toBe(end);

      const [entry] = await withTenant(
        db.adminSql,
        { organizationId: a.orgId },
        (tx) => tx<{ metadata: Record<string, unknown> }[]>`
          SELECT metadata FROM audit_log
          WHERE action = 'invitation.create' AND resource_id = ${created.id}`,
      );
      expect(entry?.metadata).toEqual({
        role: "auditor",
        accessExpiresAt: end,
      });
      expect(JSON.stringify(entry?.metadata)).not.toContain("@");
    });

    it("copies the end date to the membership on acceptance and refuses a lapsed one", async () => {
      const create = (email: string, accessExpiresAt: Date) =>
        withTenant(db.adminSql, { organizationId: a.orgId }, (tx) =>
          new InvitationRepository().create(tx, {
            email,
            role: "auditor",
            accessExpiresAt,
          }),
        );
      const accept = (token: string) =>
        app.request("/v1/invitations/accept", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, name: "Inspector", password }),
        });

      const lapsed = await create(
        "lapsed@example.invalid",
        new Date(Date.now() - 1000),
      );
      expect((await accept(lapsed.token)).status).toBe(400);

      const end = new Date(Date.now() + 20 * DAY);
      const fresh = await create("fresh@example.invalid", end);
      expect((await accept(fresh.token)).status).toBe(200);
      const [row] = await db.adminSql<{ role: string; at: Date }[]>`
        SELECT m.role, m.access_expires_at AS at
        FROM memberships m JOIN users u ON u.id = m.user_id
        WHERE u.email = 'fresh@example.invalid' AND m.organization_id = ${a.orgId}`;
      expect(row?.role).toBe("auditor");
      expect(row?.at.getTime()).toBe(end.getTime());
    });
  });
});
