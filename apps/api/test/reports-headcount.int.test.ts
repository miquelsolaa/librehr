import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getTestDatabase, type TestDatabase } from "@librehr/testing";
import { withTenant } from "@librehr/db";
import { runMigrations } from "@librehr/db/migrate";
import { createApp } from "../src/app.js";
import type { AuthPort } from "../src/ports/auth.js";
import type { AuthUser } from "@librehr/contracts";

const org = "80000000-0000-0000-0000-000000000001";
const otherOrg = "80000000-0000-0000-0000-000000000002";
const auth: AuthPort = {
  async verifyCredentials() {
    return null;
  },
  async createSession(user: AuthUser) {
    return { user, token: user.role, expiresAt: new Date(Date.now() + 60000) };
  },
  async getSession(token) {
    if (token !== "admin" && token !== "employee") return null;
    return {
      user: {
        id: "80000000-0000-0000-0000-000000000003",
        email: "test@example.invalid",
        name: "Test",
        role: token,
        organizationId: org,
      },
      token,
      expiresAt: new Date(Date.now() + 60000),
    };
  },
  async revokeSession() {},
};

describe("headcount report", () => {
  let db: TestDatabase;
  let app: ReturnType<typeof createApp>;
  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database)
      throw new Error("Docker is required for report isolation tests");
    db = database;
    await runMigrations(db.connectionString);
    await db.sql`INSERT INTO organizations (id, name, slug) VALUES (${org}, 'Report', 'report-test'), (${otherOrg}, 'Other', 'report-other')`;
    for (const tenant of [org, otherOrg]) {
      await withTenant(db.sql, { organizationId: tenant }, async (tx) => {
        const rows = await tx<
          { id: string }[]
        >`INSERT INTO employees (first_name, last_name, email) VALUES ('Test', 'Person', 'person@example.invalid') RETURNING id`;
        await tx`INSERT INTO employments (employee_id, job_title, start_date) VALUES (${rows[0]!.id}, 'Employee', '2025-01-01')`;
      });
    }
    app = createApp({ sql: await db.appSql(), authPort: auth });
  }, 30000);
  afterAll(async () => {
    if (db) await db.close();
  });

  it("requires authentication and administrator access", async () => {
    const path =
      "/v1/reports/headcount?startDate=2026-01-01&endDate=2026-12-31";
    expect((await app.request(path)).status).toBe(401);
    expect(
      (
        await app.request(path, {
          headers: { Authorization: "Bearer employee" },
        })
      ).status,
    ).toBe(403);
  });
  it("validates real ordered dates", async () => {
    for (const query of [
      "startDate=2026-02-30&endDate=2026-03-01",
      "startDate=2026-03-02&endDate=2026-03-01",
    ]) {
      expect(
        (
          await app.request(`/v1/reports/headcount?${query}`, {
            headers: { Authorization: "Bearer admin" },
          })
        ).status,
      ).toBe(400);
    }
  });
  it("returns only the current organization's headcount", async () => {
    const res = await app.request(
      "/v1/reports/headcount?startDate=2026-01-01&endDate=2026-12-31",
      { headers: { Authorization: "Bearer admin" } },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      headcount: { startingHeadcount: 1, endingHeadcount: 1 },
    });
  });
  it("exports the scoped headcount as CSV and audits the export", async () => {
    const path =
      "/v1/reports/headcount/export?startDate=2026-01-01&endDate=2026-12-31";
    expect((await app.request(path)).status).toBe(401);
    expect(
      (
        await app.request(path, {
          headers: { Authorization: "Bearer employee" },
        })
      ).status,
    ).toBe(403);
    const response = await app.request(path, {
      headers: { Authorization: "Bearer admin" },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("content-disposition")).toContain("attachment");
    expect(await response.text()).toBe(
      "period_start,period_end,starting_headcount,ending_headcount,joiners,leavers,net_change,turnover_rate_percent\r\n2026-01-01,2026-12-31,1,1,0,0,0,0\r\n",
    );
    const entries = await withTenant(
      db.sql,
      { organizationId: org },
      (tx) =>
        tx<
          { action: string; metadata: unknown }[]
        >`SELECT action, metadata FROM audit_log WHERE action = 'report.headcount_export'`,
    );
    expect(entries).toHaveLength(1);
    const metadata = entries[0]?.metadata;
    expect(
      typeof metadata === "string" ? JSON.parse(metadata) : metadata,
    ).toMatchObject({ startDate: "2026-01-01", endDate: "2026-12-31" });
  });
  it("refuses to calculate when employment data is missing", async () => {
    await withTenant(db.sql, { organizationId: org }, async (tx) => {
      await tx`INSERT INTO employees (first_name, last_name, email) VALUES ('Missing', 'Start', 'missing@example.invalid')`;
    });
    const res = await app.request(
      "/v1/reports/headcount?startDate=2026-01-01&endDate=2026-12-31",
      { headers: { Authorization: "Bearer admin" } },
    );
    expect(res.status).toBe(409);
    const exportResponse = await app.request(
      "/v1/reports/headcount/export?startDate=2026-01-01&endDate=2026-12-31",
      { headers: { Authorization: "Bearer admin" } },
    );
    expect(exportResponse.status).toBe(409);
  });
});
