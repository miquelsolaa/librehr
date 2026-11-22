import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres, { type Sql } from "postgres";
import {
  createRoleSeparatedDatabase,
  getTestDatabase,
  type RoleSeparatedDatabase,
  type TestDatabase,
} from "@librehr/testing";
import { runMigrations } from "../src/migrate.js";
import { withTenant } from "../src/with-tenant.js";
import { LeaveRepository } from "../src/repositories/leave.repository.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_0033 = fs.readFileSync(
  path.resolve(__dirname, "../migrations/0033_leave_ledger_leave_type.sql"),
  "utf-8",
);

// LEA-005 (#117): leave_ledger.leave_type_id, its same-tenant foreign key and
// the backfill of entries written before 0033.
describe("leave_ledger.leave_type_id (0033)", () => {
  let base: TestDatabase;
  let db: RoleSeparatedDatabase;
  let owner: Sql;
  const leave = new LeaveRepository();

  interface Org {
    orgId: string;
    employeeId: string;
    vacation: string;
    personal: string;
    policyId: string;
    requestId: string;
  }

  async function seedOrg(slug: string): Promise<Org> {
    const orgId = randomUUID();
    await db.adminSql`INSERT INTO organizations (id, name, slug) VALUES (${orgId}, ${slug}, ${slug})`;
    return withTenant(db.adminSql, { organizationId: orgId }, async (tx) => {
      const employeeId = randomUUID();
      await tx`INSERT INTO employees (id, first_name, last_name, email)
        VALUES (${employeeId}, 'Ledger', 'Type', ${`${employeeId}@example.invalid`})`;
      const vacation = (
        await leave.createLeaveType(tx, { name: "Vacation", code: "vacation" })
      ).id;
      const personal = (
        await leave.createLeaveType(tx, {
          name: "Personal",
          code: "personal_days",
        })
      ).id;
      const policyId = (
        await leave.createLeavePolicy(tx, {
          leaveTypeId: personal,
          name: "Personal days",
        })
      ).id;
      const requestId = (
        await leave.createLeaveRequest(tx, {
          employeeId,
          leaveTypeId: vacation,
          startDate: "2026-02-16",
          endDate: "2026-02-16",
          workingDays: 1,
        })
      ).id;
      return { orgId, employeeId, vacation, personal, policyId, requestId };
    });
  }

  /** An entry as releases before 0033 wrote it: no leave type. */
  async function legacyEntry(
    org: Org,
    entryType: string,
    amount: number,
    sourceRef: string | null,
  ): Promise<string> {
    return withTenant(
      db.adminSql,
      { organizationId: org.orgId },
      async (tx) =>
        (
          await leave.appendLedgerEntry(tx, {
            employeeId: org.employeeId,
            leaveTypeId: null,
            entryType,
            amount,
            sourceRef,
            effectiveDate: "2026-02-16",
          })
        ).id,
    );
  }

  const typeOf = async (id: string) =>
    (
      await db.adminSql<{ t: string | null }[]>`
        SELECT leave_type_id AS t FROM leave_ledger WHERE id = ${id}`
    )[0]?.t;

  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database) throw new Error("Docker is required for role tests");
    base = database;
    db = await createRoleSeparatedDatabase(base);
    await runMigrations(db.ownerConnectionString);
    owner = postgres(db.ownerConnectionString, { max: 1, onnotice: () => {} });
  }, 60000);

  afterAll(async () => {
    if (owner) await owner.end();
    if (db) await db.close();
    if (base) await base.close();
  });

  it("backfills usage, reversal and job accruals, idempotently, as the owner", async () => {
    const a = await seedOrg("ledger-type-a");
    const b = await seedOrg("ledger-type-b");
    const usage = await legacyEntry(a, "usage", -1, a.requestId);
    const reversal = await legacyEntry(a, "reversal", 1, a.requestId);
    const accrual = await legacyEntry(
      a,
      "accrual",
      2,
      `accrual:${a.policyId}:2026-02`,
    );
    // Nothing records the origin of these: they stay unassigned.
    const manual = await legacyEntry(a, "adjustment", 3, null);
    const seeded = await legacyEntry(a, "accrual", 22, null);
    // Another tenant's request and policy never type this tenant's rows.
    const foreignUsage = await legacyEntry(a, "usage", -1, b.requestId);
    const foreignAccrual = await legacyEntry(
      a,
      "accrual",
      1,
      `accrual:${b.policyId}:2026-02`,
    );
    const garbage = await legacyEntry(a, "usage", -1, "not-a-uuid");

    // The runner wraps each migration in a transaction; do the same.
    await owner.begin((tx) => tx.unsafe(MIGRATION_0033));

    expect(await typeOf(usage)).toBe(a.vacation);
    expect(await typeOf(reversal)).toBe(a.vacation);
    expect(await typeOf(accrual)).toBe(a.personal);
    for (const id of [manual, seeded, foreignUsage, foreignAccrual, garbage]) {
      expect(await typeOf(id)).toBeNull();
    }

    // A second pass changes nothing.
    // Spread: plain arrays, without the driver's result metadata.
    const ledger = async () => [
      ...(await db.adminSql`
        SELECT id, leave_type_id, amount::text, entry_type, source_ref
        FROM leave_ledger ORDER BY id`),
    ];
    const snapshot = await ledger();
    await owner.begin((tx) => tx.unsafe(MIGRATION_0033));
    expect(await ledger()).toEqual(snapshot);
  });

  it("restores FORCE RLS and the append-only trigger", async () => {
    const forced = await db.adminSql<{ relname: string; forced: boolean }[]>`
      SELECT relname, relforcerowsecurity AS forced FROM pg_class
      WHERE relname IN ('leave_ledger', 'leave_requests', 'leave_policies', 'leave_types')
      ORDER BY relname`;
    expect(forced.every((r) => r.forced)).toBe(true);
    expect(forced).toHaveLength(4);

    const [trigger] = await db.adminSql<{ enabled: string }[]>`
      SELECT tgenabled AS enabled FROM pg_trigger
      WHERE tgname = 'prevent_mod_leave_ledger'`;
    expect(trigger?.enabled).toBe("O");

    const org = await seedOrg("ledger-type-locked");
    const id = await legacyEntry(org, "adjustment", 1, null);
    await expect(
      withTenant(
        db.adminSql,
        { organizationId: org.orgId },
        (tx) =>
          tx`UPDATE leave_ledger SET leave_type_id = ${org.vacation} WHERE id = ${id}`,
      ),
    ).rejects.toThrow(/append-only/);
  });

  it("refuses another tenant's leave type, even for the superuser", async () => {
    const a = await seedOrg("ledger-type-fk-a");
    const b = await seedOrg("ledger-type-fk-b");
    await expect(
      withTenant(db.adminSql, { organizationId: a.orgId }, (tx) =>
        leave.appendLedgerEntry(tx, {
          employeeId: a.employeeId,
          leaveTypeId: b.vacation,
          entryType: "adjustment",
          amount: 1,
          effectiveDate: "2026-01-01",
        }),
      ),
    ).rejects.toThrow(/leave_ledger_leave_type_fk/);
  });

  it("reads each entry's type back under RLS for the runtime role", async () => {
    const org = await seedOrg("ledger-type-read");
    await withTenant(db.appSql, { organizationId: org.orgId }, (tx) =>
      leave.appendLedgerEntry(tx, {
        employeeId: org.employeeId,
        leaveTypeId: org.personal,
        entryType: "adjustment",
        amount: 2,
        effectiveDate: "2026-01-01",
      }),
    );
    const entries = await withTenant(
      db.appSql,
      { organizationId: org.orgId },
      (tx) => leave.getLedgerEntries(tx, org.employeeId),
    );
    expect(entries.map((e) => [e.leaveTypeId, e.amount])).toEqual([
      [org.personal, 2],
    ]);
    // Another tenant sees none of it.
    const other = await seedOrg("ledger-type-read-other");
    expect(
      await withTenant(db.appSql, { organizationId: other.orgId }, (tx) =>
        leave.getLedgerEntries(tx, org.employeeId),
      ),
    ).toEqual([]);
  });
});
