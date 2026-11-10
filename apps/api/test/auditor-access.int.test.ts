import crypto from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createRoleSeparatedDatabase,
  getTestDatabase,
  seedScopedOrg,
  type FixturePerson,
  type RoleSeparatedDatabase,
  type ScopedOrgFixture,
  type TestDatabase,
} from "@librehr/testing";
import {
  InvitationRepository,
  TokenRepository,
  hashBearerToken,
  withTenant,
} from "@librehr/db";
import { runMigrations } from "@librehr/db/migrate";
import type {
  Auditor,
  AuditorListResponse,
  ProblemDetails,
} from "@librehr/contracts";
import { createApp } from "../src/app.js";
import { BetterAuthAdapter } from "../src/adapters/better-auth.js";
import { hashPassword } from "../src/lib/password.js";

// TIM-008: time-boxed auditor access, exercised through the real session and
// personal access token lookups (BetterAuthAdapter + librehr_auth_* SQL
// functions) against the restricted runtime role. Every test starts from the
// same auditor state (beforeEach), so the order of tests does not matter.
describe("auditor access expiry (TIM-008)", () => {
  let base: TestDatabase;
  let db: RoleSeparatedDatabase;
  let app: ReturnType<typeof createApp>;
  let a: ScopedOrgFixture;
  let b: ScopedOrgFixture;
  let c: ScopedOrgFixture;
  const password = "auditor-access-password";
  const sessions = new Map<string, string>();

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
  const signIn = async (email: string) => {
    const res = await app.request("/v1/auth/sign-in", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const match = /librehr_session=([^;]+)/.exec(
      res.headers.get("set-cookie") ?? "",
    );
    return { status: res.status, token: match?.[1] ?? "" };
  };
  /** A session cookie; admins' sessions are reused (sign-in is rate limited). */
  const session = async (person: FixturePerson) => {
    const cached =
      person.role === "auditor" ? undefined : sessions.get(person.id);
    if (cached) return cached;
    const res = await signIn(person.email);
    expect(res.status).toBe(200);
    sessions.set(person.id, res.token);
    return res.token;
  };
  const me = (token: string) => request("GET", "/v1/me", token);
  const meWithPat = (pat: string) =>
    app.request("/v1/me", { headers: { Authorization: `Bearer ${pat}` } });
  const patFor = (userId: string, orgId: string, scopes = ["read"]) =>
    withTenant(
      db.adminSql,
      { organizationId: orgId, userId },
      async (tx) =>
        (
          await new TokenRepository().createToken(tx, {
            userId,
            name: "inspection",
            scopes,
          })
        ).plainToken,
    );
  /** `YYYY-MM-DD` in the organization's zone (Europe/Madrid), DB clock. */
  const localDay = async (offset: number) => {
    const [row] = await db.adminSql<{ d: string }[]>`
      SELECT ((now() AT TIME ZONE 'Europe/Madrid')::date + ${offset}::int)::text AS d`;
    return row!.d;
  };
  const patchAccess = (token: string, userId: string, body: unknown) =>
    request("PATCH", `/v1/auditors/${userId}/access`, token, body);
  const membershipOf = async (userId: string, orgId: string) => {
    const [row] = await db.adminSql<
      { role: string; at: Date | null; updatedAt: Date }[]
    >`
      SELECT role, access_expires_at AS at, updated_at AS "updatedAt"
      FROM memberships WHERE user_id = ${userId} AND organization_id = ${orgId}`;
    return row;
  };
  const createInvite = (
    orgId: string,
    email: string,
    role: string,
    at: Date | null,
  ) =>
    withTenant(db.adminSql, { organizationId: orgId }, (tx) =>
      new InvitationRepository().create(tx, {
        email,
        role,
        accessExpiresAt: at,
      }),
    );
  const accept = (token: string) =>
    app.request("/v1/invitations/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, name: "Fixture Person", password }),
    });
  const auditLog = (orgId: string, action: string) =>
    withTenant(
      db.adminSql,
      { organizationId: orgId },
      (tx) =>
        tx<
          {
            actorId: string;
            resourceId: string;
            metadata: Record<string, unknown>;
          }[]
        >`
        SELECT actor_id::text AS "actorId", resource_id::text AS "resourceId", metadata
        FROM audit_log WHERE action = ${action} ORDER BY created_at`,
    );

  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database) throw new Error("Docker is required for this suite");
    base = database;
    db = await createRoleSeparatedDatabase(base);
    await runMigrations(db.ownerConnectionString);
    a = await seedScopedOrg(db.adminSql, "audexp-a");
    b = await seedScopedOrg(db.adminSql, "audexp-b");
    c = await seedScopedOrg(db.adminSql, "audexp-c");
    const hash = await hashPassword(password);
    await db.adminSql`UPDATE users SET password_hash = ${hash}`;
    app = createApp({
      sql: db.appSql,
      authPort: new BetterAuthAdapter(db.appSql),
      sessionSecret: "a-secure-test-secret-with-at-least-32-characters",
    });
  }, 90000);

  beforeEach(async () => {
    await db.adminSql`
      UPDATE memberships SET access_expires_at = now() + interval '30 days', updated_at = now()
      WHERE user_id IN (${a.auditor.id}, ${b.auditor.id})`;
    await db.adminSql`
      UPDATE organizations SET auditor_access_max_days = 90
      WHERE id IN (${a.orgId}, ${b.orgId}, ${c.orgId})`;
  });

  afterAll(async () => {
    if (db) await db.close();
    if (base) await base.close();
  });

  describe("expiry through the real lookups", () => {
    it("refuses an expired auditor's session, token and sign-in, and restores them on extension", async () => {
      const auditorToken = await session(a.auditor);
      const pat = await patFor(a.auditor.id, a.orgId);
      expect((await me(auditorToken)).status).toBe(200);
      expect((await meWithPat(pat)).status).toBe(200);

      await db.adminSql`UPDATE memberships SET access_expires_at = now() - interval '1 second'
        WHERE user_id = ${a.auditor.id}`;
      expect((await me(auditorToken)).status).toBe(401);
      expect((await meWithPat(pat)).status).toBe(401);
      expect((await signIn(a.auditor.email)).status).toBe(401);

      const until = await localDay(10);
      const res = await patchAccess(await session(a.admin), a.auditor.id, {
        accessUntil: until,
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as Auditor;
      expect(body).toMatchObject({ userId: a.auditor.id, accessUntil: until });

      expect((await me(auditorToken)).status).toBe(200);
      expect((await meWithPat(pat)).status).toBe(200);
    });

    it("ends access at the local midnight after the chosen day", async () => {
      const until = await localDay(5);
      const res = await patchAccess(await session(a.admin), a.auditor.id, {
        accessUntil: until,
      });
      const body = (await res.json()) as Auditor;
      const [row] = await db.adminSql<{ at: string }[]>`
        SELECT ((${until}::date + 1)::timestamp AT TIME ZONE 'Europe/Madrid')::text AS at`;
      expect(new Date(body.accessExpiresAt).getTime()).toBe(
        new Date(row!.at).getTime(),
      );
    });

    it("revokes immediately, deleting sessions and tokens here only", async () => {
      // A user who is an auditor in A and an employee in B.
      const dual = crypto.randomUUID();
      const email = `dual-${dual.slice(0, 8)}@fixture.invalid`;
      await db.adminSql`INSERT INTO users (id, email, name, password_hash)
        VALUES (${dual}, ${email}, 'Fixture dual', ${await hashPassword(password)})`;
      await db.adminSql`INSERT INTO memberships (organization_id, user_id, role, access_expires_at)
        VALUES (${a.orgId}, ${dual}, 'auditor', now() + interval '10 days'),
               (${b.orgId}, ${dual}, 'employee', NULL)`;
      const raw = () => crypto.randomBytes(32).toString("hex");
      const [inA, inB, unbound] = [raw(), raw(), raw()];
      for (const [token, orgId] of [
        [inA, a.orgId],
        [inB, b.orgId],
        [unbound, null],
      ] as const) {
        await db.adminSql`INSERT INTO sessions (user_id, token, expires_at, organization_id)
          VALUES (${dual}, ${hashBearerToken(token)}, now() + interval '1 hour', ${orgId})`;
      }
      const patA = await patFor(dual, a.orgId);
      const patB = await patFor(dual, b.orgId);
      expect((await me(inA)).status).toBe(200);

      const res = await patchAccess(await session(a.admin), dual, {
        revoke: true,
      });
      expect(res.status).toBe(200);
      expect((await me(inA)).status).toBe(401);
      expect((await meWithPat(patA)).status).toBe(401);
      // B is untouched: its session and token still work.
      expect((await me(inB)).status).toBe(200);
      expect((await meWithPat(patB)).status).toBe(200);
      // The session not yet bound to any organization is deleted too: it
      // could have resolved to the revoked membership.
      const left = await db.adminSql<{ token: string }[]>`
        SELECT token FROM sessions WHERE user_id = ${dual}`;
      expect(left.map((s) => s.token)).toEqual([hashBearerToken(inB)]);
    });

    it("logs every access change without names or emails", async () => {
      const adminToken = await session(a.admin);
      await patchAccess(adminToken, a.auditor.id, {
        accessUntil: await localDay(3),
      });
      await patchAccess(adminToken, a.auditor.id, { revoke: true });
      const rows = (await auditLog(a.orgId, "membership.access_update")).filter(
        (row) => row.resourceId === a.auditor.id,
      );
      expect(rows.slice(-2).map((row) => row.metadata["revoked"])).toEqual([
        false,
        true,
      ]);
      for (const row of rows) {
        expect(row.actorId).toBe(a.admin.id);
        const text = JSON.stringify(row.metadata);
        expect(text).not.toContain("@");
        expect(text).not.toContain(a.auditor.name);
        expect(Object.keys(row.metadata).sort()).toEqual([
          "newExpiresAt",
          "previousExpiresAt",
          "revoked",
        ]);
      }
    });
  });

  describe("pending invitations cannot restore access", () => {
    it("expires a pending invitation on revoke, so accepting it does not restore access", async () => {
      const at = new Date(Date.now() + 20 * 24 * 3600 * 1000);
      const invite = await createInvite(
        a.orgId,
        a.auditor.email,
        "auditor",
        at,
      );
      const res = await patchAccess(await session(a.admin), a.auditor.id, {
        revoke: true,
      });
      expect(res.status).toBe(200);

      expect((await accept(invite.token)).status).toBe(400);
      expect((await signIn(a.auditor.email)).status).toBe(401);
      expect(
        (await membershipOf(a.auditor.id, a.orgId))?.at!.getTime(),
      ).toBeLessThanOrEqual(Date.now());
    });

    it("refuses an invitation older than the last access change", async () => {
      const at = new Date(Date.now() + 20 * 24 * 3600 * 1000);
      const invite = await createInvite(
        b.orgId,
        b.auditor.email,
        "auditor",
        at,
      );
      // An extension does not expire invitations; the stale check catches it.
      await db.adminSql`UPDATE memberships SET updated_at = now() + interval '1 second'
        WHERE user_id = ${b.auditor.id} AND organization_id = ${b.orgId}`;
      const before = await membershipOf(b.auditor.id, b.orgId);
      expect((await accept(invite.token)).status).toBe(400);
      expect((await membershipOf(b.auditor.id, b.orgId))?.at).toEqual(
        before?.at,
      );
      // The rejected acceptance rolled back: the invitation is still unused.
      const [row] = await withTenant(
        db.adminSql,
        { organizationId: b.orgId },
        (tx) =>
          tx<{ accepted: boolean }[]>`
          SELECT accepted_at IS NOT NULL AS accepted FROM invitations WHERE id = ${invite.id}`,
      );
      expect(row?.accepted).toBe(false);
    });

    it("lists pending auditor invitations and lets admins cancel them", async () => {
      const adminToken = await session(b.admin);
      const invite = await createInvite(
        b.orgId,
        `pending-${crypto.randomUUID().slice(0, 8)}@example.invalid`,
        "auditor",
        new Date(Date.now() + 5 * 24 * 3600 * 1000),
      );
      const list = (await (
        await request("GET", "/v1/auditors", adminToken)
      ).json()) as AuditorListResponse;
      expect(list.pendingInvitations.map((p) => p.id)).toContain(invite.id);

      // Another organization's admin cannot see or cancel it.
      const other = await session(a.admin);
      expect(
        (
          await request(
            "DELETE",
            `/v1/auditors/invitations/${invite.id}`,
            other,
          )
        ).status,
      ).toBe(404);

      const res = await request(
        "DELETE",
        `/v1/auditors/invitations/${invite.id}`,
        adminToken,
      );
      expect(res.status).toBe(200);
      expect(
        (
          await request(
            "DELETE",
            `/v1/auditors/invitations/${invite.id}`,
            adminToken,
          )
        ).status,
      ).toBe(404);
      expect((await accept(invite.token)).status).toBe(400);
      const [entry] = (await auditLog(b.orgId, "invitation.cancel")).filter(
        (row) => row.resourceId === invite.id,
      );
      expect(entry?.metadata).toEqual({ role: "auditor" });
    });

    it("answers 410 INVITATION_ACCESS_EXPIRED for an invitation whose access has ended", async () => {
      const invite = await createInvite(
        c.orgId,
        "lapsed@example.invalid",
        "auditor",
        new Date(Date.now() - 1000),
      );
      const res = await app.request(`/v1/invitations/${invite.token}`);
      expect(res.status).toBe(410);
      expect(((await res.json()) as ProblemDetails).code).toBe(
        "INVITATION_ACCESS_EXPIRED",
      );
      expect((await accept(invite.token)).status).toBe(400);
    });
  });

  describe("re-invitations follow the role", () => {
    it("clears the end date for an auditor re-invited as employee and sets it for an admin re-invited as auditor", async () => {
      const toEmployee = await createInvite(
        c.orgId,
        c.auditor.email,
        "employee",
        null,
      );
      expect((await accept(toEmployee.token)).status).toBe(200);
      expect(await membershipOf(c.auditor.id, c.orgId)).toMatchObject({
        role: "employee",
        at: null,
      });

      const at = new Date(Date.now() + 15 * 24 * 3600 * 1000);
      const toAuditor = await createInvite(
        c.orgId,
        c.manager.email,
        "auditor",
        at,
      );
      expect((await accept(toAuditor.token)).status).toBe(200);
      const row = await membershipOf(c.manager.id, c.orgId);
      expect(row?.role).toBe("auditor");
      expect(row?.at?.getTime()).toBe(at.getTime());
    });
  });

  describe("GET /v1/auditors and PATCH /v1/auditors/:userId/access", () => {
    it("requires authentication", async () => {
      expect((await app.request("/v1/auditors")).status).toBe(401);
      const res = await app.request(`/v1/auditors/${a.auditor.id}/access`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revoke: true }),
      });
      expect(res.status).toBe(401);
    });

    it("is not reachable with a personal access token, even an admin one", async () => {
      const pat = await patFor(a.admin.id, a.orgId, ["admin"]);
      const res = await app.request("/v1/auditors", {
        headers: { Authorization: `Bearer ${pat}` },
      });
      expect(res.status).toBe(403);
      expect(((await res.json()) as ProblemDetails).code).toBe(
        "TOKEN_SCOPE_INSUFFICIENT",
      );
    });

    it("forbids non-admins", async () => {
      for (const person of [a.manager, a.peer]) {
        const token = await session(person);
        expect((await request("GET", "/v1/auditors", token)).status).toBe(403);
        expect(
          (
            await patchAccess(token, a.auditor.id, {
              accessUntil: await localDay(5),
            })
          ).status,
        ).toBe(403);
      }
    });

    it("lists only the organization's auditors with their last day in its zone", async () => {
      const res = await request("GET", "/v1/auditors", await session(b.admin));
      expect(res.status).toBe(200);
      const body = (await res.json()) as AuditorListResponse;
      expect(body.items.map((i) => i.userId)).toEqual([b.auditor.id]);
      expect(body.timeZone).toBe("Europe/Madrid");
      expect(body.today).toBe(await localDay(0));
      expect(body.latestAccessUntil).toBe(await localDay(90));
      expect(body.items[0]?.accessUntil).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it("answers 404 for another organization's auditor and for non-auditors", async () => {
      const token = await session(b.admin);
      for (const userId of [a.auditor.id, b.peer.id, crypto.randomUUID()]) {
        const res = await patchAccess(token, userId, {
          accessUntil: await localDay(5),
        });
        expect(res.status).toBe(404);
      }
      expect(
        (await patchAccess(token, "not-a-uuid", { revoke: true })).status,
      ).toBe(404);
    });

    it("rejects days before today or beyond the organization's maximum", async () => {
      const token = await session(b.admin);
      const past = await patchAccess(token, b.auditor.id, {
        accessUntil: await localDay(-1),
      });
      expect(past.status).toBe(400);
      expect(((await past.json()) as ProblemDetails).code).toBe(
        "AUDITOR_ACCESS_END_IN_PAST",
      );
      const far = await patchAccess(token, b.auditor.id, {
        accessUntil: await localDay(91),
      });
      expect(far.status).toBe(400);
      expect(far.headers.get("content-type")).toContain(
        "application/problem+json",
      );
      expect(((await far.json()) as ProblemDetails).code).toBe(
        "AUDITOR_ACCESS_END_TOO_FAR",
      );
      for (const body of [
        { revoke: false },
        { accessUntil: "2026-02-30" },
        { accessExpiresAt: new Date().toISOString() },
      ]) {
        expect((await patchAccess(token, b.auditor.id, body)).status).toBe(400);
      }
    });

    it("applies the maximum set in the settings, audit-logged, keeping longer grants", async () => {
      const token = await session(b.admin);
      const longer = await localDay(80);
      expect(
        (await patchAccess(token, b.auditor.id, { accessUntil: longer }))
          .status,
      ).toBe(200);

      const settings = await request("PATCH", "/v1/settings/security", token, {
        auditorAccessMaxDays: 30,
      });
      expect(settings.status).toBe(200);
      expect(await settings.json()).toEqual({
        requireTwoFactor: false,
        auditorAccessMaxDays: 30,
      });
      // Lowering the maximum does not shorten the existing grant.
      const list = (await (
        await request("GET", "/v1/auditors", token)
      ).json()) as AuditorListResponse;
      expect(list.items[0]?.accessUntil).toBe(longer);
      expect(
        (
          await patchAccess(token, b.auditor.id, {
            accessUntil: await localDay(31),
          })
        ).status,
      ).toBe(400);

      const entries = await auditLog(b.orgId, "organization.security_updated");
      expect(entries.at(-1)?.metadata).toEqual({ auditorAccessMaxDays: 30 });
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

    it("requires a last day from today up to the maximum, for auditors only", async () => {
      const token = await session(a.admin);
      const email = "inspector@example.invalid";
      const cases: unknown[] = [
        { email, role: "auditor" },
        { email, role: "auditor", accessUntil: await localDay(-1) },
        { email, role: "auditor", accessUntil: await localDay(91) },
        { email, role: "auditor", accessUntil: "2026-13-01" },
        { email, role: "employee", accessUntil: await localDay(5) },
      ];
      for (const body of cases) {
        expect((await invite(token, body)).status).toBe(400);
      }

      const until = await localDay(30);
      const res = await invite(token, {
        email,
        role: "auditor",
        accessUntil: until,
      });
      expect(res.status).toBe(201);
      const created = (await res.json()) as {
        id: string;
        accessExpiresAt: string;
      };

      const [entry] = (await auditLog(a.orgId, "invitation.create")).filter(
        (row) => row.resourceId === created.id,
      );
      expect(entry?.metadata).toEqual({
        role: "auditor",
        accessExpiresAt: created.accessExpiresAt,
      });
      expect(JSON.stringify(entry?.metadata)).not.toContain("@");
    });

    it("copies the end date to the membership on acceptance", async () => {
      const at = new Date(Date.now() + 20 * 24 * 3600 * 1000);
      const fresh = await createInvite(
        a.orgId,
        "fresh@example.invalid",
        "auditor",
        at,
      );
      expect((await accept(fresh.token)).status).toBe(200);
      const [row] = await db.adminSql<{ role: string; at: Date }[]>`
        SELECT m.role, m.access_expires_at AS at
        FROM memberships m JOIN users u ON u.id = m.user_id
        WHERE u.email = 'fresh@example.invalid' AND m.organization_id = ${a.orgId}`;
      expect(row?.role).toBe("auditor");
      expect(row?.at.getTime()).toBe(at.getTime());
    });
  });
});
