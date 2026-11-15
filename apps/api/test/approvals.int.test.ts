import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  getTestDatabase,
  seedScopedOrg,
  type FixturePerson,
  type ScopedOrgFixture,
  type TestDatabase,
} from "@librehr/testing";
import type { PendingApprovals } from "@librehr/contracts";
import {
  LeaveRepository,
  TimeCorrectionRepository,
  withTenant,
} from "@librehr/db";
import { runMigrations } from "@librehr/db/migrate";
import { createApp } from "../src/app.js";
import { as, fixtureAuthPort } from "./support/fixture-app.js";

// LEA-004 / LEA-008 / TIM-003: the approvals inbox lists exactly the pending
// items the caller may decide, using the same rules as the decide endpoints.
describe("GET /v1/approvals/pending", () => {
  let db: TestDatabase;
  let app: ReturnType<typeof createApp>;
  let a: ScopedOrgFixture;
  let b: ScopedOrgFixture;
  const ids: Record<string, string> = {};

  async function seedLeaveType(orgId: string): Promise<string> {
    return withTenant(db.sql, { organizationId: orgId }, async (tx) => {
      const repo = new LeaveRepository();
      return (await repo.createLeaveType(tx, { name: "Vacation", code: "VAC" }))
        .id;
    });
  }

  async function seedLeave(
    orgId: string,
    leaveTypeId: string,
    employeeId: string,
    status?: "approved",
  ): Promise<string> {
    return withTenant(db.sql, { organizationId: orgId }, async (tx) => {
      const repo = new LeaveRepository();
      const req = await repo.createLeaveRequest(tx, {
        employeeId,
        leaveTypeId,
        startDate: "2026-12-14",
        endDate: "2026-12-14",
        workingDays: 1,
      });
      if (status) {
        await tx`UPDATE leave_requests SET status = ${status} WHERE id = ${req.id}`;
      }
      return req.id;
    });
  }

  async function seedCorrection(
    orgId: string,
    employeeId: string,
  ): Promise<string> {
    return withTenant(
      db.sql,
      { organizationId: orgId },
      async (tx) =>
        (
          await new TimeCorrectionRepository().create(tx, {
            employeeId,
            proposedEventType: "clock_in",
            proposedOccurredAt: new Date("2026-03-02T08:00:00Z"),
            reason: "Forgot to clock in",
          })
        ).id,
    );
  }

  async function delegate(
    fixture: ScopedOrgFixture,
    to: FixturePerson,
    startDate: string,
    endDate: string,
  ): Promise<void> {
    await withTenant(db.sql, { organizationId: fixture.orgId }, (tx) =>
      new LeaveRepository().createApprovalDelegation(tx, {
        managerEmployeeId: fixture.manager.employeeId,
        delegateEmployeeId: to.employeeId,
        startDate,
        endDate,
      }),
    );
  }

  async function pending(who: FixturePerson): Promise<PendingApprovals> {
    const res = await app.request("/v1/approvals/pending", {
      headers: as(who),
    });
    expect(res.status).toBe(200);
    return (await res.json()) as PendingApprovals;
  }

  const nothing: PendingApprovals = {
    leaveRequests: [],
    timeCorrections: [],
    truncated: false,
  };
  const leaveIds = (p: PendingApprovals) => p.leaveRequests.map((r) => r.id);
  const correctionIds = (p: PendingApprovals) =>
    p.timeCorrections.map((r) => r.id);

  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database) throw new Error("Docker is required for this suite");
    db = database;
    await runMigrations(db.connectionString);
    a = await seedScopedOrg(db.sql, "approvals-a");
    b = await seedScopedOrg(db.sql, "approvals-b");
    const typeA = await seedLeaveType(a.orgId);
    const typeB = await seedLeaveType(b.orgId);
    ids["typeA"] = typeA;
    ids["typeB"] = typeB;

    ids["reportLeave"] = await seedLeave(a.orgId, typeA, a.report.employeeId);
    ids["reportApproved"] = await seedLeave(
      a.orgId,
      typeA,
      a.report.employeeId,
      "approved",
    );
    ids["managerLeave"] = await seedLeave(a.orgId, typeA, a.manager.employeeId);
    ids["adminLeave"] = await seedLeave(a.orgId, typeA, a.admin.employeeId);
    ids["reportCorrection"] = await seedCorrection(
      a.orgId,
      a.report.employeeId,
    );
    ids["managerCorrection"] = await seedCorrection(
      a.orgId,
      a.manager.employeeId,
    );
    ids["reportDecidedCorrection"] = await seedCorrection(
      a.orgId,
      a.report.employeeId,
    );
    await db.sql`UPDATE time_corrections SET status = 'approved' WHERE id = ${ids["reportDecidedCorrection"]}`;
    ids["bReportLeave"] = await seedLeave(b.orgId, typeB, b.report.employeeId);

    // a.peer covers for a.manager now; b.peer's cover ended long ago.
    await delegate(a, a.peer, "2000-01-01", "2999-12-31");
    await delegate(b, b.peer, "2000-01-01", "2000-01-02");

    app = createApp({
      sql: await db.appSql(),
      authPort: fixtureAuthPort([
        a.admin,
        a.manager,
        a.report,
        a.peer,
        a.auditor,
        b.manager,
        b.peer,
      ]),
    });
  }, 60000);
  afterAll(async () => {
    if (db) await db.close();
  });

  it("requires authentication", async () => {
    const res = await app.request("/v1/approvals/pending");
    expect(res.status).toBe(401);
  });

  it("gives a manager their reports' pending items, never their own", async () => {
    const p = await pending(a.manager);
    expect(leaveIds(p)).toEqual([ids["reportLeave"]]);
    expect(correctionIds(p)).toEqual([ids["reportCorrection"]]);
    expect(p.leaveRequests[0]?.employeeName).toBe("Fixture report");
  });

  it("gives an admin every pending item except their own, oldest first", async () => {
    const p = await pending(a.admin);
    expect(leaveIds(p)).toEqual([ids["reportLeave"], ids["managerLeave"]]);
    expect(correctionIds(p)).toEqual([
      ids["reportCorrection"],
      ids["managerCorrection"],
    ]);
    expect(p.truncated).toBe(false);
  });

  it("gives an active delegate the absent manager's team leave only", async () => {
    const p = await pending(a.peer);
    expect(leaveIds(p)).toEqual([ids["reportLeave"]]);
    expect(p.timeCorrections).toEqual([]);
  });

  it("gives nothing to a delegate whose delegation has ended", async () => {
    expect(await pending(b.peer)).toEqual(nothing);
  });

  it("gives nothing to an employee or an auditor", async () => {
    expect(await pending(a.report)).toEqual(nothing);
    expect(await pending(a.auditor)).toEqual(nothing);
  });

  it("never returns another organization's items", async () => {
    const p = await pending(b.manager);
    expect(leaveIds(p)).toEqual([ids["bReportLeave"]]);
    expect(p.timeCorrections).toEqual([]);
  });

  // The decide route shares canDecideLeave with the inbox; these cover the
  // LEA-008 delegate branch through the real endpoint.
  describe("POST /v1/leave/requests/:id/decide as a delegate", () => {
    const approve = (id: string, who: FixturePerson) =>
      app.request(`/v1/leave/requests/${id}/decide`, {
        method: "POST",
        headers: as(who, true),
        body: JSON.stringify({ decision: "approve" }),
      });

    it("lets an active delegate approve the absent manager's report", async () => {
      const id = await seedLeave(a.orgId, ids["typeA"]!, a.report.employeeId);
      const res = await approve(id, a.peer);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { status: string; approverId: string };
      expect(body.status).toBe("approved");
      expect(body.approverId).toBe(a.peer.employeeId);
    });

    it("refuses a delegate outside the delegating manager's team", async () => {
      const id = await seedLeave(a.orgId, ids["typeA"]!, a.admin.employeeId);
      expect((await approve(id, a.peer)).status).toBe(403);
    });

    it("refuses a delegate whose delegation has ended", async () => {
      const id = await seedLeave(b.orgId, ids["typeB"]!, b.report.employeeId);
      expect((await approve(id, b.peer)).status).toBe(403);
    });
  });
});
