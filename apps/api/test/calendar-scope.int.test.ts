import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getTestDatabase, type TestDatabase } from "@librehr/testing";
import { runMigrations } from "@librehr/db/migrate";
import { withTenant, EmployeeRepository, LeaveRepository } from "@librehr/db";
import { createApp } from "../src/app.js";
import type { AuthPort, AuthSession } from "../src/ports/auth.js";
import type { AuthUser } from "@librehr/contracts";

const org = "10000000-0000-0000-0000-000000000091";
const manager: AuthUser = {
  id: "10000000-0000-0000-0000-000000000011",
  email: "manager@example.invalid",
  name: "Manager",
  role: "manager",
  organizationId: org,
};
const employee: AuthUser = {
  id: "10000000-0000-0000-0000-000000000012",
  email: "employee@example.invalid",
  name: "Employee",
  role: "employee",
  organizationId: org,
};
const noProfile: AuthUser = {
  id: "10000000-0000-0000-0000-000000000013",
  email: "no-profile@example.invalid",
  name: "No profile",
  role: "employee",
  organizationId: org,
};
const sessions = new Map<string, AuthUser>([
  ["manager", manager],
  ["employee", employee],
  ["no-profile", noProfile],
]);
const auth: AuthPort = {
  async verifyCredentials() {
    return null;
  },
  async createSession(user) {
    return { user, token: user.id, expiresAt: new Date(Date.now() + 60000) };
  },
  async getSession(token): Promise<AuthSession | null> {
    const user = sessions.get(token);
    return user
      ? { user, token, expiresAt: new Date(Date.now() + 60000) }
      : null;
  },
  async revokeSession() {},
};

describe("calendar leave type scope", () => {
  let db: TestDatabase;
  let app: ReturnType<typeof createApp>;
  const day = new Date().toISOString().slice(0, 10);
  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database)
      throw new Error("Docker is required for the calendar isolation test");
    db = database;
    await runMigrations(db.connectionString);
    await db.sql`INSERT INTO organizations (id, name, slug) VALUES (${org}, 'Calendar test', 'calendar-scope-test')`;
    await db.sql`INSERT INTO users (id, email, name) VALUES (${manager.id}, ${manager.email}, ${manager.name}), (${employee.id}, ${employee.email}, ${employee.name})`;
    await withTenant(db.sql, { organizationId: org }, async (tx) => {
      const employees = new EmployeeRepository();
      const leave = new LeaveRepository();
      const managerEmployee = await employees.create(tx, {
        firstName: "Manager",
        lastName: "Test",
        email: manager.email,
        userId: manager.id,
      });
      const report = await employees.create(tx, {
        firstName: "Direct",
        lastName: "Report",
        email: employee.email,
        userId: employee.id,
        managerId: managerEmployee.id,
      });
      const peer = await employees.create(tx, {
        firstName: "Unrelated",
        lastName: "Peer",
        email: "peer@example.invalid",
      });
      const type = await leave.createLeaveType(tx, {
        name: "Private leave",
        code: "private",
        isPaid: true,
        requiresApproval: true,
      });
      for (const person of [report, peer]) {
        const request = await leave.createLeaveRequest(tx, {
          employeeId: person.id,
          leaveTypeId: type.id,
          startDate: day,
          endDate: day,
          workingDays: 1,
        });
        await leave.approveLeaveRequest(tx, request.id, managerEmployee.id);
      }
    });
    const otherOrg = "20000000-0000-0000-0000-000000000091";
    await db.sql`INSERT INTO organizations (id, name, slug) VALUES (${otherOrg}, 'Other tenant', 'other-calendar-scope')`;
    await withTenant(db.sql, { organizationId: otherOrg }, async (tx) => {
      const person = await new EmployeeRepository().create(tx, {
        firstName: "Other",
        lastName: "Tenant",
        email: "other@example.invalid",
      });
      const leave = new LeaveRepository();
      const type = await leave.createLeaveType(tx, {
        name: "Private leave",
        code: "private",
        isPaid: true,
        requiresApproval: true,
      });
      const request = await leave.createLeaveRequest(tx, {
        employeeId: person.id,
        leaveTypeId: type.id,
        startDate: day,
        endDate: day,
        workingDays: 1,
      });
      await leave.approveLeaveRequest(tx, request.id, person.id);
    });
    app = createApp({ sql: await db.appSql(), authPort: auth });
  }, 30000);
  afterAll(async () => {
    if (db) await db.close();
  });
  it("rejects unauthenticated calendar requests", async () => {
    expect((await app.request("/v1/calendar/team-absences")).status).toBe(401);
    expect((await app.request("/v1/calendar/feed.ics")).status).toBe(401);
  });
  it("shows a manager only direct-report leave types in JSON and ICS", async () => {
    const headers = { Authorization: "Bearer manager" };
    const response = await app.request(
      `/v1/calendar/team-absences?startDate=${day}&endDate=${day}`,
      { headers },
    );
    expect(response.status).toBe(200);
    const rows = (await response.json()) as Array<{
      employeeName: string;
      leaveTypeName: string;
    }>;
    expect(
      rows.find((r) => r.employeeName === "Direct Report")?.leaveTypeName,
    ).toBe("Private leave");
    expect(
      rows.find((r) => r.employeeName === "Unrelated Peer")?.leaveTypeName,
    ).toBe("Away");
    expect(rows.some((r) => r.employeeName === "Other Tenant")).toBe(false);
    const feed = await app.request("/v1/calendar/feed.ics", { headers });
    const body = await feed.text();
    expect(body).toContain("Direct Report - Private leave");
    expect(body).toContain("Unrelated Peer - Away");
    expect(body).not.toContain("Unrelated Peer - Private leave");
    expect(body).not.toContain("Other Tenant");
  });
  it("shows an employee their own type but masks colleagues", async () => {
    const response = await app.request(
      `/v1/calendar/team-absences?startDate=${day}&endDate=${day}`,
      { headers: { Authorization: "Bearer employee" } },
    );
    const rows = (await response.json()) as Array<{
      employeeName: string;
      leaveTypeName: string;
    }>;
    expect(
      rows.find((r) => r.employeeName === "Direct Report")?.leaveTypeName,
    ).toBe("Private leave");
    expect(
      rows.find((r) => r.employeeName === "Unrelated Peer")?.leaveTypeName,
    ).toBe("Away");
  });
  it("limits leave request lists to the manager and direct reports", async () => {
    const headers = { Authorization: "Bearer manager" };
    const response = await app.request("/v1/leave/requests", { headers });
    expect(response.status).toBe(200);
    const rows = (await response.json()) as Array<{
      employeeId: string;
      employeeName: string;
    }>;
    expect(rows.map((row) => row.employeeName)).toContain("Direct Report");
    expect(rows.map((row) => row.employeeName)).not.toContain("Unrelated Peer");
    expect(rows.map((row) => row.employeeName)).not.toContain("Other Tenant");
    const allCalendar = await app.request(
      `/v1/calendar/team-absences?startDate=${day}&endDate=${day}`,
      { headers },
    );
    const visible = (await allCalendar.json()) as Array<{
      employeeId: string;
      employeeName: string;
    }>;
    const peer = visible.find((row) => row.employeeName === "Unrelated Peer");
    expect(peer).toBeDefined();
    const targeted = await app.request(
      `/v1/leave/requests?employeeId=${peer!.employeeId}`,
      { headers },
    );
    expect(targeted.status).toBe(200);
    expect(await targeted.json()).toEqual([]);
  });
  it("rejects on-behalf leave requests from users without an employee profile", async () => {
    const list = await app.request("/v1/leave/requests", {
      headers: { Authorization: "Bearer manager" },
    });
    const rows = (await list.json()) as Array<{
      employeeId: string;
      leaveTypeId: string;
    }>;
    const row = rows[0];
    expect(row).toBeDefined();
    const response = await app.request("/v1/leave/requests", {
      method: "POST",
      headers: {
        Authorization: "Bearer no-profile",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        employeeId: row!.employeeId,
        leaveTypeId: row!.leaveTypeId,
        startDate: "2026-11-05",
        endDate: "2026-11-05",
      }),
    });
    expect(response.status).toBe(403);
  });
});
