import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getTestDatabase, type TestDatabase } from "@librehr/testing";
import { EmployeeRepository, withTenant } from "@librehr/db";
import { runMigrations } from "@librehr/db/migrate";
import type { AuthUser } from "@librehr/contracts";
import type { AuthPort } from "../src/ports/auth.js";
import { createApp } from "../src/app.js";

const org = "10000000-0000-0000-0000-000000000101";
const otherOrg = "10000000-0000-0000-0000-000000000102";
const admin: AuthUser = {
  id: "10000000-0000-0000-0000-000000000103",
  email: "admin@history.invalid",
  name: "Admin",
  role: "admin",
  organizationId: org,
};
const employee: AuthUser = {
  id: "10000000-0000-0000-0000-000000000104",
  email: "employee@history.invalid",
  name: "Employee",
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
    const user =
      token === "admin" ? admin : token === "employee" ? employee : null;
    return user
      ? { user, token, expiresAt: new Date(Date.now() + 60000) }
      : null;
  },
  async revokeSession() {},
};

describe("employment history", () => {
  let db: TestDatabase;
  let app: ReturnType<typeof createApp>;
  let id: string;
  let otherId: string;
  let concurrentId: string;
  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database)
      throw new Error("Docker is required for employment history tests");
    db = database;
    await runMigrations(db.connectionString);
    await db.sql`INSERT INTO organizations (id, name, slug) VALUES (${org}, 'History', 'history-test'), (${otherOrg}, 'Other', 'history-other')`;
    await db.sql`INSERT INTO users (id, email, name) VALUES (${admin.id}, ${admin.email}, ${admin.name}), (${employee.id}, ${employee.email}, ${employee.name})`;
    id = (
      await withTenant(db.sql, { organizationId: org }, (tx) =>
        new EmployeeRepository().create(tx, {
          userId: employee.id,
          firstName: "Test",
          lastName: "Employee",
          email: employee.email,
        }),
      )
    ).id;
    concurrentId = (
      await withTenant(db.sql, { organizationId: org }, (tx) =>
        new EmployeeRepository().create(tx, {
          firstName: "Concurrent",
          lastName: "Employee",
          email: "concurrent@history.invalid",
        }),
      )
    ).id;
    otherId = (
      await withTenant(db.sql, { organizationId: otherOrg }, (tx) =>
        new EmployeeRepository().create(tx, {
          firstName: "Other",
          lastName: "Tenant",
          email: "other@history.invalid",
        }),
      )
    ).id;
    app = createApp({ sql: await db.appSql(), authPort: auth });
  }, 30000);
  afterAll(async () => {
    if (db) await db.close();
  });
  const headers = {
    Authorization: "Bearer admin",
    "Content-Type": "application/json",
  };
  it("creates and lists effective-dated periods without overwriting earlier history", async () => {
    const create = (data: object) =>
      app.request(`/v1/employees/${id}/employment-history`, {
        method: "POST",
        headers,
        body: JSON.stringify(data),
      });
    expect(
      (
        await create({
          jobTitle: "Associate",
          employmentType: "indefinido",
          startDate: "2024-01-01",
          endDate: "2024-12-31",
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await create({
          jobTitle: "Lead",
          employmentType: "indefinido",
          startDate: "2025-01-01",
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await create({
          jobTitle: "Overlap",
          employmentType: "indefinido",
          startDate: "2024-12-31",
          endDate: "2025-03-01",
        })
      ).status,
    ).toBe(409);
    const result = await app.request(`/v1/employees/${id}/employment-history`, {
      headers,
    });
    expect(result.status).toBe(200);
    const data = (await result.json()) as { jobTitle: string }[];
    expect(data.map((period) => period.jobTitle)).toEqual([
      "Lead",
      "Associate",
    ]);
    const auditRows = await withTenant(
      db.sql,
      { organizationId: org },
      (tx) =>
        tx<
          { action: string; metadata: unknown }[]
        >`SELECT action, metadata FROM audit_log WHERE resource_id = ${id} AND action = 'employee.employment_period_created'`,
    );
    expect(auditRows).toHaveLength(2);
    expect(auditRows.every((row) => row.metadata === null)).toBe(true);
  });
  it("enforces identity, write permissions, validation and tenant scope", async () => {
    const path = `/v1/employees/${id}/employment-history`;
    expect((await app.request(path)).status).toBe(401);
    expect(
      (
        await app.request(path, {
          headers: { Authorization: "Bearer employee" },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request(path, {
          method: "POST",
          headers: {
            Authorization: "Bearer employee",
            "Content-Type": "application/json",
          },
          body: "{}",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await app.request(path, {
          method: "POST",
          headers,
          body: JSON.stringify({
            jobTitle: "Bad",
            employmentType: "x",
            startDate: "2024-02-30",
          }),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await app.request(`/v1/employees/${otherId}/employment-history`, {
          headers,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await app.request(`/v1/employees/${concurrentId}/employment-history`, {
          headers: { Authorization: "Bearer employee" },
        })
      ).status,
    ).toBe(403);
  });
  it("serializes overlapping concurrent inserts", async () => {
    const create = () =>
      app.request(`/v1/employees/${concurrentId}/employment-history`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          jobTitle: "Engineer",
          employmentType: "indefinido",
          startDate: "2026-01-01",
        }),
      });
    const results = await Promise.all([create(), create()]);
    expect(results.map((response) => response.status).sort()).toEqual([
      201, 409,
    ]);
  });
});
