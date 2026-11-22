import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getTestDatabase, type TestDatabase } from "@librehr/testing";
import { runMigrations } from "@librehr/db/migrate";
import type { Sql } from "@librehr/db";
import { handleLeaveAccrue } from "../src/queues/leave.accrue.js";
import {
  InvalidEmploymentDataError,
  MissingPolicyError,
} from "../src/lib/job-errors.js";

describe("leave.accrue (LEA-002)", () => {
  let db: TestDatabase;
  let app: Sql;

  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database) throw new Error("Docker is required for leave accrual");
    db = database;
    await runMigrations(db.connectionString);
    app = await db.appSql();
  }, 90000);

  afterAll(async () => {
    if (db) await db.close();
  });

  async function newOrg() {
    const orgId = randomUUID();
    await db.sql`INSERT INTO organizations (id, name, slug) VALUES (${orgId}, 'Accrual', ${`accrual-${orgId.slice(0, 8)}`})`;
    const [type] = await db.sql<{ id: string }[]>`
      INSERT INTO leave_types (organization_id, name, code)
      VALUES (${orgId}, 'Vacation', 'vacation') RETURNING id
    `;
    return { orgId, leaveTypeId: type!.id };
  }

  async function newPolicy(
    orgId: string,
    leaveTypeId: string,
    allowance: number,
    method: string,
  ) {
    const [policy] = await db.sql<{ id: string }[]>`
      INSERT INTO leave_policies (organization_id, leave_type_id, name, annual_allowance_days, accrual_method)
      VALUES (${orgId}, ${leaveTypeId}, 'Policy', ${allowance}, ${method}) RETURNING id
    `;
    return policy!.id;
  }

  /** `startDate` null: legacy employee without employment rows. */
  async function newEmployee(
    orgId: string,
    startDate: string | null,
    terminationDate: string | null = null,
  ) {
    const id = randomUUID();
    await db.sql`
      INSERT INTO employees (id, organization_id, first_name, last_name, email, termination_date)
      VALUES (${id}, ${orgId}, 'Accrual', 'Worker', ${`${id}@example.invalid`}, ${terminationDate})
    `;
    if (startDate !== null) {
      await db.sql`
        INSERT INTO employments (organization_id, employee_id, job_title, start_date)
        VALUES (${orgId}, ${id}, 'Role', ${startDate})
      `;
    }
    return id;
  }

  async function assign(
    orgId: string,
    employeeId: string,
    policyId: string,
    from: string,
    createdAt = "2025-01-01T00:00:00Z",
  ) {
    await db.sql`
      INSERT INTO leave_policy_assignments (organization_id, leave_policy_id, employee_id, effective_from, created_at)
      VALUES (${orgId}, ${policyId}, ${employeeId}, ${from}, ${createdAt})
    `;
  }

  // Spread: a plain array, without the driver's result metadata.
  const ledger = async (orgId: string) => [
    ...(await db.sql<
      {
        employeeId: string;
        amount: number;
        sourceRef: string;
        effectiveDate: string;
      }[]
    >`
      SELECT employee_id AS "employeeId", amount::float AS amount,
             source_ref AS "sourceRef", effective_date::text AS "effectiveDate"
      FROM leave_ledger WHERE organization_id = ${orgId}
      ORDER BY effective_date, employee_id, source_ref
    `),
  ];

  /** sourceRef -> amount, for one employee. */
  const amounts = async (orgId: string, employeeId: string) =>
    Object.fromEntries(
      (await ledger(orgId))
        .filter((r) => r.employeeId === employeeId)
        .map((r) => [r.sourceRef, r.amount]),
    );

  const run = (organizationId: string, runDate: string) => {
    const logger = { info: vi.fn(), warn: vi.fn() };
    return {
      logger,
      result: handleLeaveAccrue(
        { id: "job-1", data: { organizationId, runDate } },
        { sql: app, logger },
      ),
    };
  };

  it("accrues the year to date per assignment and a re-run writes nothing new", async () => {
    const { orgId, leaveTypeId } = await newOrg();
    const policyId = await newPolicy(orgId, leaveTypeId, 24, "monthly");
    const veteran = await newEmployee(orgId, "2024-01-01");
    const joiner = await newEmployee(orgId, "2026-03-16");
    const leaver = await newEmployee(orgId, "2024-01-01", "2026-02-15");
    await newEmployee(orgId, "2024-01-01"); // no assignment: no accrual
    for (const e of [veteran, joiner, leaver]) {
      await assign(orgId, e, policyId, "2025-01-01");
    }

    const { result, logger } = run(orgId, "2026-03-10");
    expect(await result).toMatchObject({
      period: "2026-03",
      plans: 3,
      written: 3,
    });
    const ref = `accrual:${policyId}:2026-03`;
    expect(await ledger(orgId)).toEqual(
      expect.arrayContaining([
        // First run of the year: January and February are caught up.
        {
          employeeId: veteran,
          amount: 6,
          sourceRef: ref,
          effectiveDate: "2026-03-01",
        },
        {
          employeeId: joiner,
          amount: 1.03,
          sourceRef: ref,
          effectiveDate: "2026-03-16",
        },
        // Left 15 February: 2 + 2 × 15/28, dated on the last day.
        {
          employeeId: leaver,
          amount: 3.07,
          sourceRef: ref,
          effectiveDate: "2026-02-15",
        },
      ]),
    );
    const rows = await ledger(orgId);
    expect(rows).toHaveLength(3);
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain(
      "example.invalid",
    );

    // Retried or re-enqueued job: the balance is unchanged.
    expect(await run(orgId, "2026-03-31").result).toMatchObject({
      written: 0,
      upToDate: 3,
    });
    expect(await ledger(orgId)).toEqual(rows);
  });

  it("catches up a missed month on the next run", async () => {
    const { orgId, leaveTypeId } = await newOrg();
    const policyId = await newPolicy(orgId, leaveTypeId, 22, "monthly");
    const employee = await newEmployee(orgId, "2024-01-01");
    // From 2026: the January run's close of 2025 is tested on its own.
    await assign(orgId, employee, policyId, "2026-01-01");

    await run(orgId, "2026-01-01").result;
    await run(orgId, "2026-03-01").result;
    // 22 / 12 = 1.8333: rounded on the cumulative value, never per month.
    expect(await amounts(orgId, employee)).toEqual({
      [`accrual:${policyId}:2026-01`]: 1.83,
      [`accrual:${policyId}:2026-03`]: 3.67,
    });
  });

  it("splits a month between policies when the assignment changes mid-month", async () => {
    const { orgId, leaveTypeId } = await newOrg();
    const before = await newPolicy(orgId, leaveTypeId, 24, "monthly");
    const after = await newPolicy(orgId, leaveTypeId, 12, "monthly");
    const employee = await newEmployee(orgId, "2024-01-01");
    await assign(orgId, employee, before, "2025-01-01");
    await assign(orgId, employee, after, "2026-03-16");

    await run(orgId, "2026-03-01").result;
    expect(await amounts(orgId, employee)).toEqual({
      // 2 + 2 + 2 × 15/31, then 1 × 16/31.
      [`accrual:${before}:2026-03`]: 4.97,
      [`accrual:${after}:2026-03`]: 0.52,
    });
  });

  it("ignores an assignment replaced on the same day", async () => {
    const { orgId, leaveTypeId } = await newOrg();
    const replaced = await newPolicy(orgId, leaveTypeId, 24, "monthly");
    const current = await newPolicy(orgId, leaveTypeId, 12, "monthly");
    const employee = await newEmployee(orgId, "2024-01-01");
    await assign(
      orgId,
      employee,
      replaced,
      "2026-01-01",
      "2025-12-01T00:00:00Z",
    );
    await assign(
      orgId,
      employee,
      current,
      "2026-01-01",
      "2025-12-02T00:00:00Z",
    );

    await run(orgId, "2026-01-01").result;
    expect(await amounts(orgId, employee)).toEqual({
      [`accrual:${current}:2026-01`]: 1,
    });
  });

  it("writes one entry for a policy with two windows in the same month", async () => {
    const { orgId, leaveTypeId } = await newOrg();
    const main = await newPolicy(orgId, leaveTypeId, 24, "monthly");
    const interim = await newPolicy(orgId, leaveTypeId, 12, "monthly");
    const employee = await newEmployee(orgId, "2024-01-01");
    await assign(orgId, employee, main, "2026-01-01");
    await assign(orgId, employee, interim, "2026-03-10");
    await assign(orgId, employee, main, "2026-03-20");

    expect(await run(orgId, "2026-03-01").result).toMatchObject({ written: 2 });
    expect(await amounts(orgId, employee)).toEqual({
      // 2 + 2 + 2 × (9 + 12)/31, then 1 × 10/31.
      [`accrual:${main}:2026-03`]: 5.35,
      [`accrual:${interim}:2026-03`]: 0.32,
    });
  });

  it("accrues for a legacy employee without employment rows", async () => {
    const { orgId, leaveTypeId } = await newOrg();
    const policyId = await newPolicy(orgId, leaveTypeId, 24, "monthly");
    const legacy = await newEmployee(orgId, null);
    await assign(orgId, legacy, policyId, "2026-01-01");

    await run(orgId, "2026-01-20").result;
    expect(await ledger(orgId)).toEqual([
      {
        employeeId: legacy,
        amount: 2,
        sourceRef: `accrual:${policyId}:2026-01`,
        effectiveDate: "2026-01-01",
      },
    ]);
  });

  it("credits upfront policies when the year or the employment starts (#129)", async () => {
    const { orgId, leaveTypeId } = await newOrg();
    const policyId = await newPolicy(orgId, leaveTypeId, 30, "upfront");
    const veteran = await newEmployee(orgId, "2024-01-01");
    const joiner = await newEmployee(orgId, "2026-07-01");
    await assign(orgId, veteran, policyId, "2026-01-01");
    await assign(orgId, joiner, policyId, "2026-01-01");

    // The run for December 2025 executes at the start of 1 January 2026.
    await run(orgId, "2025-12-31").result;
    expect(await ledger(orgId)).toEqual([
      {
        employeeId: veteran,
        amount: 30,
        sourceRef: `accrual:${policyId}:2026-01`,
        effectiveDate: "2026-01-01",
      },
    ]);

    for (const runDate of [
      "2026-01-31",
      "2026-05-31",
      "2026-06-30",
      "2026-07-31",
    ]) {
      await run(orgId, runDate).result;
    }
    expect(await amounts(orgId, veteran)).toEqual({
      [`accrual:${policyId}:2026-01`]: 30,
    });
    // 30 × 184 / 365, credited by the June run on the first day of work.
    expect(await ledger(orgId)).toContainEqual({
      employeeId: joiner,
      amount: 15.12,
      sourceRef: `accrual:${policyId}:2026-07`,
      effectiveDate: "2026-07-01",
    });
    expect(await amounts(orgId, joiner)).toEqual({
      [`accrual:${policyId}:2026-07`]: 15.12,
    });
  });

  it("writes a negative accrual when a termination is recorded late, once (#116)", async () => {
    const { orgId, leaveTypeId } = await newOrg();
    const policyId = await newPolicy(orgId, leaveTypeId, 24, "monthly");
    const leaver = await newEmployee(orgId, "2024-01-01");
    await assign(orgId, leaver, policyId, "2026-01-01");

    await run(orgId, "2026-03-31").result;
    await db.sql`UPDATE employees SET termination_date = '2026-01-31' WHERE id = ${leaver}`;

    const { result, logger } = run(orgId, "2026-04-30");
    expect(await result).toMatchObject({ trueUps: 1, written: 0 });
    expect(await amounts(orgId, leaver)).toEqual({
      [`accrual:${policyId}:2026-03`]: 6,
      // Due: January only (2). Dated on the last day worked.
      [`accrual:${policyId}:2026-04`]: -4,
    });
    expect(await ledger(orgId)).toContainEqual(
      expect.objectContaining({ amount: -4, effectiveDate: "2026-01-31" }),
    );
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain(
      "example.invalid",
    );

    // Re-runs of the month and later months write nothing more.
    expect(await run(orgId, "2026-04-30").result).toMatchObject({
      trueUps: 0,
      upToDate: 1,
    });
    expect(await run(orgId, "2026-05-31").result).toMatchObject({
      trueUps: 0,
      upToDate: 1,
    });
    expect(Object.keys(await amounts(orgId, leaver))).toHaveLength(2);
  });

  it("never reads or writes another organization's rows", async () => {
    const a = await newOrg();
    const b = await newOrg();
    const policyA = await newPolicy(a.orgId, a.leaveTypeId, 24, "monthly");
    const policyB = await newPolicy(b.orgId, b.leaveTypeId, 24, "monthly");
    const employeeA = await newEmployee(a.orgId, "2024-01-01");
    const employeeB = await newEmployee(b.orgId, "2024-01-01");
    await assign(a.orgId, employeeA, policyA, "2025-01-01");
    await assign(b.orgId, employeeB, policyB, "2025-01-01");

    expect(await run(a.orgId, "2026-04-01").result).toMatchObject({
      plans: 1,
      written: 1,
    });
    expect(await ledger(b.orgId)).toEqual([]);
    expect((await ledger(a.orgId)).map((r) => r.employeeId)).toEqual([
      employeeA,
    ]);
  });

  it("fails without writing when an assignment points to a missing policy", async () => {
    const other = await newOrg();
    const foreignPolicy = await newPolicy(
      other.orgId,
      other.leaveTypeId,
      24,
      "monthly",
    );
    const { orgId, leaveTypeId } = await newOrg();
    const policyId = await newPolicy(orgId, leaveTypeId, 24, "monthly");
    const ok = await newEmployee(orgId, "2024-01-01");
    const broken = await newEmployee(orgId, "2024-01-01");
    await assign(orgId, ok, policyId, "2025-01-01");
    // Invisible under RLS, so for this tenant the policy does not exist.
    await assign(orgId, broken, foreignPolicy, "2025-01-01");

    await expect(run(orgId, "2026-05-01").result).rejects.toBeInstanceOf(
      MissingPolicyError,
    );
    expect(await ledger(orgId)).toEqual([]);
    expect(await ledger(other.orgId)).toEqual([]);
  });
  it("records each accrual under its policy's leave type (LEA-005)", async () => {
    const { orgId, leaveTypeId: vacation } = await newOrg();
    const [personal] = await db.sql<{ id: string }[]>`
      INSERT INTO leave_types (organization_id, name, code)
      VALUES (${orgId}, 'Personal days', 'personal_days') RETURNING id
    `;
    const vacationPolicy = await newPolicy(orgId, vacation, 24, "monthly");
    const personalPolicy = await newPolicy(orgId, personal!.id, 2, "upfront");
    const employee = await newEmployee(orgId, "2024-01-01");
    await assign(orgId, employee, vacationPolicy, "2025-01-01");
    await assign(orgId, employee, personalPolicy, "2025-01-01");

    // Not a January run, so 2025 is neither trued up nor closed here.
    await run(orgId, "2026-02-15").result;

    const rows = await db.sql<{ sourceRef: string; leaveTypeId: string }[]>`
      SELECT source_ref AS "sourceRef", leave_type_id AS "leaveTypeId"
      FROM leave_ledger WHERE organization_id = ${orgId}
      ORDER BY source_ref
    `;
    expect(
      Object.fromEntries(rows.map((r) => [r.sourceRef, r.leaveTypeId])),
    ).toEqual({
      [`accrual:${vacationPolicy}:2026-02`]: vacation,
      // Upfront: credited for the month that starts after the run.
      [`accrual:${personalPolicy}:2026-03`]: personal!.id,
    });
  });
  it("prorates only policies with a full-time week, by contract hours (#118)", async () => {
    const { orgId, leaveTypeId: vacation } = await newOrg();
    const [agreement] = await db.sql<{ id: string }[]>`
      INSERT INTO leave_types (organization_id, name, code)
      VALUES (${orgId}, 'Agreement days', 'other') RETURNING id
    `;
    // Statutory vacation: never prorated (NULL full-time week).
    const vacationPolicy = await newPolicy(orgId, vacation, 24, "monthly");
    const prorated = await newPolicy(orgId, agreement!.id, 24, "monthly");
    await db.sql`UPDATE leave_policies SET full_time_hours_per_week = 40 WHERE id = ${prorated}`;

    const partTime = randomUUID();
    await db.sql`
      INSERT INTO employees (id, organization_id, first_name, last_name, email)
      VALUES (${partTime}, ${orgId}, 'Part', 'Time', ${`${partTime}@example.invalid`})
    `;
    await db.sql`
      INSERT INTO employments (organization_id, employee_id, job_title, start_date, working_hours_per_week)
      VALUES (${orgId}, ${partTime}, 'Role', '2024-01-01', '20.0')
    `;
    const fullTime = await newEmployee(orgId, "2024-01-01");
    // No employment rows: hours unknown, accrues at 1.
    const legacy = await newEmployee(orgId, null);
    // From 2026: the January run's close of 2025 is tested on its own.
    await assign(orgId, legacy, prorated, "2026-01-01");
    for (const e of [partTime, fullTime]) {
      await assign(orgId, e, vacationPolicy, "2026-01-01");
      await assign(orgId, e, prorated, "2026-01-01");
    }

    await run(orgId, "2026-01-20").result;

    expect(await amounts(orgId, partTime)).toEqual({
      [`accrual:${vacationPolicy}:2026-01`]: 2,
      [`accrual:${prorated}:2026-01`]: 1,
    });
    expect(await amounts(orgId, fullTime)).toEqual({
      [`accrual:${vacationPolicy}:2026-01`]: 2,
      [`accrual:${prorated}:2026-01`]: 2,
    });
    expect(await amounts(orgId, legacy)).toEqual({
      [`accrual:${prorated}:2026-01`]: 2,
    });
  });

  it("fails without writing when a prorated policy meets unusable contract hours", async () => {
    const { orgId, leaveTypeId } = await newOrg();
    const policyId = await newPolicy(orgId, leaveTypeId, 24, "monthly");
    await db.sql`UPDATE leave_policies SET full_time_hours_per_week = 40 WHERE id = ${policyId}`;
    const employee = randomUUID();
    await db.sql`
      INSERT INTO employees (id, organization_id, first_name, last_name, email)
      VALUES (${employee}, ${orgId}, 'Bad', 'Hours', ${`${employee}@example.invalid`})
    `;
    await db.sql`
      INSERT INTO employments (organization_id, employee_id, job_title, start_date, working_hours_per_week)
      VALUES (${orgId}, ${employee}, 'Role', '2024-01-01', 'unknown')
    `;
    await assign(orgId, employee, policyId, "2025-01-01");

    await expect(run(orgId, "2026-01-20").result).rejects.toBeInstanceOf(
      InvalidEmploymentDataError,
    );
    expect(await ledger(orgId)).toEqual([]);
  });
});
