import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getTestDatabase, type TestDatabase } from "@librehr/testing";
import { runMigrations } from "@librehr/db/migrate";
import {
  withTenant,
  DepartmentRepository,
  EmployeeRepository,
  LeaveRepository,
} from "@librehr/db";
import { createApp } from "../src/app.js";
import type { AuthPort } from "../src/ports/auth.js";
import type { AuthUser } from "@librehr/contracts";
const org = "60000000-0000-0000-0000-000000000091";
const admin: AuthUser = {
  id: "60000000-0000-0000-0000-000000000011",
  email: "admin@example.invalid",
  name: "Admin",
  role: "admin",
  organizationId: org,
};
const staff: AuthUser = {
  id: "60000000-0000-0000-0000-000000000012",
  email: "staff@example.invalid",
  name: "Staff",
  role: "employee",
  organizationId: org,
};
const auth: AuthPort = {
  async verifyCredentials() {
    return null;
  },
  async createSession(user) {
    return { user, token: user.id, expiresAt: new Date(Date.now() + 60000) };
  },
  async getSession(token) {
    const user = token === "admin" ? admin : token === "staff" ? staff : null;
    return user
      ? { user, token, expiresAt: new Date(Date.now() + 60000) }
      : null;
  },
  async revokeSession() {},
};
describe("department coverage configuration", () => {
  let db: TestDatabase;
  let app: ReturnType<typeof createApp>;
  let departmentId: string;
  let leaveTypeId: string;
  let otherDepartmentId: string;
  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database) throw new Error("Docker is required for coverage tests");
    db = database;
    await runMigrations(db.connectionString);
    await db.sql`INSERT INTO organizations (id, name, slug) VALUES (${org}, 'Coverage test', 'coverage-policy-test')`;
    await db.sql`INSERT INTO users (id, email, name) VALUES (${admin.id}, ${admin.email}, ${admin.name}), (${staff.id}, ${staff.email}, ${staff.name})`;
    await withTenant(db.sql, { organizationId: org }, async (tx) => {
      departmentId = (
        await new DepartmentRepository().create(tx, { name: "Operations" })
      ).id;
      const employee = await new EmployeeRepository().create(tx, {
        firstName: "Test",
        lastName: "User",
        email: staff.email,
        userId: staff.id,
        departmentId,
      });
      const leave = new LeaveRepository();
      leaveTypeId = (
        await leave.createLeaveType(tx, {
          name: "Vacation",
          code: "vacation",
          isPaid: true,
          requiresApproval: true,
        })
      ).id;
      await leave.appendLedgerEntry(tx, {
        employeeId: employee.id,
        entryType: "accrual",
        amount: 10,
        effectiveDate: "2030-01-01",
      });
    });
    const otherOrg = "70000000-0000-0000-0000-000000000092";
    await db.sql`INSERT INTO organizations (id, name, slug) VALUES (${otherOrg}, 'Other coverage tenant', 'coverage-other')`;
    otherDepartmentId = (
      await withTenant(db.sql, { organizationId: otherOrg }, (tx) =>
        new DepartmentRepository().create(tx, { name: "Other team" }),
      )
    ).id;
    app = createApp({ sql: await db.appSql(), authPort: auth });
  }, 30000);
  afterAll(async () => {
    if (db) await db.close();
  });
  it("requires an explicit department policy and lets only administrators configure it", async () => {
    const request = () =>
      app.request("/v1/leave/requests", {
        method: "POST",
        headers: {
          Authorization: "Bearer staff",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          leaveTypeId,
          startDate: "2030-11-04",
          endDate: "2030-11-04",
        }),
      });
    const initial = await request();
    expect(initial.status).toBe(409);
    expect(await initial.json()).toMatchObject({
      code: "COVERAGE_NOT_CONFIGURED",
    });
    const setCoverage = (token: string, minPresencePercent: unknown) =>
      app.request(`/v1/org/departments/${departmentId}/coverage`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ minPresencePercent }),
      });
    expect((await setCoverage("staff", 0)).status).toBe(403);
    const crossTenant = await app.request(
      `/v1/org/departments/${otherDepartmentId}/coverage`,
      {
        method: "PUT",
        headers: {
          Authorization: "Bearer admin",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ minPresencePercent: 0 }),
      },
    );
    expect(crossTenant.status).toBe(404);
    expect((await setCoverage("admin", 101)).status).toBe(400);
    expect((await setCoverage("admin", 100)).status).toBe(200);
    const halfDay = await app.request("/v1/leave/requests", {
      method: "POST",
      headers: {
        Authorization: "Bearer staff",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        leaveTypeId,
        startDate: "2030-11-04",
        endDate: "2030-11-04",
        halfDayStart: true,
      }),
    });
    expect(halfDay.status).toBe(409);
    expect(await halfDay.json()).toMatchObject({
      code: "COVERAGE_UNVERIFIABLE",
    });
    const blocked = await request();
    expect(blocked.status).toBe(400);
    expect(await blocked.json()).toMatchObject({ code: "COVERAGE_THRESHOLD" });
    expect((await setCoverage("admin", 0)).status).toBe(200);
    expect((await request()).status).toBe(201);
    const audit = await withTenant(
      db.sql,
      { organizationId: org },
      (tx) =>
        tx`SELECT action FROM audit_log WHERE action = 'department.coverage.update'`,
    );
    expect(audit).toHaveLength(2);
  });
});
