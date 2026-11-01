import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDatabase, type TestDatabase } from "@openhr/testing";
import { runMigrations } from "../src/migrate.js";
import { withTenant } from "../src/with-tenant.js";
import { AuditRepository } from "../src/repositories/audit.repository.js";

describe("AuditRepository Integration Tests (ADM-002)", () => {
  let db: TestDatabase | null = null;
  const auditRepo = new AuditRepository();

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

  it("records immutable audit log entries and lists them with filters", async () => {
    if (!db) {
      return;
    }

    const orgId = "e2000000-0000-0000-0000-000000000001";
    await db.sql`
      INSERT INTO "organizations" ("id", "name", "slug")
      VALUES (${orgId}, 'Beta Corp', 'beta-corp')
      ON CONFLICT ("id") DO NOTHING
    `;

    await withTenant(db.sql, { organizationId: orgId }, async (tx) => {
      // 1. Log a reveal event
      const entry = await auditRepo.log(tx, {
        action: "employee.reveal_sensitive",
        resourceType: "employee",
        resourceId: "emp-123",
        metadata: { field: "nationalId", ip: "127.0.0.1" },
      });

      expect(entry.id).toBeDefined();
      expect(entry.action).toBe("employee.reveal_sensitive");
      expect(entry.resourceType).toBe("employee");
      expect(entry.resourceId).toBe("emp-123");

      // 2. Query the audit logs
      const logs = await auditRepo.list(tx, {
        resourceType: "employee",
        resourceId: "emp-123",
      });

      expect(logs.length).toBeGreaterThanOrEqual(1);
      const found = logs.find((l) => l.id === entry.id);
      expect(found).toBeDefined();
      expect(found?.metadata).toEqual({ field: "nationalId", ip: "127.0.0.1" });
    });
  });
});
