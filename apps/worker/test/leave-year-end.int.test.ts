import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getTestDatabase, type TestDatabase } from "@librehr/testing";
import { runMigrations } from "@librehr/db/migrate";
import type { Sql } from "@librehr/db";
import { handleLeaveAccrue } from "../src/queues/leave.accrue.js";

// LEA-002 / LEA-005, issue #116: year-end carry-over, forfeit, final
// true-up and carry-over expiry, written by the leave.accrue job.
describe("leave.accrue year end (LEA-002)", () => {
  let db: TestDatabase;
  let app: Sql;

  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database) throw new Error("Docker is required for leave year end");
    db = database;
    await runMigrations(db.connectionString);
    app = await db.appSql();
  }, 90000);

  afterAll(async () => {
    if (db) await db.close();
  });

  async function newOrg() {
    const orgId = randomUUID();
    await db.sql`INSERT INTO organizations (id, name, slug) VALUES (${orgId}, 'Year end', ${`year-end-${orgId.slice(0, 8)}`})`;
    const [vacation] = await db.sql<{ id: string }[]>`
      INSERT INTO leave_types (organization_id, name, code)
      VALUES (${orgId}, 'Vacation', 'vacation') RETURNING id
    `;
    const [personal] = await db.sql<{ id: string }[]>`
      INSERT INTO leave_types (organization_id, name, code)
      VALUES (${orgId}, 'Personal days', 'personal_days') RETURNING id
    `;
    return { orgId, vacation: vacation!.id, personal: personal!.id };
  }

  async function newPolicy(
    orgId: string,
    leaveTypeId: string,
    p: {
      allowance: number;
      method: string;
      cap: number;
      expiry: number;
      /** carryover_enforced; these tests opt in unless they say otherwise. */
      enforced?: boolean;
    },
  ) {
    const [policy] = await db.sql<{ id: string }[]>`
      INSERT INTO leave_policies (organization_id, leave_type_id, name,
        annual_allowance_days, accrual_method, carryover_max_days,
        carryover_expiry_months, carryover_enforced)
      VALUES (${orgId}, ${leaveTypeId}, 'Policy', ${p.allowance}, ${p.method},
        ${p.cap}, ${p.expiry}, ${p.enforced ?? true})
      RETURNING id
    `;
    return policy!.id;
  }

  /** An approved leave request, as the API would have recorded it. */
  async function approvedLeave(
    orgId: string,
    employeeId: string,
    leaveTypeId: string,
    startDate: string,
    endDate: string,
  ) {
    await db.sql`
      INSERT INTO leave_requests (organization_id, employee_id, leave_type_id,
        start_date, end_date, working_days, status)
      VALUES (${orgId}, ${employeeId}, ${leaveTypeId}, ${startDate}, ${endDate},
        5, 'approved')
    `;
  }

  async function newType(orgId: string, code: string) {
    const [type] = await db.sql<{ id: string }[]>`
      INSERT INTO leave_types (organization_id, name, code)
      VALUES (${orgId}, ${code}, ${code}) RETURNING id
    `;
    return type!.id;
  }

  async function newEmployee(orgId: string, startDate: string) {
    const id = randomUUID();
    await db.sql`
      INSERT INTO employees (id, organization_id, first_name, last_name, email)
      VALUES (${id}, ${orgId}, 'Year', 'End', ${`${id}@example.invalid`})
    `;
    await db.sql`
      INSERT INTO employments (organization_id, employee_id, job_title, start_date)
      VALUES (${orgId}, ${id}, 'Role', ${startDate})
    `;
    return id;
  }

  async function assign(
    orgId: string,
    employeeId: string,
    policyId: string,
    from: string,
  ) {
    await db.sql`
      INSERT INTO leave_policy_assignments (organization_id, leave_policy_id, employee_id, effective_from)
      VALUES (${orgId}, ${policyId}, ${employeeId}, ${from})
    `;
  }

  /** Books an entry directly, as the API or an earlier run would have. */
  async function book(
    orgId: string,
    employeeId: string,
    leaveTypeId: string | null,
    entryType: string,
    amount: number,
    effectiveDate: string,
    sourceRef: string | null = null,
    expiresOn: string | null = null,
  ) {
    await db.sql`
      INSERT INTO leave_ledger (organization_id, employee_id, leave_type_id,
        entry_type, amount, unit, source_ref, effective_date, expires_on)
      VALUES (${orgId}, ${employeeId}, ${leaveTypeId}, ${entryType}, ${amount},
        'days', ${sourceRef}, ${effectiveDate}, ${expiresOn})
    `;
  }

  interface Row {
    employeeId: string;
    leaveTypeId: string | null;
    entryType: string;
    amount: number;
    sourceRef: string | null;
    effectiveDate: string;
  }

  const ledger = async (orgId: string): Promise<Row[]> => [
    ...(await db.sql<Row[]>`
      SELECT employee_id AS "employeeId", leave_type_id AS "leaveTypeId",
             entry_type AS "entryType", amount::float AS amount,
             source_ref AS "sourceRef", effective_date::text AS "effectiveDate"
      FROM leave_ledger WHERE organization_id = ${orgId}
      ORDER BY effective_date, employee_id, source_ref NULLS FIRST, amount
    `),
  ];

  /** Entries other than accruals, usage and hand-booked rows. */
  const yearEndRows = async (orgId: string) =>
    (await ledger(orgId)).filter((r) =>
      ["carryover", "forfeit", "expiry"].includes(r.entryType),
    );

  const balance = (rows: readonly Row[], leaveTypeId: string | null) =>
    Math.round(
      rows
        .filter((r) => r.leaveTypeId === leaveTypeId)
        .reduce((s, r) => s + r.amount * 100, 0),
    ) / 100;

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

  it("closes the year per leave type after the final true-up, and a re-run is a no-op", async () => {
    const { orgId, vacation, personal } = await newOrg();
    const vacationPolicy = await newPolicy(orgId, vacation, {
      allowance: 24,
      method: "monthly",
      cap: 5,
      expiry: 3,
    });
    const personalPolicy = await newPolicy(orgId, personal, {
      allowance: 2,
      method: "upfront",
      cap: 0,
      expiry: 3,
    });
    const stayer = await newEmployee(orgId, "2024-01-01");
    const leaver = await newEmployee(orgId, "2024-01-01");
    for (const e of [stayer, leaver]) {
      await assign(orgId, e, vacationPolicy, "2026-01-01");
      await assign(orgId, e, personalPolicy, "2026-01-01");
    }
    await book(
      orgId,
      stayer,
      vacation,
      "usage",
      -10,
      "2026-07-01",
      randomUUID(),
    );
    // Booked for next year: never part of 2026's balance.
    await book(
      orgId,
      stayer,
      vacation,
      "usage",
      -1,
      "2027-01-04",
      randomUUID(),
    );
    // Legacy unassigned bucket: never carried over or forfeited.
    await book(orgId, stayer, null, "adjustment", 4, "2026-02-01");

    await run(orgId, "2025-12-31").result; // personal days on 1 January
    await run(orgId, "2026-12-31").result; // vacation Jan..Dec
    // A termination on 30 November recorded after December was accrued.
    await db.sql`UPDATE employees SET termination_date = '2026-11-30' WHERE id = ${leaver}`;

    const { result, logger } = run(orgId, "2027-01-31");
    expect(await result).toMatchObject({
      period: "2027-01",
      yearEnd: {
        year: 2026,
        trueUps: 2, // the leaver's vacation and personal days
        balances: 2, // the stayer's two types; the leaver left
        carryovers: 1,
        forfeits: 2,
        alreadyClosed: 0,
      },
    });
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain(
      "example.invalid",
    );

    const rows = await ledger(orgId);
    expect(rows).toEqual(
      expect.arrayContaining([
        // 24 − 2 (December) for the leaver, under the final ref.
        expect.objectContaining({
          employeeId: leaver,
          leaveTypeId: vacation,
          entryType: "accrual",
          amount: -2,
          sourceRef: `accrual:${vacationPolicy}:2026-final`,
          effectiveDate: "2026-11-30",
        }),
      ]),
    );
    // Stayer: vacation 24 − 10 = 14, cap 5; personal days 2, cap 0.
    // Order-insensitive: rows of one day sort by ref, which holds random ids.
    const stayerYearEnd = (await yearEndRows(orgId)).filter(
      (r) => r.employeeId === stayer,
    );
    expect(stayerYearEnd).toHaveLength(4);
    expect(stayerYearEnd).toEqual(
      expect.arrayContaining([
        {
          employeeId: stayer,
          leaveTypeId: vacation,
          entryType: "carryover",
          amount: -5,
          sourceRef: `carryover:${vacation}:2026:close`,
          effectiveDate: "2026-12-31",
        },
        {
          employeeId: stayer,
          leaveTypeId: vacation,
          entryType: "forfeit",
          amount: -9,
          sourceRef: `forfeit:${vacation}:2026`,
          effectiveDate: "2026-12-31",
        },
        {
          employeeId: stayer,
          leaveTypeId: personal,
          entryType: "forfeit",
          amount: -2,
          sourceRef: `forfeit:${personal}:2026`,
          effectiveDate: "2026-12-31",
        },
        {
          employeeId: stayer,
          leaveTypeId: vacation,
          entryType: "carryover",
          amount: 5,
          sourceRef: `carryover:${vacation}:2026`,
          effectiveDate: "2027-01-01",
        },
      ]),
    );
    // Leaver: settled on termination, never closed.
    expect(
      (await yearEndRows(orgId)).filter((r) => r.employeeId === leaver),
    ).toEqual([]);
    const stayerRows = rows.filter((r) => r.employeeId === stayer);
    expect(balance(stayerRows, null)).toBe(4);
    // 5 carried + 2 (January 2027) − 1 (booked for 2027); personal: 2 (2027).
    expect(balance(stayerRows, vacation)).toBe(6);
    expect(balance(stayerRows, personal)).toBe(2);

    // Retried January run: nothing new, balances unchanged.
    expect(await run(orgId, "2027-01-31").result).toMatchObject({
      written: 0,
      trueUps: 0,
      yearEnd: { carryovers: 0, forfeits: 0, alreadyClosed: 2, trueUps: 0 },
    });
    expect(await ledger(orgId)).toEqual(rows);
  });

  it("expires the unused carried-over days once, after the expiry date", async () => {
    const { orgId, vacation } = await newOrg();
    const policyId = await newPolicy(orgId, vacation, {
      allowance: 24,
      method: "monthly",
      cap: 5,
      expiry: 3,
    });
    const employee = await newEmployee(orgId, "2024-01-01");
    await assign(orgId, employee, policyId, "2026-01-01");
    // As closed by the January 2027 run.
    await book(
      orgId,
      employee,
      vacation,
      "carryover",
      -5,
      "2026-12-31",
      `carryover:${vacation}:2026:close`,
    );
    await book(
      orgId,
      employee,
      vacation,
      "carryover",
      5,
      "2027-01-01",
      `carryover:${vacation}:2026`,
      "2027-03-31",
    );
    await book(
      orgId,
      employee,
      vacation,
      "usage",
      -2,
      "2027-02-10",
      randomUUID(),
    );
    // Cancelled after the expiry date: it used nothing.
    const cancelled = randomUUID();
    await book(orgId, employee, vacation, "usage", -1, "2027-03-01", cancelled);
    await book(
      orgId,
      employee,
      vacation,
      "reversal",
      1,
      "2027-04-05",
      cancelled,
    );
    // Starts after the expiry date: does not count against carried days.
    await book(
      orgId,
      employee,
      vacation,
      "usage",
      -1,
      "2027-04-02",
      randomUUID(),
    );

    expect(await run(orgId, "2027-02-28").result).toMatchObject({
      expiries: 0,
    });
    expect(await run(orgId, "2027-03-31").result).toMatchObject({
      expiries: 1,
    });
    const expiry = {
      employeeId: employee,
      leaveTypeId: vacation,
      entryType: "expiry",
      amount: -3,
      sourceRef: `expiry:${vacation}:2026`,
      effectiveDate: "2027-03-31",
    };
    expect(
      (await ledger(orgId)).filter((r) => r.entryType === "expiry"),
    ).toEqual([expiry]);

    const rows = await ledger(orgId);
    expect(await run(orgId, "2027-03-31").result).toMatchObject({
      expiries: 0,
    });
    expect(await run(orgId, "2027-04-30").result).toMatchObject({
      expiries: 0,
    });
    expect(
      (await ledger(orgId)).filter((r) => r.entryType === "expiry"),
    ).toEqual([expiry]);
    expect(
      (await ledger(orgId)).filter((r) => !r.sourceRef?.startsWith("accrual:")),
    ).toEqual(rows.filter((r) => !r.sourceRef?.startsWith("accrual:")));
  });

  it("a January run over a multi-year assignment expires, settles, closes and accrues in order", async () => {
    const { orgId, vacation } = await newOrg();
    const policyId = await newPolicy(orgId, vacation, {
      allowance: 24,
      method: "monthly",
      cap: 5,
      expiry: 3,
    });
    const employee = await newEmployee(orgId, "2023-01-01");
    await assign(orgId, employee, policyId, "2024-01-01");
    // 2024 closed by an earlier release of the run, whose expiry was missed.
    await book(orgId, employee, vacation, "adjustment", 10, "2024-06-01");
    await book(
      orgId,
      employee,
      vacation,
      "carryover",
      -4,
      "2024-12-31",
      `carryover:${vacation}:2024:close`,
    );
    await book(
      orgId,
      employee,
      vacation,
      "forfeit",
      -6,
      "2024-12-31",
      `forfeit:${vacation}:2024`,
    );
    await book(
      orgId,
      employee,
      vacation,
      "carryover",
      4,
      "2025-01-01",
      `carryover:${vacation}:2024`,
      "2025-03-31",
    );

    // Nothing of 2025 was accrued (the scheduler was just turned on).
    expect(await run(orgId, "2026-01-31").result).toMatchObject({
      written: 1, // January 2026
      expiries: 1, // the 2024 carry-over, before 2025 is closed
      yearEnd: {
        year: 2025,
        written: 1, // the whole of 2025, as the final entry
        balances: 1,
        carryovers: 1,
        forfeits: 1,
      },
    });
    const rows = (await ledger(orgId)).filter(
      (r) => r.effectiveDate >= "2025-01-02",
    );
    expect(rows).toEqual([
      expect.objectContaining({
        entryType: "expiry",
        amount: -4,
        effectiveDate: "2025-03-31",
      }),
      expect.objectContaining({
        entryType: "accrual",
        amount: 24,
        sourceRef: `accrual:${policyId}:2025-final`,
        effectiveDate: "2025-12-01",
      }),
      // 2025 closes on 24 days: the expired 2024 days are not carried again.
      expect.objectContaining({
        entryType: "carryover",
        amount: -5,
        effectiveDate: "2025-12-31",
      }),
      expect.objectContaining({
        entryType: "forfeit",
        amount: -19,
        effectiveDate: "2025-12-31",
      }),
      expect.objectContaining({
        entryType: "accrual",
        amount: 2,
        effectiveDate: "2026-01-01",
      }),
      expect.objectContaining({
        entryType: "carryover",
        amount: 5,
        effectiveDate: "2026-01-01",
      }),
    ]);
    expect(balance(await ledger(orgId), vacation)).toBe(7);
  });

  it("closes an employee rehired in January but not one who left in December", async () => {
    const { orgId, vacation } = await newOrg();
    const policyId = await newPolicy(orgId, vacation, {
      allowance: 24,
      method: "monthly",
      cap: 5,
      expiry: 3,
    });
    const seasonal = await newEmployee(orgId, "2024-01-01");
    const leaver = await newEmployee(orgId, "2024-01-01");
    for (const e of [seasonal, leaver]) {
      await db.sql`UPDATE employments SET end_date = '2026-12-20' WHERE employee_id = ${e}`;
      await assign(orgId, e, policyId, "2026-01-01");
    }
    await db.sql`
      INSERT INTO employments (organization_id, employee_id, job_title, start_date)
      VALUES (${orgId}, ${seasonal}, 'Role', '2027-01-10')
    `;

    expect(await run(orgId, "2027-01-31").result).toMatchObject({
      yearEnd: { balances: 1, carryovers: 1, forfeits: 1 },
    });
    const closed = new Set((await yearEndRows(orgId)).map((r) => r.employeeId));
    expect(closed).toEqual(new Set([seasonal]));
  });

  it("never expires more than the balance left, nor a carry-over without an expiry date", async () => {
    const { orgId, vacation } = await newOrg();
    // No new days in 2027, so the balance on the expiry date is the
    // carried days minus HR's correction.
    const policyId = await newPolicy(orgId, vacation, {
      allowance: 0,
      method: "monthly",
      cap: 5,
      expiry: 3,
    });
    const employee = await newEmployee(orgId, "2024-01-01");
    // Closed while the policy was not enforced: its carry-over has no date.
    const unenforced = await newEmployee(orgId, "2024-01-01");
    await assign(orgId, employee, policyId, "2026-01-01");
    for (const [e, expiresOn] of [
      [employee, "2027-03-31"],
      [unenforced, null],
    ] as const) {
      await book(orgId, e, vacation, "adjustment", 5, "2026-06-01");
      await book(
        orgId,
        e,
        vacation,
        "carryover",
        -5,
        "2026-12-31",
        `carryover:${vacation}:2026:close`,
      );
      await book(
        orgId,
        e,
        vacation,
        "carryover",
        5,
        "2027-01-01",
        `carryover:${vacation}:2026`,
        expiresOn,
      );
    }
    // HR took 4 days back: only 1 is left when the carry-over expires.
    await book(orgId, employee, vacation, "adjustment", -4, "2027-02-01");

    expect(await run(orgId, "2027-03-31").result).toMatchObject({
      expiries: 1,
    });
    const rows = await ledger(orgId);
    expect(rows.filter((r) => r.entryType === "expiry")).toEqual([
      expect.objectContaining({ employeeId: employee, amount: -1 }),
    ]);
    expect(
      balance(
        rows.filter(
          (r) => r.employeeId === employee && r.effectiveDate <= "2027-03-31",
        ),
        vacation,
      ),
    ).toBe(0);
  });

  it("off by default: carries the whole balance over and never forfeits or expires", async () => {
    const { orgId, vacation } = await newOrg();
    const policyId = await newPolicy(orgId, vacation, {
      allowance: 24,
      method: "monthly",
      cap: 5,
      expiry: 1,
      enforced: false,
    });
    const employee = await newEmployee(orgId, "2024-01-01");
    await assign(orgId, employee, policyId, "2026-01-01");

    await run(orgId, "2026-12-31").result;
    expect(await run(orgId, "2027-01-31").result).toMatchObject({
      yearEnd: { carryovers: 1, forfeits: 0, protectedFromForfeit: 0 },
      expiries: 0,
    });
    for (const runDate of ["2027-03-31", "2027-12-31"]) {
      expect(await run(orgId, runDate).result).toMatchObject({ expiries: 0 });
    }
    const rows = await yearEndRows(orgId);
    expect(rows.map((r) => [r.entryType, r.amount])).toEqual([
      ["carryover", -24],
      ["carryover", 24],
    ]);
    const [expiresOn] = await db.sql<{ expiresOn: string | null }[]>`
      SELECT expires_on::text AS "expiresOn" FROM leave_ledger
      WHERE organization_id = ${orgId} AND source_ref = ${`carryover:${vacation}:2026`}
    `;
    expect(expiresOn!.expiresOn).toBeNull();
  });

  it("enforced: never forfeits or expires days of an employee with ET 38.3 protected leave", async () => {
    const { orgId, vacation } = await newOrg();
    const sick = await newType(orgId, "sick_leave");
    const policyId = await newPolicy(orgId, vacation, {
      allowance: 24,
      method: "monthly",
      cap: 5,
      expiry: 3,
    });
    const onSickLeave = await newEmployee(orgId, "2024-01-01");
    const ordinary = await newEmployee(orgId, "2024-01-01");
    for (const e of [onSickLeave, ordinary]) {
      await assign(orgId, e, policyId, "2026-01-01");
    }
    await approvedLeave(orgId, onSickLeave, sick, "2026-10-01", "2026-12-31");
    // Ordinary vacation of the other employee protects nothing.
    await approvedLeave(orgId, ordinary, vacation, "2026-08-03", "2026-08-07");

    await run(orgId, "2026-12-31").result;
    const { result, logger } = run(orgId, "2027-01-31");
    expect(await result).toMatchObject({
      yearEnd: {
        balances: 2,
        carryovers: 2,
        forfeits: 1,
        protectedFromForfeit: 1,
      },
    });
    const rows = await yearEndRows(orgId);
    // Protected: the whole 24 days are carried over and never expire.
    expect(
      rows
        .filter((r) => r.employeeId === onSickLeave)
        .map((r) => [r.entryType, r.amount]),
    ).toEqual([
      ["carryover", -24],
      ["carryover", 24],
    ]);
    // Not protected: capped at 5, 19 forfeited.
    expect(
      rows
        .filter((r) => r.employeeId === ordinary)
        .map((r) => [r.entryType, r.amount])
        .sort(),
    ).toEqual(
      [
        ["carryover", -5],
        ["carryover", 5],
        ["forfeit", -19],
      ].sort(),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        employeeId: onSickLeave,
        leaveTypeId: vacation,
        policyId,
      }),
    );
    const warnings = JSON.stringify(logger.warn.mock.calls);
    expect(warnings).not.toContain("example.invalid");
    // Never the protected absence's type: special-category data.
    expect(warnings).not.toContain(sick);

    const [expiresOn] = await db.sql<{ expiresOn: string | null }[]>`
      SELECT expires_on::text AS "expiresOn" FROM leave_ledger
      WHERE organization_id = ${orgId} AND employee_id = ${onSickLeave}
        AND source_ref = ${`carryover:${vacation}:2026`}
    `;
    expect(expiresOn!.expiresOn).toBeNull();
  });

  it("enforced: skips an expiry when protected leave falls in the expiry window", async () => {
    const { orgId, vacation } = await newOrg();
    const birth = await newType(orgId, "birth_childcare");
    const policyId = await newPolicy(orgId, vacation, {
      allowance: 0,
      method: "monthly",
      cap: 5,
      expiry: 3,
    });
    const employee = await newEmployee(orgId, "2024-01-01");
    await assign(orgId, employee, policyId, "2026-01-01");
    await book(orgId, employee, vacation, "adjustment", 5, "2026-06-01");
    await book(
      orgId,
      employee,
      vacation,
      "carryover",
      -5,
      "2026-12-31",
      `carryover:${vacation}:2026:close`,
    );
    await book(
      orgId,
      employee,
      vacation,
      "carryover",
      5,
      "2027-01-01",
      `carryover:${vacation}:2026`,
      "2027-03-31",
    );
    await approvedLeave(orgId, employee, birth, "2027-02-15", "2027-06-06");

    const { result, logger } = run(orgId, "2027-03-31");
    expect(await result).toMatchObject({
      expiries: 0,
      protectedFromExpiry: 1,
    });
    expect(
      (await ledger(orgId)).filter((r) => r.entryType === "expiry"),
    ).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ employeeId: employee, leaveTypeId: vacation }),
    );
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(birth);
  });

  it("never reads, closes or expires another organization's balances", async () => {
    const a = await newOrg();
    const b = await newOrg();
    const policy = { allowance: 24, method: "monthly", cap: 5, expiry: 1 };
    const policyA = await newPolicy(a.orgId, a.vacation, policy);
    const policyB = await newPolicy(b.orgId, b.vacation, policy);
    const employeeA = await newEmployee(a.orgId, "2024-01-01");
    const employeeB = await newEmployee(b.orgId, "2024-01-01");
    await assign(a.orgId, employeeA, policyA, "2026-01-01");
    await assign(b.orgId, employeeB, policyB, "2026-01-01");
    await book(a.orgId, employeeA, a.vacation, "adjustment", 8, "2026-06-01");
    await book(b.orgId, employeeB, b.vacation, "adjustment", 8, "2026-06-01");
    // B carried days from 2025 that expired at the end of January 2026.
    await book(
      b.orgId,
      employeeB,
      b.vacation,
      "carryover",
      3,
      "2026-01-01",
      `carryover:${b.vacation}:2025`,
      "2026-01-31",
    );
    const before = await ledger(b.orgId);

    await run(a.orgId, "2026-12-31").result;
    expect(await run(a.orgId, "2027-01-31").result).toMatchObject({
      yearEnd: { balances: 1, carryovers: 1, forfeits: 1 },
      expiries: 1, // A's own carry-over, expiring on 31 January
    });
    expect(await ledger(b.orgId)).toEqual(before);
    expect(new Set((await ledger(a.orgId)).map((r) => r.employeeId))).toEqual(
      new Set([employeeA]),
    );
  });
});
