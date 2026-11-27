import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createRoleSeparatedDatabase,
  getTestDatabase,
  type RoleSeparatedDatabase,
  type TestDatabase,
} from "@librehr/testing";
import { runMigrations } from "../src/migrate.js";
import { withTenant } from "../src/with-tenant.js";
import { LeaveRepository } from "../src/repositories/leave.repository.js";
import {
  TimeRepository,
  type TimeChainSigner,
} from "../src/repositories/time.repository.js";
import {
  RetentionRepository,
  sweepPasswordResetTokens,
  type RetentionCountCutoffs,
} from "../src/repositories/retention.repository.js";

// The real HMAC lives in @librehr/core; the repository only needs a signer
// that is a pure function of the link it is given.
const sign: TimeChainSigner = (link) =>
  createHash("sha256").update(JSON.stringify(link)).digest("hex");

// ADM-005 (issue #32): retention_policies (migration 0042) and the
// report-only eligibility counts, used by the runtime role under RLS.
describe("retention policies and eligibility counts (0042)", () => {
  let base: TestDatabase;
  let db: RoleSeparatedDatabase;
  const repo = new RetentionRepository();
  const leave = new LeaveRepository();
  const time = new TimeRepository();
  const orgA = randomUUID();
  const orgB = randomUUID();
  const userId = randomUUID();

  const cutoffs: RetentionCountCutoffs = {
    timeRecords: new Date("2022-01-01T00:00:00Z"),
    leaveRecords: "2022-01-01",
    auditLog: new Date("2021-01-01T00:00:00Z"),
    deletedDocuments: new Date("2026-11-01T00:00:00Z"),
    statutoryDocuments: new Date("2022-11-01T00:00:00Z"),
    statutoryDocumentCategories: ["contracts", "payslips"],
    notifications: new Date("2026-01-01T00:00:00Z"),
    invitations: new Date("2026-01-01T00:00:00Z"),
  };

  async function seed(org: string): Promise<void> {
    await db.adminSql`INSERT INTO organizations (id, name, slug)
      VALUES (${org}, ${org}, ${org})`;
    await withTenant(db.adminSql, { organizationId: org }, async (tx) => {
      const leaver = randomUUID();
      const stayer = randomUUID();
      await tx`INSERT INTO employees (id, first_name, last_name, email, status, termination_date)
        VALUES (${leaver}, 'Left', 'Before', ${`${leaver}@example.invalid`}, 'terminated', '2020-01-15'),
               (${stayer}, 'Still', 'Here', ${`${stayer}@example.invalid`}, 'active', NULL)`;
      const type = await leave.createLeaveType(tx, {
        name: "Vacation",
        code: "vacation",
      });
      for (const employeeId of [leaver, stayer]) {
        await leave.createLeaveRequest(tx, {
          employeeId,
          leaveTypeId: type.id,
          startDate: "2019-06-03",
          endDate: "2019-06-03",
          workingDays: 1,
        });
        // Two ledger rows each: only the leaver's count (termination basis).
        for (const entryType of ["accrual", "usage"]) {
          await leave.appendLedgerEntry(tx, {
            employeeId,
            leaveTypeId: type.id,
            entryType,
            amount: entryType === "usage" ? -1 : 22,
            effectiveDate: "2019-06-03",
          });
        }
      }

      // Through the repository so the hash chain stays valid. Only the event
      // before the timeRecords cutoff (2022-01-01) is eligible, whoever it
      // belongs to: the basis is occurred_at, not the employee's status.
      for (const occurredAt of [
        "2021-12-31T23:59:59Z",
        "2022-01-01T00:00:00Z",
        "2026-11-02T08:00:00Z",
      ]) {
        await time.appendEvent(tx, sign, {
          organizationId: org,
          employeeId: stayer,
          eventType: "clock_in",
          occurredAt: new Date(occurredAt),
          source: "web",
          actorId: stayer,
        });
      }

      const doc = (
        category: string,
        createdAt: string,
        deletedAt: string | null,
      ) =>
        tx`INSERT INTO documents (title, category, created_by_id, created_at, deleted_at)
          VALUES ('Doc', ${category}, ${userId}, ${createdAt}, ${deletedAt})`;
      await doc("other", "2026-01-01T00:00:00Z", "2026-10-01T00:00:00Z"); // eligible
      await doc("payslips", "2025-01-01T00:00:00Z", "2026-10-01T00:00:00Z"); // held
      await doc("contracts", "2020-01-01T00:00:00Z", "2026-10-01T00:00:00Z"); // eligible
      await doc("other", "2026-01-01T00:00:00Z", "2026-11-20T00:00:00Z"); // in grace
      await doc("other", "2026-01-01T00:00:00Z", null); // live

      await tx`INSERT INTO notifications (user_id, title, body, category, created_at)
        VALUES (${userId}, 'Old', 'Old', 'system', '2025-01-01T00:00:00Z'),
               (${userId}, 'New', 'New', 'system', now())`;
      await tx`INSERT INTO invitations (email, role, token, expires_at, accepted_at)
        VALUES ('a@example.invalid', 'employee', ${randomUUID()}, '2025-01-08T00:00:00Z', '2025-01-01T00:00:00Z'),
               ('b@example.invalid', 'employee', ${randomUUID()}, '2025-02-01T00:00:00Z', NULL),
               ('c@example.invalid', 'employee', ${randomUUID()}, now() + interval '7 days', NULL)`;
      await tx`INSERT INTO audit_log (action, resource_type, created_at)
        VALUES ('test.old', 'organization', '2020-06-01T00:00:00Z'),
               ('test.new', 'organization', now())`;
    });
  }

  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database) throw new Error("Docker is required for role tests");
    base = database;
    db = await createRoleSeparatedDatabase(base);
    await runMigrations(db.ownerConnectionString);
    await db.adminSql`INSERT INTO users (id, email, name)
      VALUES (${userId}, 'retention@example.invalid', 'Retention')`;
    await seed(orgA);
    await seed(orgB);
  }, 60000);

  afterAll(async () => {
    if (db) await db.close();
    if (base) await base.close();
  });

  it("stores a period per organization and category, visible to its tenant only", async () => {
    await withTenant(db.appSql, { organizationId: orgA }, async (tx) => {
      await tx`INSERT INTO retention_policies (category, retention_days)
        VALUES ('notifications', 180), ('time_records', 1826)`;
      expect(await repo.listPolicies(tx)).toEqual([
        { category: "notifications", retentionDays: 180 },
        { category: "time_records", retentionDays: 1826 },
      ]);
    });
    await withTenant(db.appSql, { organizationId: orgB }, async (tx) => {
      expect(await repo.listPolicies(tx)).toEqual([]);
      const leaked = await tx`
        UPDATE retention_policies SET retention_days = 2 WHERE organization_id = ${orgA}`;
      expect(leaked.count).toBe(0);
    });
    await expect(
      withTenant(
        db.appSql,
        { organizationId: orgB },
        (tx) =>
          tx`INSERT INTO retention_policies (organization_id, category, retention_days)
            VALUES (${orgA}, 'audit_log', 30)`,
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("enforces the category list, the range, one row per category and the legal floor", async () => {
    const insert = (category: string, days: number) =>
      withTenant(
        db.appSql,
        { organizationId: orgB },
        (tx) =>
          tx`INSERT INTO retention_policies (category, retention_days)
          VALUES (${category}, ${days})`,
      );
    await expect(insert("time_records", 1460)).rejects.toThrow(
      /retention_policies_time_records_floor/,
    );
    await expect(insert("payroll", 30)).rejects.toThrow(
      /retention_policies_category_check/,
    );
    await expect(insert("notifications", 0)).rejects.toThrow(
      /retention_policies_days_check/,
    );
    await expect(insert("notifications", 36526)).rejects.toThrow(
      /retention_policies_days_check/,
    );
    await insert("time_records", 1461);
    await expect(insert("time_records", 2000)).rejects.toThrow(
      /retention_policies_org_category_unique/,
    );
  });

  it("counts eligible records of the tenant only, holding back statutory documents", async () => {
    for (const org of [orgA, orgB]) {
      const counts = await withTenant(
        db.appSql,
        { organizationId: org },
        (tx) => repo.countEligible(tx, cutoffs),
      );
      // Both tenants hold the same rows; a leak would double the counts.
      expect(counts).toEqual({
        timeRecords: 1,
        // The leaver's request plus their two ledger rows.
        leaveRecords: 3,
        auditLog: 1,
        deletedDocuments: 2,
        statutoryDocumentsHeld: 1,
        notifications: 1,
        invitations: 2,
      });
    }
  });

  it("deletes nothing when counting", async () => {
    const before = await db.adminSql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM documents`;
    await withTenant(db.appSql, { organizationId: orgA }, (tx) =>
      repo.countEligible(tx, cutoffs),
    );
    const after = await db.adminSql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM documents`;
    expect(after[0]?.n).toBe(before[0]?.n);
  });

  it("sweeps password reset links older than the period and keeps newer ones", async () => {
    await db.adminSql`INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, created_at)
      VALUES (${userId}, ${randomUUID()}, now() - interval '31 days', now() - interval '31 days'),
             (${userId}, ${randomUUID()}, now() - interval '1 day', now() - interval '29 days')`;
    expect(await sweepPasswordResetTokens(db.appSql, 30)).toBe(1);
    const left = await db.adminSql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM password_reset_tokens`;
    expect(left[0]?.n).toBe(1);
    await expect(sweepPasswordResetTokens(db.appSql, 0)).rejects.toThrow(
      RangeError,
    );
  });
});
