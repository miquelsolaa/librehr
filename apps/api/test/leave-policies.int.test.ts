import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  getTestDatabase,
  seedScopedOrg,
  type FixturePerson,
  type ScopedOrgFixture,
  type TestDatabase,
} from "@librehr/testing";
import type { LeavePolicy, ProblemDetails } from "@librehr/contracts";
import { LeaveRepository, withTenant } from "@librehr/db";
import { runMigrations } from "@librehr/db/migrate";
import { createApp } from "../src/app.js";
import { as, fixtureAuthPort } from "./support/fixture-app.js";

// LEA-002 (#118): leave policies and their opt-in part-time full-time week.
describe("/v1/leave/policies", () => {
  let db: TestDatabase;
  let app: ReturnType<typeof createApp>;
  let a: ScopedOrgFixture;
  let b: ScopedOrgFixture;
  /** A non-statutory leave type of org A (may be prorated). */
  let agreementA: string;
  /** Statutory vacation of org A (never prorated). */
  let vacationA: string;
  let typeB: string;
  let policyB: string;
  /** Created by the first test; reused by the validation tests. */
  let policyA: string;

  const seedType = (orgId: string, code: string) =>
    withTenant(db.sql, { organizationId: orgId }, async (tx) => {
      return (
        await new LeaveRepository().createLeaveType(tx, { name: code, code })
      ).id;
    });

  const create = (who: FixturePerson, body: Record<string, unknown>) =>
    app.request("/v1/leave/policies", {
      method: "POST",
      headers: as(who, true),
      body: JSON.stringify(body),
    });

  const patch = (who: FixturePerson, id: string, body: unknown) =>
    app.request(`/v1/leave/policies/${id}`, {
      method: "PATCH",
      headers: as(who, true),
      body: JSON.stringify(body),
    });

  const storedHours = async (id: string) =>
    (
      await db.sql<{ hours: string | null }[]>`
        SELECT full_time_hours_per_week::text AS hours
        FROM leave_policies WHERE id = ${id}`
    )[0]?.hours;

  const validPolicy = {
    name: "Agreement days",
    annualAllowanceDays: 4,
    accrualMethod: "monthly",
  };

  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database) throw new Error("Docker is required for this suite");
    db = database;
    await runMigrations(db.connectionString);
    a = await seedScopedOrg(db.sql, "policies-a");
    b = await seedScopedOrg(db.sql, "policies-b");
    agreementA = await seedType(a.orgId, "other");
    vacationA = await seedType(a.orgId, "vacation");
    typeB = await seedType(b.orgId, "other");
    policyB = await withTenant(
      db.sql,
      { organizationId: b.orgId },
      async (tx) =>
        (
          await new LeaveRepository().createLeavePolicy(tx, {
            leaveTypeId: typeB,
            name: "Other tenant",
          })
        ).id,
    );
    app = createApp({
      sql: await db.appSql(),
      authPort: fixtureAuthPort([
        a.admin,
        a.manager,
        a.report,
        a.auditor,
        b.admin,
      ]),
    });
  }, 60000);

  afterAll(async () => {
    if (db) await db.close();
  });

  it("creates a policy unprorated by default, then sets and clears its full-time week", async () => {
    const created = await create(a.admin, {
      ...validPolicy,
      leaveTypeId: agreementA,
    });
    expect(created.status, await created.clone().text()).toBe(201);
    const policy = (await created.json()) as LeavePolicy;
    policyA = policy.id;
    expect(policy.fullTimeHoursPerWeek).toBeNull();

    const set = await patch(a.admin, policy.id, { fullTimeHoursPerWeek: 37.5 });
    expect(set.status).toBe(200);
    expect(((await set.json()) as LeavePolicy).fullTimeHoursPerWeek).toBe(37.5);

    const list = await app.request("/v1/leave/policies", {
      headers: as(a.admin),
    });
    expect(list.status).toBe(200);
    const policies = (await list.json()) as LeavePolicy[];
    expect(policies.map((p) => [p.id, p.fullTimeHoursPerWeek])).toEqual([
      [policy.id, 37.5],
    ]);

    const cleared = await patch(a.admin, policy.id, {
      fullTimeHoursPerWeek: null,
    });
    expect(((await cleared.json()) as LeavePolicy).fullTimeHoursPerWeek).toBe(
      null,
    );

    const audit = await db.sql<
      { action: string; metadata: Record<string, unknown> }[]
    >`
      SELECT action, metadata FROM audit_log
      WHERE organization_id = ${a.orgId} AND resource_id = ${policy.id}
      ORDER BY created_at, id`;
    expect(audit.map((r) => r.action).sort()).toEqual([
      "leave.policy.create",
      "leave.policy.update",
      "leave.policy.update",
    ]);
    expect(audit.map((r) => r.metadata)).toContainEqual({
      previousFullTimeHoursPerWeek: 37.5,
      fullTimeHoursPerWeek: null,
      previousCarryoverEnforced: false,
      carryoverEnforced: false,
    });
  });

  it("accepts a full-time week on creation", async () => {
    const res = await create(a.admin, {
      ...validPolicy,
      leaveTypeId: agreementA,
      name: "Prorated",
      fullTimeHoursPerWeek: 40,
    });
    expect(res.status).toBe(201);
    expect(((await res.json()) as LeavePolicy).fullTimeHoursPerWeek).toBe(40);
  });

  describe("statutory vacation is never prorated (ET art. 12.4.d)", () => {
    it("refuses a full-time week on a vacation policy, on create and update", async () => {
      const res = await create(a.admin, {
        ...validPolicy,
        leaveTypeId: vacationA,
        fullTimeHoursPerWeek: 40,
      });
      expect(res.status).toBe(422);
      expect(((await res.json()) as ProblemDetails).code).toBe(
        "STATUTORY_LEAVE_NOT_PRORATABLE",
      );

      const plain = await create(a.admin, {
        ...validPolicy,
        leaveTypeId: vacationA,
        name: "Vacation",
      });
      expect(plain.status).toBe(201);
      const { id } = (await plain.json()) as LeavePolicy;
      const updated = await patch(a.admin, id, { fullTimeHoursPerWeek: 40 });
      expect(updated.status).toBe(422);
      expect(await storedHours(id)).toBeNull();
      // Clearing is always allowed.
      expect(
        (await patch(a.admin, id, { fullTimeHoursPerWeek: null })).status,
      ).toBe(200);
    });
  });

  it.each([0, -1, 40.01, 168, 37.555, "40"])(
    "rejects a full-time week of %s",
    async (hours) => {
      const res = await patch(a.admin, policyA, {
        fullTimeHoursPerWeek: hours,
      });
      expect(res.status).toBe(400);
      expect(((await res.json()) as ProblemDetails).code).toBe(
        "VALIDATION_ERROR",
      );
    },
  );

  it("rejects fields other than the full-time week on update", async () => {
    const res = await patch(a.admin, policyA, {
      fullTimeHoursPerWeek: 40,
      annualAllowanceDays: 99,
    });
    expect(res.status).toBe(400);
    expect(await storedHours(policyA)).toBeNull();
  });

  it.each([
    { name: "" },
    { accrualMethod: "weekly" },
    { annualAllowanceDays: 1000 },
  ])("rejects an invalid policy on creation (%o)", async (override) => {
    const res = await create(a.admin, {
      ...validPolicy,
      leaveTypeId: agreementA,
      ...override,
    });
    expect(res.status).toBe(400);
  });

  it("answers 404 for a malformed policy id", async () => {
    const res = await patch(a.admin, "not-a-uuid", {
      fullTimeHoursPerWeek: 40,
    });
    expect(res.status).toBe(404);
    expect(((await res.json()) as ProblemDetails).code).toBe(
      "LEAVE_POLICY_NOT_FOUND",
    );
  });

  it("requires authentication", async () => {
    expect((await app.request("/v1/leave/policies")).status).toBe(401);
    const res = await app.request(`/v1/leave/policies/${policyA}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fullTimeHoursPerWeek: 20 }),
    });
    expect(res.status).toBe(401);
    expect(await storedHours(policyA)).toBeNull();
  });

  it("is for administrators only", async () => {
    for (const who of [a.manager, a.report, a.auditor]) {
      const list = await app.request("/v1/leave/policies", {
        headers: as(who),
      });
      expect(list.status).toBe(403);
      const res = await create(who, {
        ...validPolicy,
        leaveTypeId: agreementA,
        name: "Nope",
      });
      expect(res.status).toBe(403);
      const updated = await patch(who, policyA, { fullTimeHoursPerWeek: 20 });
      expect(updated.status).toBe(403);
    }
    expect(await storedHours(policyA)).toBeNull();
  });

  describe("carry-over cap, forfeit and expiry are opt-in (#132)", () => {
    const storedEnforced = async (id: string) =>
      (
        await db.sql<{ enforced: boolean }[]>`
          SELECT carryover_enforced AS enforced
          FROM leave_policies WHERE id = ${id}`
      )[0]?.enforced;

    it("is off on a new policy, and an admin turns it on and off, audited", async () => {
      const created = await create(a.admin, {
        ...validPolicy,
        leaveTypeId: vacationA,
        name: "Vacation",
      });
      expect(created.status).toBe(201);
      const policy = (await created.json()) as LeavePolicy;
      expect(policy.carryoverEnforced).toBe(false);

      const on = await patch(a.admin, policy.id, { carryoverEnforced: true });
      expect(on.status, await on.clone().text()).toBe(200);
      expect(((await on.json()) as LeavePolicy).carryoverEnforced).toBe(true);
      expect(await storedEnforced(policy.id)).toBe(true);

      // Allowed on statutory vacation: only proration is refused there.
      const off = await patch(a.admin, policy.id, { carryoverEnforced: false });
      expect(((await off.json()) as LeavePolicy).carryoverEnforced).toBe(false);

      const audit = await db.sql<{ metadata: Record<string, unknown> }[]>`
        SELECT metadata FROM audit_log
        WHERE organization_id = ${a.orgId} AND resource_id = ${policy.id}
          AND action = 'leave.policy.update'
        ORDER BY created_at, id`;
      expect(audit.map((r) => r.metadata["carryoverEnforced"])).toEqual([
        true,
        false,
      ]);
      expect(audit[0]!.metadata["previousCarryoverEnforced"]).toBe(false);
    });

    it("rejects an empty or invalid update", async () => {
      for (const body of [{}, { carryoverEnforced: "yes" }]) {
        const res = await patch(a.admin, policyA, body);
        expect(res.status).toBe(400);
      }
      expect(await storedEnforced(policyA)).toBe(false);
    });

    it("is for administrators only and never reaches another tenant", async () => {
      for (const who of [a.manager, a.report, a.auditor]) {
        const res = await patch(who, policyA, { carryoverEnforced: true });
        expect(res.status).toBe(403);
      }
      const foreign = await patch(a.admin, policyB, {
        carryoverEnforced: true,
      });
      expect(foreign.status).toBe(404);
      expect(await storedEnforced(policyA)).toBe(false);
      expect(await storedEnforced(policyB)).toBe(false);
    });
  });

  describe("cross-tenant access", () => {
    it("never lists another tenant's policies", async () => {
      const res = await app.request("/v1/leave/policies", {
        headers: as(a.admin),
      });
      const ids = ((await res.json()) as LeavePolicy[]).map((p) => p.id);
      expect(ids).not.toContain(policyB);
    });

    it("never updates another tenant's policy", async () => {
      const res = await patch(a.admin, policyB, { fullTimeHoursPerWeek: 20 });
      expect(res.status).toBe(404);
      expect(await storedHours(policyB)).toBeNull();
    });

    it("never creates a policy on another tenant's leave type", async () => {
      const res = await create(a.admin, {
        ...validPolicy,
        leaveTypeId: typeB,
        name: "Foreign",
      });
      expect(res.status).toBe(404);
      expect(((await res.json()) as ProblemDetails).code).toBe(
        "LEAVE_TYPE_NOT_FOUND",
      );
    });
  });

  it("refuses an out-of-range full-time week in the database too", async () => {
    await expect(
      withTenant(db.sql, { organizationId: a.orgId }, (tx) =>
        new LeaveRepository().createLeavePolicy(tx, {
          leaveTypeId: agreementA,
          name: "Too long",
          fullTimeHoursPerWeek: 200,
        }),
      ),
    ).rejects.toThrow(/leave_policies_full_time_hours_range/);
  });
});
