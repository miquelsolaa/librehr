import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDatabase, type TestDatabase } from "@openhr/testing";
import { runMigrations } from "../src/migrate.js";
import { withTenant } from "../src/with-tenant.js";
import { TENANT_TABLES } from "../src/rls/helpers.js";

describe("RLS Tenant Isolation Integration Tests", () => {
  let db: TestDatabase | null = null;

  beforeAll(async () => {
    db = await getTestDatabase();
    if (db) {
      await runMigrations(db.connectionString);
    }
  });

  afterAll(async () => {
    if (db) {
      await db.close();
    }
  });

  it("proves every tenant table has RLS enabled and forced", async () => {
    if (!db) {
      return; // Skip if database is not available in environment
    }

    const rows = await db.sql<
      { tablename: string; rowsecurity: boolean; forcerowsecurity: boolean }[]
    >`
      SELECT c.relname as tablename, c.relrowsecurity as rowsecurity, c.relforcerowsecurity as forcerowsecurity
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname = ANY(${TENANT_TABLES})
    `;

    expect(rows.length).toBe(TENANT_TABLES.length);
    for (const row of rows) {
      expect(
        row.rowsecurity,
        `Table ${row.tablename} must have relrowsecurity = true`,
      ).toBe(true);
      expect(
        row.forcerowsecurity,
        `Table ${row.tablename} must have relforcerowsecurity = true`,
      ).toBe(true);
    }
  });

  it("proves Org A cannot select, update, or delete Org B rows", async () => {
    if (!db) {
      return;
    }

    const orgAId = "a0000000-0000-0000-0000-000000000001";
    const orgBId = "b0000000-0000-0000-0000-000000000002";

    // 1. Create both organizations as owner (without RLS constraint)
    await db.sql`
      INSERT INTO "organizations" ("id", "name", "slug")
      VALUES (${orgAId}, 'Org Alpha', 'org-alpha'), (${orgBId}, 'Org Beta', 'org-beta')
      ON CONFLICT ("id") DO NOTHING
    `;

    // 2. Org A creates an employee in its tenant context
    const empAId = "a1111111-1111-1111-1111-111111111111";
    await withTenant(db.sql, { organizationId: orgAId }, async (tx) => {
      await tx`
        INSERT INTO "employees" ("id", "organization_id", "first_name", "last_name", "email")
        VALUES (${empAId}, ${orgAId}, 'Alice', 'Alpha', 'alice@alpha.test')
        ON CONFLICT ("id") DO NOTHING
      `;
    });

    // 3. Org B attempts to SELECT Org A's employee -> Must return 0 rows
    await withTenant(db.sql, { organizationId: orgBId }, async (tx) => {
      const rows = await tx`
        SELECT * FROM "employees" WHERE "id" = ${empAId}
      `;
      expect(rows.length).toBe(0);
    });

    // 4. Org B attempts to UPDATE Org A's employee -> Must affect 0 rows
    await withTenant(db.sql, { organizationId: orgBId }, async (tx) => {
      const result = await tx`
        UPDATE "employees" SET "first_name" = 'Hacked' WHERE "id" = ${empAId}
      `;
      expect(result.count).toBe(0);
    });

    // 5. Org B attempts to DELETE Org A's employee -> Must affect 0 rows
    await withTenant(db.sql, { organizationId: orgBId }, async (tx) => {
      const result = await tx`
        DELETE FROM "employees" WHERE "id" = ${empAId}
      `;
      expect(result.count).toBe(0);
    });

    // 6. Org B attempts to INSERT with Org A's organization_id -> Must fail WITH CHECK policy
    await expect(
      withTenant(db.sql, { organizationId: orgBId }, async (tx) => {
        await tx`
          INSERT INTO "employees" ("organization_id", "first_name", "last_name", "email")
          VALUES (${orgAId}, 'Malicious', 'Inject', 'malicious@alpha.test')
        `;
      }),
    ).rejects.toThrow();
  });
});
