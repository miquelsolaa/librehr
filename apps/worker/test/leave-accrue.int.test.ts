import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getTestDatabase, type TestDatabase } from "@librehr/testing";
import { runMigrations } from "@librehr/db/migrate";
import type { Sql } from "@librehr/db";
import { handleLeaveAccrue } from "../src/queues/leave.accrue.js";
import { MissingPolicyError } from "../src/lib/job-errors.js";

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

  async function newEmployee(
    orgId: string,
    startDate: string,
    terminationDate: string | null = null,
  ) {
    const id = randomUUID();
    await db.sql`
      INSERT INTO employees (id, organization_id, first_name, last_name, email, termination_date)
      VALUES (${id}, ${orgId}, 'Accrual', 'Worker', ${`${id}@example.invalid`}, ${terminationDate})
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
      ORDER BY effective_date, employee_id
    `),
  ];

  const run = (organizationId: string, runDate: string) => {
    const logger = { info: vi.fn() };
    return {
      logger,
      result: handleLeaveAccrue(
        { id: "job-1", data: { organizationId, runDate } },
        { sql: app, logger },
      ),
    };
  };

  it("writes one entry per assignment and a re-run writes nothing new", async () => {
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
      written: 2,
      alreadyAccrued: 0,
    });
    const rows = await ledger(orgId);
    expect(rows).toEqual(
      expect.arrayContaining([
        {
          employeeId: veteran,
          amount: 2,
          sourceRef: `accrual:${policyId}:2026-03`,
          effectiveDate: "2026-03-01",
        },
        {
          employeeId: joiner,
          amount: 1.03,
          sourceRef: `accrual:${policyId}:2026-03`,
          effectiveDate: "2026-03-16",
        },
      ]),
    );
    expect(rows).toHaveLength(2);
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain(
      "example.invalid",
    );

    // Retried or re-enqueued job: the balance is unchanged.
    expect(await run(orgId, "2026-03-31").result).toMatchObject({
      written: 0,
      alreadyAccrued: 2,
    });
    expect(await ledger(orgId)).toEqual(rows);
  });

  it("grants upfront policies once, in the first active month of the year", async () => {
    const { orgId, leaveTypeId } = await newOrg();
    const policyId = await newPolicy(orgId, leaveTypeId, 30, "upfront");
    const employee = await newEmployee(orgId, "2024-01-01");
    await assign(orgId, employee, policyId, "2024-01-01");

    await run(orgId, "2026-01-05").result;
    await run(orgId, "2026-02-05").result;
    expect(await ledger(orgId)).toEqual([
      {
        employeeId: employee,
        amount: 30,
        sourceRef: `accrual:${policyId}:2026-01`,
        effectiveDate: "2026-01-01",
      },
    ]);
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
      assignments: 1,
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
});
