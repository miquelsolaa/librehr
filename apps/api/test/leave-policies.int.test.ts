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
  let typeA: string;
  let typeB: string;
  let policyB: string;

  const seedType = (orgId: string) =>
    withTenant(db.sql, { organizationId: orgId }, async (tx) => {
      return (
        await new LeaveRepository().createLeaveType(tx, {
          name: "Vacation",
          code: "vacation",
        })
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

  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database) throw new Error("Docker is required for this suite");
    db = database;
    await runMigrations(db.connectionString);
    a = await seedScopedOrg(db.sql, "policies-a");
    b = await seedScopedOrg(db.sql, "policies-b");
    typeA = await seedType(a.orgId);
    typeB = await seedType(b.orgId);
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
      authPort: fixtureAuthPort([a.admin, a.manager, a.report, b.admin]),
    });
  }, 60000);

  afterAll(async () => {
    if (db) await db.close();
  });

  it("creates a policy unprorated by default, then sets and clears its full-time week", async () => {
    const created = await create(a.admin, {
      leaveTypeId: typeA,
      name: "Agreement days",
      annualAllowanceDays: 4,
      accrualMethod: "upfront",
    });
    expect(created.status, await created.clone().text()).toBe(201);
    const policy = (await created.json()) as LeavePolicy;
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

    const audit = await db.sql<{ action: string }[]>`
      SELECT action FROM audit_log
      WHERE organization_id = ${a.orgId} AND resource_id = ${policy.id}
      ORDER BY created_at`;
    expect(audit.map((r) => r.action)).toEqual([
      "leave.policy.create",
      "leave.policy.update",
      "leave.policy.update",
    ]);
  });

  it("accepts a full-time week on creation", async () => {
    const res = await create(a.admin, {
      leaveTypeId: typeA,
      name: "Prorated",
      annualAllowanceDays: 2,
      accrualMethod: "monthly",
      fullTimeHoursPerWeek: 40,
    });
    expect(res.status).toBe(201);
    expect(((await res.json()) as LeavePolicy).fullTimeHoursPerWeek).toBe(40);
  });

  it.each([0, -1, 168.5, 37.555, "40"])(
    "rejects a full-time week of %s",
    async (hours) => {
      const [policy] = await withTenant(
        db.sql,
        { organizationId: a.orgId },
        async (tx) => new LeaveRepository().getLeavePolicies(tx),
      );
      const res = await patch(a.admin, policy!.id, {
        fullTimeHoursPerWeek: hours,
      });
      expect(res.status).toBe(400);
      expect(((await res.json()) as ProblemDetails).code).toBe(
        "VALIDATION_ERROR",
      );
    },
  );

  it("rejects fields other than the full-time week on update", async () => {
    const [policy] = await withTenant(
      db.sql,
      { organizationId: a.orgId },
      async (tx) => new LeaveRepository().getLeavePolicies(tx),
    );
    const res = await patch(a.admin, policy!.id, {
      fullTimeHoursPerWeek: 40,
      annualAllowanceDays: 99,
    });
    expect(res.status).toBe(400);
  });

  it("requires authentication", async () => {
    expect((await app.request("/v1/leave/policies")).status).toBe(401);
  });

  it("is for administrators only", async () => {
    for (const who of [a.manager, a.report]) {
      const list = await app.request("/v1/leave/policies", {
        headers: as(who),
      });
      expect(list.status).toBe(403);
      const res = await create(who, {
        leaveTypeId: typeA,
        name: "Nope",
        annualAllowanceDays: 1,
        accrualMethod: "monthly",
      });
      expect(res.status).toBe(403);
    }
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
      const [row] = await db.sql<{ hours: string | null }[]>`
        SELECT full_time_hours_per_week::text AS hours
        FROM leave_policies WHERE id = ${policyB}`;
      expect(row?.hours).toBeNull();
    });

    it("never creates a policy on another tenant's leave type", async () => {
      const res = await create(a.admin, {
        leaveTypeId: typeB,
        name: "Foreign",
        annualAllowanceDays: 1,
        accrualMethod: "monthly",
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
          leaveTypeId: typeA,
          name: "Too long",
          fullTimeHoursPerWeek: 200,
        }),
      ),
    ).rejects.toThrow(/leave_policies_full_time_hours_range/);
  });
});
