import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDatabase, type TestDatabase } from "@openhr/testing";
import { runMigrations } from "../src/migrate.js";
import { withTenant } from "../src/with-tenant.js";

describe("Append-Only Tables Protection Integration Tests", () => {
  let db: TestDatabase | null = null;
  const orgId = "c0000000-0000-0000-0000-000000000001";
  const empId = "c1111111-1111-1111-1111-111111111111";

  beforeAll(async () => {
    db = await getTestDatabase();
    if (db) {
      await runMigrations(db.connectionString);
      await db.sql`
        INSERT INTO "organizations" ("id", "name", "slug")
        VALUES (${orgId}, 'Append Only Org', 'append-only-org')
        ON CONFLICT ("id") DO NOTHING
      `;
      await db.sql`
        INSERT INTO "employees" ("id", "organization_id", "first_name", "last_name", "email")
        VALUES (${empId}, ${orgId}, 'Test', 'Worker', 'test.worker@test.local')
        ON CONFLICT ("id") DO NOTHING
      `;
    }
  });

  afterAll(async () => {
    if (db) {
      await db.close();
    }
  });

  it("prohibits UPDATE and DELETE on time_events", async () => {
    if (!db) return;

    const eventId = "e0000000-0000-0000-0000-000000000001";

    await withTenant(db.sql, { organizationId: orgId }, async (tx) => {
      await tx`
        INSERT INTO "time_events" ("id", "organization_id", "employee_id", "event_type", "occurred_at", "actor_id", "hash")
        VALUES (${eventId}, ${orgId}, ${empId}, 'clock_in', now(), ${empId}, 'dummyhash')
        ON CONFLICT ("id") DO NOTHING
      `;
    });

    // UPDATE should fail
    await expect(
      withTenant(db.sql, { organizationId: orgId }, async (tx) => {
        await tx`UPDATE "time_events" SET "reason" = 'Modified' WHERE "id" = ${eventId}`;
      }),
    ).rejects.toThrow(/append-only/i);

    // DELETE should fail
    await expect(
      withTenant(db.sql, { organizationId: orgId }, async (tx) => {
        await tx`DELETE FROM "time_events" WHERE "id" = ${eventId}`;
      }),
    ).rejects.toThrow(/append-only/i);
  });

  it("prohibits UPDATE and DELETE on leave_ledger", async () => {
    if (!db) return;

    const ledgerId = "l0000000-0000-0000-0000-000000000001";

    await withTenant(db.sql, { organizationId: orgId }, async (tx) => {
      await tx`
        INSERT INTO "leave_ledger" ("id", "organization_id", "employee_id", "entry_type", "amount", "effective_date")
        VALUES (${ledgerId}, ${orgId}, ${empId}, 'accrual', 2.5, '2026-01-01')
        ON CONFLICT ("id") DO NOTHING
      `;
    });

    await expect(
      withTenant(db.sql, { organizationId: orgId }, async (tx) => {
        await tx`UPDATE "leave_ledger" SET "amount" = 5.0 WHERE "id" = ${ledgerId}`;
      }),
    ).rejects.toThrow(/append-only/i);

    await expect(
      withTenant(db.sql, { organizationId: orgId }, async (tx) => {
        await tx`DELETE FROM "leave_ledger" WHERE "id" = ${ledgerId}`;
      }),
    ).rejects.toThrow(/append-only/i);
  });
});
