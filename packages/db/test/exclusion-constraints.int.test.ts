import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDatabase, type TestDatabase } from "@openhr/testing";
import { runMigrations } from "../src/migrate.js";
import { withTenant } from "../src/with-tenant.js";

describe("Exclusion Constraints Integration Tests", () => {
  let db: TestDatabase | null = null;
  const orgId = "d0000000-0000-0000-0000-000000000001";
  const empId = "d1111111-1111-1111-1111-111111111111";

  beforeAll(async () => {
    db = await getTestDatabase();
    if (db) {
      await runMigrations(db.connectionString);
      await db.sql`
        INSERT INTO "organizations" ("id", "name", "slug")
        VALUES (${orgId}, 'Constraint Org', 'constraint-org')
        ON CONFLICT ("id") DO NOTHING
      `;
      await db.sql`
        INSERT INTO "employees" ("id", "organization_id", "first_name", "last_name", "email")
        VALUES (${empId}, ${orgId}, 'Contract', 'Worker', 'contract.worker@test.local')
        ON CONFLICT ("id") DO NOTHING
      `;
    }
  });

  afterAll(async () => {
    if (db) {
      await db.close();
    }
  });

  it("rejects overlapping active employments for the same employee", async () => {
    if (!db) return;

    // Period 1: 2026-01-01 to 2026-06-30
    await withTenant(db.sql, { organizationId: orgId }, async (tx) => {
      await tx`
        INSERT INTO "employments" ("organization_id", "employee_id", "job_title", "start_date", "end_date")
        VALUES (${orgId}, ${empId}, 'Role A', '2026-01-01', '2026-06-30')
      `;
    });

    // Period 2: Overlapping period (2026-05-01 to 2026-12-31) -> Must throw exclusion constraint violation
    await expect(
      withTenant(db.sql, { organizationId: orgId }, async (tx) => {
        await tx`
          INSERT INTO "employments" ("organization_id", "employee_id", "job_title", "start_date", "end_date")
          VALUES (${orgId}, ${empId}, 'Role B', '2026-05-01', '2026-12-31')
        `;
      }),
    ).rejects.toThrow();

    // Period 3: Non-overlapping subsequent period (2026-07-01 to 2026-12-31) -> Must succeed
    await expect(
      withTenant(db.sql, { organizationId: orgId }, async (tx) => {
        await tx`
          INSERT INTO "employments" ("organization_id", "employee_id", "job_title", "start_date", "end_date")
          VALUES (${orgId}, ${empId}, 'Role C', '2026-07-01', '2026-12-31')
        `;
      }),
    ).resolves.not.toThrow();
  });
});
