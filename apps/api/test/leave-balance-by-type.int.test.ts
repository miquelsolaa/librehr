import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  getTestDatabase,
  seedScopedOrg,
  type FixturePerson,
  type ScopedOrgFixture,
  type TestDatabase,
} from "@librehr/testing";
import type { LeaveBalanceSummary, ProblemDetails } from "@librehr/contracts";
import { LeaveRepository, withTenant } from "@librehr/db";
import { runMigrations } from "@librehr/db/migrate";
import { createApp } from "../src/app.js";
import { as, fixtureAuthPort } from "./support/fixture-app.js";

// LEA-005 (#117): balances are kept per leave type. Every ledger writer
// records the type; untyped legacy entries form an "unassigned" bucket.
describe("leave balances per leave type (LEA-005)", () => {
  let db: TestDatabase;
  let app: ReturnType<typeof createApp>;
  let a: ScopedOrgFixture;
  let b: ScopedOrgFixture;
  const type: Record<string, string> = {};

  const leave = new LeaveRepository();

  async function seedType(orgId: string, code: string): Promise<string> {
    return withTenant(db.sql, { organizationId: orgId }, async (tx) => {
      return (await leave.createLeaveType(tx, { name: code, code })).id;
    });
  }

  async function assignPolicy(
    orgId: string,
    leaveTypeId: string,
    employeeId: string,
  ): Promise<void> {
    await withTenant(db.sql, { organizationId: orgId }, async (tx) => {
      const policy = await leave.createLeavePolicy(tx, {
        leaveTypeId,
        name: "Policy",
        annualAllowanceDays: 22,
        accrualMethod: "upfront",
      });
      await tx`
        INSERT INTO leave_policy_assignments (leave_policy_id, employee_id, effective_from)
        VALUES (${policy.id}, ${employeeId}, '2020-01-01')
      `;
    });
  }

  const adjust = (who: FixturePerson, body: Record<string, unknown>) =>
    app.request("/v1/leave/adjust", {
      method: "POST",
      headers: as(who, true),
      body: JSON.stringify({ note: "Opening balance", ...body }),
    });

  const requestLeave = (
    who: FixturePerson,
    leaveTypeId: string,
    date: string,
  ) =>
    app.request("/v1/leave/requests", {
      method: "POST",
      headers: as(who, true),
      body: JSON.stringify({ leaveTypeId, startDate: date, endDate: date }),
    });

  async function balance(
    who: FixturePerson,
    employeeId?: string,
  ): Promise<LeaveBalanceSummary> {
    const qs = employeeId ? `?employeeId=${employeeId}` : "";
    const res = await app.request(`/v1/leave/balance${qs}`, {
      headers: as(who),
    });
    expect(res.status).toBe(200);
    return (await res.json()) as LeaveBalanceSummary;
  }

  const byType = (s: LeaveBalanceSummary) =>
    Object.fromEntries(
      s.byType.map((t) => [t.leaveTypeId ?? "unassigned", t.currentBalance]),
    );

  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database) throw new Error("Docker is required for this suite");
    db = database;
    await runMigrations(db.connectionString);
    a = await seedScopedOrg(db.sql, "balance-type-a");
    b = await seedScopedOrg(db.sql, "balance-type-b");
    type["vacation"] = await seedType(a.orgId, "vacation");
    type["personal"] = await seedType(a.orgId, "personal_days");
    type["sick"] = await seedType(a.orgId, "sick_leave");
    type["foreign"] = await seedType(b.orgId, "vacation");
    await assignPolicy(a.orgId, type["vacation"], a.report.employeeId);
    await assignPolicy(a.orgId, type["vacation"], a.peer.employeeId);
    await assignPolicy(a.orgId, type["personal"], a.peer.employeeId);
    await assignPolicy(a.orgId, type["vacation"], a.manager.employeeId);

    app = createApp({
      sql: await db.appSql(),
      authPort: fixtureAuthPort([
        a.admin,
        a.manager,
        a.report,
        a.peer,
        b.admin,
      ]),
    });
  }, 60000);

  afterAll(async () => {
    if (db) await db.close();
  });

  it("keeps each leave type's balance and history apart", async () => {
    expect(
      (
        await adjust(a.admin, {
          employeeId: a.report.employeeId,
          leaveTypeId: type["vacation"],
          amount: 10,
          effectiveDate: "2027-01-01",
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await adjust(a.admin, {
          employeeId: a.report.employeeId,
          leaveTypeId: type["personal"],
          amount: 2,
          effectiveDate: "2027-01-02",
        })
      ).status,
    ).toBe(201);

    const s = await balance(a.report);
    expect(byType(s)).toEqual({
      [type["vacation"]!]: 10,
      [type["personal"]!]: 2,
    });
    expect(s.byType.find((t) => t.leaveTypeId === type["personal"])).toEqual(
      expect.objectContaining({
        leaveTypeCode: "personal_days",
        totalAdjustments: 2,
      }),
    );
    // balanceAfter runs per type: the personal entry starts from zero.
    expect(
      s.entries.map((e) => [e.leaveTypeId, e.amount, e.balanceAfter]),
    ).toEqual([
      [type["vacation"], 10, 10],
      [type["personal"], 2, 2],
    ]);
  });

  it("types the usage of an approval and the reversal of a cancellation", async () => {
    const created = await requestLeave(
      a.report,
      type["vacation"]!,
      "2027-02-10",
    );
    expect(created.status, await created.clone().text()).toBe(201);
    const { id } = (await created.json()) as { id: string };

    const decided = await app.request(`/v1/leave/requests/${id}/decide`, {
      method: "POST",
      headers: as(a.manager, true),
      body: JSON.stringify({ decision: "approve" }),
    });
    expect(decided.status, await decided.clone().text()).toBe(200);
    expect(byType(await balance(a.report))[type["vacation"]!]).toBe(9);

    const cancelled = await app.request(`/v1/leave/requests/${id}/cancel`, {
      method: "POST",
      headers: as(a.report, true),
    });
    expect(cancelled.status, await cancelled.clone().text()).toBe(200);

    const s = await balance(a.report);
    expect(byType(s)).toEqual({
      [type["vacation"]!]: 10,
      [type["personal"]!]: 2,
    });
    const linked = s.entries.filter((e) => e.sourceRef === id);
    // The reversal is dated today, before the usage: compare by entry type.
    expect(linked.map((e) => [e.entryType, e.leaveTypeId]).sort()).toEqual([
      ["reversal", type["vacation"]],
      ["usage", type["vacation"]],
    ]);
  });

  it("reports legacy untyped entries as unassigned, last", async () => {
    await withTenant(db.sql, { organizationId: a.orgId }, (tx) =>
      leave.appendLedgerEntry(tx, {
        employeeId: a.report.employeeId,
        leaveTypeId: null,
        entryType: "adjustment",
        amount: 1.5,
        effectiveDate: "2026-12-31",
      }),
    );
    const s = await balance(a.report);
    expect(s.byType.at(-1)).toEqual(
      expect.objectContaining({
        leaveTypeId: null,
        leaveTypeName: null,
        currentBalance: 1.5,
      }),
    );
    // The legacy total is still the sum over every bucket.
    expect(s.currentBalance).toBe(13.5);
  });

  it("checks a request against its own leave type's balance", async () => {
    // a.peer: 3 vacation days, a personal-days policy and no personal days.
    expect(
      (
        await adjust(a.admin, {
          employeeId: a.peer.employeeId,
          leaveTypeId: type["vacation"],
          amount: 3,
        })
      ).status,
    ).toBe(201);

    const personal = await requestLeave(
      a.peer,
      type["personal"]!,
      "2027-03-10",
    );
    expect(personal.status).toBe(400);
    expect(((await personal.json()) as ProblemDetails).code).toBe(
      "INSUFFICIENT_BALANCE",
    );

    const vacation = await requestLeave(
      a.peer,
      type["vacation"]!,
      "2027-03-10",
    );
    expect(vacation.status, await vacation.clone().text()).toBe(201);
  });

  it("lets a legacy pool back an entitled type, never limits other types", async () => {
    // a.manager: a vacation policy, 2 legacy unassigned days booked through
    // the API, no sick-leave policy.
    const legacy = await adjust(a.admin, {
      employeeId: a.manager.employeeId,
      leaveTypeId: null,
      amount: 2,
    });
    expect(legacy.status).toBe(201);
    expect(
      ((await legacy.json()) as { leaveTypeId: unknown }).leaveTypeId,
    ).toBe(null);

    // Vacation has no days of its own: the legacy pool backs it.
    const vacation = await requestLeave(
      a.manager,
      type["vacation"]!,
      "2027-05-12",
    );
    expect(vacation.status, await vacation.clone().text()).toBe(201);

    // Sick leave has no policy: never balance-limited, now or after the pool
    // is re-booked onto vacation (unassigned nets to 0 but has rows).
    const sick = await requestLeave(a.manager, type["sick"]!, "2027-05-13");
    expect(sick.status, await sick.clone().text()).toBe(201);
    for (const [leaveTypeId, amount] of [
      [null, -2],
      [type["vacation"], 2],
    ] as const) {
      expect(
        (
          await adjust(a.admin, {
            employeeId: a.manager.employeeId,
            leaveTypeId,
            amount,
          })
        ).status,
      ).toBe(201);
    }
    const sickAgain = await requestLeave(
      a.manager,
      type["sick"]!,
      "2027-05-14",
    );
    expect(sickAgain.status, await sickAgain.clone().text()).toBe(201);

    const s = await balance(a.manager);
    expect(
      s.byType.map((t) => [t.leaveTypeId, t.entitled, t.currentBalance]),
    ).toEqual([
      [type["vacation"], true, 2],
      [null, false, 0],
    ]);
  });

  describe("POST /v1/leave/adjust", () => {
    it("requires the leave type to be stated", async () => {
      const res = await adjust(a.admin, {
        employeeId: a.report.employeeId,
        amount: 1,
      });
      expect(res.status).toBe(400);
      expect(((await res.json()) as ProblemDetails).code).toBe(
        "VALIDATION_ERROR",
      );
    });

    it("rejects unauthenticated and non-HR callers", async () => {
      const anonymous = await app.request("/v1/leave/adjust", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(anonymous.status).toBe(401);
      const res = await adjust(a.report, {
        employeeId: a.report.employeeId,
        leaveTypeId: type["vacation"],
        amount: 5,
      });
      expect(res.status).toBe(403);
    });

    it("never books an entry against another tenant's leave type", async () => {
      const before = await balance(a.admin, a.report.employeeId);
      const res = await adjust(a.admin, {
        employeeId: a.report.employeeId,
        leaveTypeId: type["foreign"],
        amount: 5,
      });
      expect(res.status).toBe(404);
      expect(((await res.json()) as ProblemDetails).code).toBe(
        "LEAVE_TYPE_NOT_FOUND",
      );
      expect(await balance(a.admin, a.report.employeeId)).toEqual(before);
    });
  });

  describe("cross-tenant access", () => {
    it("never returns another tenant's balance", async () => {
      const res = await app.request(
        `/v1/leave/balance?employeeId=${a.report.employeeId}`,
        { headers: as(b.admin) },
      );
      expect([403, 404]).toContain(res.status);
      expect(JSON.stringify(await res.json())).not.toContain(type["vacation"]);
    });

    it("refuses a request for another tenant's leave type", async () => {
      const res = await requestLeave(a.report, type["foreign"]!, "2027-04-14");
      expect(res.status).toBe(404);
      expect(((await res.json()) as ProblemDetails).code).toBe(
        "LEAVE_TYPE_NOT_FOUND",
      );
    });

    it("cannot reference another tenant's leave type even below the API", async () => {
      await expect(
        withTenant(db.sql, { organizationId: a.orgId }, (tx) =>
          leave.appendLedgerEntry(tx, {
            employeeId: a.report.employeeId,
            leaveTypeId: type["foreign"]!,
            entryType: "adjustment",
            amount: 1,
            effectiveDate: "2027-01-01",
          }),
        ),
      ).rejects.toThrow(/leave_ledger_leave_type_fk/);
    });
  });
});
