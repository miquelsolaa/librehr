import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  getTestDatabase,
  seedScopedOrg,
  type ScopedOrgFixture,
  type TestDatabase,
} from "@librehr/testing";
import { runMigrations } from "@librehr/db/migrate";
import { createApp } from "../src/app.js";
import { as, fixtureAuthPort } from "./support/fixture-app.js";

// ADM-004 data-subject export: the employee themselves or an admin.
describe("GET /v1/employees/:id/dsr-export", () => {
  let db: TestDatabase;
  let app: ReturnType<typeof createApp>;
  let a: ScopedOrgFixture;
  let b: ScopedOrgFixture;
  const path = (id: string) => `/v1/employees/${id}/dsr-export`;

  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database) throw new Error("Docker is required for this suite");
    db = database;
    await runMigrations(db.connectionString);
    a = await seedScopedOrg(db.sql, "dsr-a");
    b = await seedScopedOrg(db.sql, "dsr-b");
    app = createApp({
      sql: db.sql,
      authPort: fixtureAuthPort([a.admin, a.manager, a.report]),
    });
  }, 60000);
  afterAll(async () => {
    if (db) await db.close();
  });

  it("requires authentication", async () => {
    expect((await app.request(path(a.report.employeeId))).status).toBe(401);
  });

  it("exports the caller's own data and audits it", async () => {
    const res = await app.request(path(a.report.employeeId), {
      headers: as(a.report),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toHaveProperty("employee");
    const rows = await db.sql`
      SELECT 1 FROM audit_log
      WHERE action = 'employee.dsr_export' AND resource_id = ${a.report.employeeId}
    `;
    expect(rows.length).toBeGreaterThan(0);
  });

  it("forbids exporting someone else's data, even as their manager", async () => {
    const res = await app.request(path(a.report.employeeId), {
      headers: as(a.manager),
    });
    expect(res.status).toBe(403);
  });

  it("returns 404 for another tenant's employee", async () => {
    const res = await app.request(path(b.report.employeeId), {
      headers: as(a.admin),
    });
    expect(res.status).toBe(404);
  });
});
