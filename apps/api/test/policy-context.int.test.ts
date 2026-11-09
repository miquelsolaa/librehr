import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  getTestDatabase,
  seedScopedOrg,
  type ScopedOrgFixture,
  type TestDatabase,
} from "@librehr/testing";
import { runMigrations } from "@librehr/db/migrate";
import { LeaveRepository, withTenant } from "@librehr/db";
import { createApp } from "../src/app.js";
import { as, fixtureAuthPort } from "./support/fixture-app.js";

// Regression for the manager scope comparing an employee id (managerId) with a
// user id, and for ctx.employeeId/ctx.reports never being populated. Managers
// must reach their direct reports, and only them.
describe("policy context: manager scope on leave and time routes", () => {
  let db: TestDatabase;
  let app: ReturnType<typeof createApp>;
  let a: ScopedOrgFixture;
  let b: ScopedOrgFixture;
  const requests: Record<string, string> = {};

  async function seedRequest(fixture: ScopedOrgFixture, employeeId: string) {
    return withTenant(db.sql, { organizationId: fixture.orgId }, async (tx) => {
      const leave = new LeaveRepository();
      const types = await leave.getLeaveTypes(tx);
      const type =
        types[0] ??
        (await leave.createLeaveType(tx, {
          name: "Vacation",
          code: "vacation",
          requiresApproval: true,
        }));
      const request = await leave.createLeaveRequest(tx, {
        employeeId,
        leaveTypeId: type.id,
        startDate: "2026-07-06",
        endDate: "2026-07-06",
        workingDays: 1,
      });
      return request.id;
    });
  }

  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database) throw new Error("Docker is required for this suite");
    db = database;
    await runMigrations(db.connectionString);
    a = await seedScopedOrg(db.sql, "policy-a");
    b = await seedScopedOrg(db.sql, "policy-b");
    requests["report"] = await seedRequest(a, a.report.employeeId);
    requests["peer"] = await seedRequest(a, a.peer.employeeId);
    requests["manager"] = await seedRequest(a, a.manager.employeeId);
    requests["otherTenant"] = await seedRequest(b, b.report.employeeId);
    app = createApp({
      sql: db.sql,
      authPort: fixtureAuthPort([a.admin, a.manager, a.report, b.manager]),
    });
  }, 60000);
  afterAll(async () => {
    if (db) await db.close();
  });

  const decide = (id: string | undefined, who = a.manager) =>
    app.request(`/v1/leave/requests/${id}/decide`, {
      method: "POST",
      headers: as(who, true),
      body: JSON.stringify({ decision: "reject", reason: "Coverage" }),
    });

  describe("POST /v1/leave/requests/:id/decide", () => {
    it("lets a manager decide a direct report's request", async () => {
      expect((await decide(requests["report"])).status).toBe(200);
    });
    it("forbids deciding a non-report's request", async () => {
      expect((await decide(requests["peer"])).status).toBe(403);
    });
    it("forbids a manager deciding their own request", async () => {
      expect((await decide(requests["manager"])).status).toBe(403);
    });
    it("forbids an employee deciding requests", async () => {
      expect((await decide(requests["peer"], a.report)).status).toBe(403);
    });
    it("returns 404 for another tenant's request", async () => {
      expect((await decide(requests["otherTenant"])).status).toBe(404);
    });
  });

  describe("employee-addressed reads", () => {
    const paths = (employeeId: string) => [
      `/v1/leave/balance?employeeId=${employeeId}`,
      `/v1/time/timesheet?employeeId=${employeeId}&startDate=2026-03-01&endDate=2026-03-07`,
      `/v1/time/time-bank?employeeId=${employeeId}`,
    ];

    it("lets a manager read a direct report", async () => {
      for (const path of paths(a.report.employeeId)) {
        const res = await app.request(path, { headers: as(a.manager) });
        // The fixture has no work schedule, so the timesheet stops at 409
        // SCHEDULE_NOT_CONFIGURED, which is past the authorization check.
        expect([200, 409], path).toContain(res.status);
      }
    });

    it("forbids a manager reading a non-report", async () => {
      for (const path of paths(a.peer.employeeId)) {
        const res = await app.request(path, { headers: as(a.manager) });
        expect(res.status, path).toBe(403);
      }
    });

    it("forbids an employee reading a colleague", async () => {
      for (const path of paths(a.peer.employeeId)) {
        const res = await app.request(path, { headers: as(a.report) });
        expect(res.status, path).toBe(403);
      }
    });

    it("never returns another tenant's employee", async () => {
      for (const path of paths(b.report.employeeId)) {
        const res = await app.request(path, { headers: as(a.admin) });
        expect([403, 404], path).toContain(res.status);
      }
    });
  });

  describe("POST /v1/time/time-bank/entries", () => {
    const entry = (employeeId: string, who = a.manager) =>
      app.request("/v1/time/time-bank/entries", {
        method: "POST",
        headers: as(who, true),
        body: JSON.stringify({
          employeeId,
          type: "overtime_accrual",
          minutes: 60,
          referenceDate: "2026-03-02",
        }),
      });

    it("lets a manager credit a direct report", async () => {
      expect((await entry(a.report.employeeId)).status).toBe(201);
    });
    it("forbids a manager crediting a non-report", async () => {
      expect((await entry(a.peer.employeeId)).status).toBe(403);
    });
    it("forbids a manager crediting themselves", async () => {
      expect((await entry(a.manager.employeeId)).status).toBe(403);
    });
    it("forbids employees", async () => {
      expect((await entry(a.report.employeeId, a.report)).status).toBe(403);
    });
    it("returns 404 for another tenant's employee", async () => {
      expect((await entry(b.report.employeeId, a.admin)).status).toBe(404);
    });
  });
});
