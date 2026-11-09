import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  getTestDatabase,
  seedScopedOrg,
  type ScopedOrgFixture,
  type TestDatabase,
} from "@librehr/testing";
import { runMigrations } from "@librehr/db/migrate";
import { AuditRepository, withTenant } from "@librehr/db";
import { createApp } from "../src/app.js";
import { as, fixtureAuthPort } from "./support/fixture-app.js";

// ADM-002: the audit log is readable by admins and auditors of the
// organization only.
describe("GET /v1/audit", () => {
  let db: TestDatabase;
  let app: ReturnType<typeof createApp>;
  let a: ScopedOrgFixture;
  let b: ScopedOrgFixture;
  let otherTenantEntry = "";

  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database) throw new Error("Docker is required for this suite");
    db = database;
    await runMigrations(db.connectionString);
    a = await seedScopedOrg(db.sql, "audit-a");
    b = await seedScopedOrg(db.sql, "audit-b");
    const log = (fixture: ScopedOrgFixture, resourceId: string) =>
      withTenant(
        db.sql,
        { organizationId: fixture.orgId, userId: fixture.admin.id },
        (tx) =>
          new AuditRepository().log(tx, {
            actorId: fixture.admin.id,
            action: "fixture.event",
            resourceType: "employee",
            resourceId,
          }),
      );
    await log(a, a.report.employeeId);
    await log(b, b.report.employeeId);
    otherTenantEntry = b.report.employeeId;
    app = createApp({
      sql: db.sql,
      authPort: fixtureAuthPort([a.admin, a.auditor, a.manager, a.report]),
    });
  }, 60000);
  afterAll(async () => {
    if (db) await db.close();
  });

  it("requires authentication", async () => {
    expect((await app.request("/v1/audit")).status).toBe(401);
  });

  it("lets admins and auditors read their organization's log", async () => {
    for (const who of [a.admin, a.auditor]) {
      const res = await app.request("/v1/audit?limit=100", {
        headers: as(who),
      });
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain(a.report.employeeId);
      expect(text).not.toContain(otherTenantEntry);
    }
  });

  it("forbids managers and employees", async () => {
    for (const who of [a.manager, a.report]) {
      expect(
        (await app.request("/v1/audit", { headers: as(who) })).status,
      ).toBe(403);
    }
  });

  it("rejects invalid filters", async () => {
    const res = await app.request("/v1/audit?limit=abc", {
      headers: as(a.admin),
    });
    expect(res.status).toBe(400);
  });
});
