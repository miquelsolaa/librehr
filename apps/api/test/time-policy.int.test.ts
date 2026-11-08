import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getTestDatabase, type TestDatabase } from "@librehr/testing";
import { runMigrations } from "@librehr/db/migrate";
import { withTenant, EmployeeRepository } from "@librehr/db";
import { createApp } from "../src/app.js";
import type { AuthPort } from "../src/ports/auth.js";
import type { AuthUser } from "@librehr/contracts";
const org = "50000000-0000-0000-0000-000000000091";
const user: AuthUser = {
  id: "50000000-0000-0000-0000-000000000011",
  email: "time@example.invalid",
  name: "Time User",
  role: "employee",
  organizationId: org,
};
const admin: AuthUser = {
  id: "50000000-0000-0000-0000-000000000012",
  email: "admin@example.invalid",
  name: "Admin",
  role: "admin",
  organizationId: org,
};
const manager: AuthUser = {
  id: "50000000-0000-0000-0000-000000000013",
  email: "manager@example.invalid",
  name: "Manager",
  role: "manager",
  organizationId: org,
};
const auth: AuthPort = {
  async verifyCredentials() {
    return null;
  },
  async createSession(u) {
    return { user: u, token: u.id, expiresAt: new Date(Date.now() + 60000) };
  },
  async getSession(token) {
    const sessionUser =
      token === "test"
        ? user
        : token === "admin"
          ? admin
          : token === "manager"
            ? manager
            : null;
    return sessionUser
      ? { user: sessionUser, token, expiresAt: new Date(Date.now() + 60000) }
      : null;
  },
  async revokeSession() {},
};
describe("time schedule requirements", () => {
  let db: TestDatabase;
  let app: ReturnType<typeof createApp>;
  let employeeId: string;
  let otherEmployeeId: string;
  let peerId: string;
  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database)
      throw new Error("Docker is required for time schedule tests");
    db = database;
    await runMigrations(db.connectionString);
    await db.sql`INSERT INTO organizations (id, name, slug) VALUES (${org}, 'Time test', 'time-policy-test')`;
    await db.sql`INSERT INTO users (id, email, name) VALUES (${user.id}, ${user.email}, ${user.name}), (${admin.id}, ${admin.email}, ${admin.name})`;
    employeeId = (
      await withTenant(db.sql, { organizationId: org }, (tx) =>
        new EmployeeRepository().create(tx, {
          userId: user.id,
          firstName: "Time",
          lastName: "User",
          email: user.email,
        }),
      )
    ).id;
    await db.sql`INSERT INTO users (id, email, name) VALUES (${manager.id}, ${manager.email}, ${manager.name})`;
    await withTenant(db.sql, { organizationId: org }, async (tx) => {
      const employees = new EmployeeRepository();
      const managerEmployee = await employees.create(tx, {
        userId: manager.id,
        firstName: "Manager",
        lastName: "Test",
        email: manager.email,
      });
      await tx`UPDATE employees SET manager_id = ${managerEmployee.id} WHERE id = ${employeeId}`;
      peerId = (
        await employees.create(tx, {
          firstName: "Peer",
          lastName: "Test",
          email: "peer@example.invalid",
        })
      ).id;
    });
    const otherOrg = "70000000-0000-0000-0000-000000000091";
    await db.sql`INSERT INTO organizations (id, name, slug) VALUES (${otherOrg}, 'Other tenant', 'time-policy-other')`;
    await withTenant(db.sql, { organizationId: otherOrg }, async (tx) => {
      otherEmployeeId = (
        await new EmployeeRepository().create(tx, {
          firstName: "Other",
          lastName: "Tenant",
          email: "other@example.invalid",
        })
      ).id;
      const rows = await tx<
        { id: string }[]
      >`INSERT INTO schedules (name, type, weekly_hours, is_default) VALUES ('Other tenant schedule', 'fixed', 40, true) RETURNING id`;
      const otherSchedule = rows[0];
      if (!otherSchedule) throw new Error("Schedule creation failed");
      await tx`INSERT INTO schedule_rules (schedule_id, day_of_week, expected_hours) VALUES (${otherSchedule.id}, 1, 8)`;
    });
    app = createApp({ sql: db.sql, authPort: auth });
  }, 30000);
  afterAll(async () => {
    if (db) await db.close();
  });
  it("rejects cross-tenant schedule assignment and timesheet access", async () => {
    const headers = {
      Authorization: "Bearer admin",
      "Content-Type": "application/json",
    };
    const rules = Array.from({ length: 7 }, (_, index) => ({
      dayOfWeek: index + 1,
      expectedHours: 0,
      breakMinutes: 0,
    }));
    const assignment = await app.request("/v1/schedules/assignments", {
      method: "POST",
      headers,
      body: JSON.stringify({
        employeeId: otherEmployeeId,
        name: "Other",
        effectiveFrom: "2026-01-01",
        minimumDailyRestHours: 12,
        rules,
      }),
    });
    expect(assignment.status).toBe(404);
    const timesheet = await app.request(
      `/v1/time/timesheet?startDate=2026-11-02&endDate=2026-11-02&employeeId=${otherEmployeeId}`,
      { headers },
    );
    expect(timesheet.status).toBe(404);
  });
  it("requires configured schedules for timesheets and official exports", async () => {
    for (const path of ["/v1/time/timesheet", "/v1/time/export"]) {
      const response = await app.request(
        `${path}?startDate=2026-11-02&endDate=2026-11-02`,
        { headers: { Authorization: "Bearer test" } },
      );
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        code: "SCHEDULE_NOT_CONFIGURED",
      });
    }
  });
  it("uses configured hours for timesheets and official exports", async () => {
    const rules = Array.from({ length: 7 }, (_, index) => ({
      dayOfWeek: index + 1,
      expectedHours: index === 0 ? 6 : 0,
      breakMinutes: 0,
    }));
    const data = {
      employeeId,
      name: "Configured schedule",
      effectiveFrom: "2026-01-01",
      minimumDailyRestHours: 12,
      rules,
    };
    const assign = (token: string, body: unknown) =>
      app.request("/v1/schedules/assignments", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    expect((await assign("test", data)).status).toBe(403);
    expect((await assign("admin", { ...data, rules: [] })).status).toBe(400);
    expect(
      (await assign("admin", { ...data, rules: rules.map(() => rules[0]) }))
        .status,
    ).toBe(400);
    const assigned = await assign("admin", data);
    expect(assigned.status).toBe(201);
    const created = (await assigned.json()) as { id: string };
    const audit = await withTenant(
      db.sql,
      { organizationId: org },
      (tx) =>
        tx`SELECT actor_id::text AS actor, resource_id::text AS resource FROM audit_log WHERE action = 'schedule.assign'`,
    );
    expect(audit).toEqual([
      expect.objectContaining({ actor: admin.id, resource: created.id }),
    ]);
    expect((await assign("admin", data)).status).toBe(409);
    const headers = { Authorization: "Bearer test" };
    const sheet = await app.request(
      "/v1/time/timesheet?startDate=2026-11-02&endDate=2026-11-02",
      { headers },
    );
    expect(sheet.status).toBe(200);
    expect(await sheet.json()).toMatchObject({ totalExpectedHours: 6 });
    const exportResponse = await app.request(
      "/v1/time/export?startDate=2026-11-02&endDate=2026-11-02",
      { headers },
    );
    expect(exportResponse.status).toBe(200);
  });

  it("limits manager timesheets and exports to direct reports in the same tenant", async () => {
    for (const path of ["/v1/time/timesheet", "/v1/time/export"]) {
      const query = "startDate=2026-11-02&endDate=2026-11-02";
      expect(
        (await app.request(`${path}?${query}&employeeId=${employeeId}`)).status,
      ).toBe(401);
      const headers = { Authorization: "Bearer manager" };
      expect(
        (
          await app.request(`${path}?${query}&employeeId=${employeeId}`, {
            headers,
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await app.request(`${path}?${query}&employeeId=${peerId}`, {
            headers,
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await app.request(`${path}?${query}&employeeId=${otherEmployeeId}`, {
            headers,
          })
        ).status,
      ).toBe(404);
      expect(
        (
          await app.request(`${path}?${query}&employeeId=${peerId}`, {
            headers: { Authorization: "Bearer test" },
          })
        ).status,
      ).toBe(403);
    }
  });
  it("counts overnight work on local days in timesheets and exports", async () => {
    await db.sql`UPDATE organizations SET timezone = 'Europe/Madrid' WHERE id = ${org}`;
    await withTenant(db.sql, { organizationId: org }, async (tx) => {
      await tx`INSERT INTO time_events (employee_id, event_type, occurred_at, recorded_at, source, actor_id, hash) VALUES (${employeeId}, 'clock_in', '2026-11-02T22:00:00Z', '2026-11-02T22:00:00Z', 'web', ${user.id}, 'local-day-in'), (${employeeId}, 'clock_out', '2026-11-03T02:00:00Z', '2026-11-03T02:00:00Z', 'web', ${user.id}, 'local-day-out')`;
    });
    for (const path of ["/v1/time/timesheet", "/v1/time/export"]) {
      const response = await app.request(
        `${path}?startDate=2026-11-03&endDate=2026-11-03`,
        { headers: { Authorization: "Bearer test" } },
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ totalWorkedMinutes: 180 });
    }
  });
  it("applies a referenced correction to local-day timesheets and exports", async () => {
    await withTenant(db.sql, { organizationId: org }, async (tx) => {
      const originals = await tx<
        { id: string }[]
      >`SELECT id FROM time_events WHERE hash = 'local-day-out' AND employee_id = ${employeeId}`;
      const original = originals[0];
      if (!original) throw new Error("Missing original event");
      await tx`INSERT INTO time_events (employee_id, event_type, occurred_at, recorded_at, source, actor_id, ref_event_id, reason, hash) VALUES (${employeeId}, 'clock_out', '2026-11-03T03:00:00Z', '2026-11-04T09:00:00Z', 'manual', ${user.id}, ${original.id}, 'Corrected clock out', 'local-day-correction')`;
    });
    for (const path of ["/v1/time/timesheet", "/v1/time/export"]) {
      const response = await app.request(
        `${path}?startDate=2026-11-03&endDate=2026-11-03`,
        { headers: { Authorization: "Bearer test" } },
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ totalWorkedMinutes: 240 });
    }
  });
});
