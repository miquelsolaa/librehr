import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDatabase, type TestDatabase } from "@openhr/testing";
import { runMigrations } from "../src/migrate.js";
import { withTenant } from "../src/with-tenant.js";
import { LeaveRepository } from "../src/repositories/leave.repository.js";
import { EmployeeRepository } from "../src/repositories/employee.repository.js";

describe("LeaveRepository & Ledger Invariance (LEA-001, LEA-004, LEA-005)", () => {
  let db: TestDatabase | null = null;
  const leaveRepo = new LeaveRepository();
  const employeeRepo = new EmployeeRepository();

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

  it("handles request lifecycle, ledger append-only fold, and compensating cancellation entry", async () => {
    if (!db) return;

    const orgId = "10000000-0000-0000-0000-000000000099";
    await db.sql`
      INSERT INTO "organizations" ("id", "name", "slug")
      VALUES (${orgId}, 'Leave Corp', 'leave-corp')
      ON CONFLICT ("id") DO NOTHING
    `;

    await withTenant(db.sql, { organizationId: orgId }, async (tx) => {
      // 1. Create Employee & Approver
      const employee = await employeeRepo.create(tx, {
        firstName: "Marc",
        lastName: "Serra",
        email: "marc.serra@leave.test",
      });

      const approver = await employeeRepo.create(tx, {
        firstName: "Laura",
        lastName: "Bosch",
        email: "laura.bosch@leave.test",
      });

      // 2. Create Leave Type
      const leaveType = await leaveRepo.createLeaveType(tx, {
        name: "Vacances 2026",
        code: "vacation",
        isPaid: true,
        requiresApproval: true,
      });
      expect(leaveType.id).toBeDefined();

      // 3. Initial Accrual: grant 22 days
      await leaveRepo.appendLedgerEntry(tx, {
        employeeId: employee.id,
        entryType: "accrual",
        amount: 22,
        note: "Initial 2026 allocation",
      });

      let balance = await leaveRepo.calculateBalance(tx, employee.id);
      expect(balance.currentBalance).toBe(22);

      // 4. Submit Leave Request for 5 days
      const req = await leaveRepo.createLeaveRequest(tx, {
        employeeId: employee.id,
        leaveTypeId: leaveType.id,
        startDate: "2026-07-06",
        endDate: "2026-07-10",
        workingDays: 5,
        notes: "Summer vacation",
      });
      expect(req.status).toBe("pending");

      // Balance before approval is still 22
      balance = await leaveRepo.calculateBalance(tx, employee.id);
      expect(balance.currentBalance).toBe(22);

      // 5. Approve Request -> appends usage (-5) to ledger
      const approved = await leaveRepo.approveLeaveRequest(
        tx,
        req.id,
        approver.id,
      );
      expect(approved.status).toBe("approved");

      balance = await leaveRepo.calculateBalance(tx, employee.id);
      expect(balance.currentBalance).toBe(17);
      expect(balance.totalUsed).toBe(5);

      // 6. Cancel Request -> appends compensating reversal (+5) to ledger
      const cancelled = await leaveRepo.cancelLeaveRequest(
        tx,
        req.id,
        employee.id,
      );
      expect(cancelled.status).toBe("cancelled");
      expect(cancelled.reversalLedgerEntryId).toBeDefined();

      // Final balance is fully restored to 22 via compensating entry
      balance = await leaveRepo.calculateBalance(tx, employee.id);
      expect(balance.currentBalance).toBe(22);
    });
  });
});
