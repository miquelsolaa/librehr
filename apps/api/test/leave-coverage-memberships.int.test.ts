import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getTestDatabase, type TestDatabase } from "@librehr/testing";
import { runMigrations } from "@librehr/db/migrate";
import {
  withTenant,
  DepartmentRepository,
  EmployeeMembershipRepository,
  EmployeeRepository,
  LeaveRepository,
  type TenantTx,
} from "@librehr/db";
import { createApp } from "../src/app.js";
import type { AuthPort } from "../src/ports/auth.js";
import type { AuthUser } from "@librehr/contracts";

// LEA-007 + ORG-007 (ADR 0008 D6): coverage and blackouts across secondary
// department memberships.
const org = "61000000-0000-0000-0000-000000000081";
const user = (n: number, role: AuthUser["role"]): AuthUser => ({
  id: `61000000-0000-0000-0000-00000000001${n}`,
  email: `person${n}@example.invalid`,
  name: `Person ${n}`,
  role,
  organizationId: org,
});
const admin = user(0, "admin");
const alice = user(1, "employee");
const bruno = user(2, "employee");
const carla = user(3, "employee");
const users = [admin, alice, bruno, carla];

const auth: AuthPort = {
  async verifyCredentials() {
    return null;
  },
  async createSession(u: AuthUser) {
    return { user: u, token: u.id, expiresAt: new Date(Date.now() + 60000) };
  },
  async getSession(token) {
    const u = users.find((x) => x.id === token) ?? null;
    return u
      ? { user: u, token, expiresAt: new Date(Date.now() + 60000) }
      : null;
  },
  async revokeSession() {},
};

describe("leave coverage across memberships (LEA-007, ORG-007)", () => {
  let db: TestDatabase;
  let app: ReturnType<typeof createApp>;
  let leaveTypeId: string;
  const dept: Record<string, string> = {};
  const emp: Record<string, string> = {};

  const requestLeave = (who: AuthUser, date: string) =>
    app.request("/v1/leave/requests", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${who.id}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ leaveTypeId, startDate: date, endDate: date }),
    });

  const tenant = <T>(fn: (tx: TenantTx) => Promise<T>) =>
    withTenant(db.sql, { organizationId: org }, fn);

  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database) throw new Error("Docker is required for coverage tests");
    db = database;
    await runMigrations(db.connectionString);
    await db.sql`INSERT INTO organizations (id, name, slug) VALUES (${org}, 'Membership coverage', 'membership-coverage')`;
    for (const u of users) {
      await db.sql`INSERT INTO users (id, email, name) VALUES (${u.id}, ${u.email}, ${u.name})`;
    }
    await tenant(async (tx) => {
      const departments = new DepartmentRepository();
      // home: alice's primary, no limit. sales: bruno's, full presence.
      // support: carla's, half presence. ops: no policy. legal: unrelated.
      for (const [key, policy] of [
        ["home", 0],
        ["sales", 100],
        ["support", 50],
        ["ops", null],
        ["legal", 0],
      ] as const) {
        dept[key] = (await departments.create(tx, { name: key })).id;
        if (policy !== null) {
          await departments.setCoverage(tx, dept[key]!, policy);
        }
      }
      const employees = new EmployeeRepository();
      const leave = new LeaveRepository();
      leaveTypeId = (
        await leave.createLeaveType(tx, {
          name: "Vacation",
          code: "vacation",
          isPaid: true,
          requiresApproval: true,
        })
      ).id;
      for (const [key, u, departmentId] of [
        ["alice", alice, dept["home"]],
        ["bruno", bruno, dept["sales"]],
        ["carla", carla, dept["support"]],
      ] as const) {
        emp[key] = (
          await employees.create(tx, {
            firstName: u.name,
            lastName: "Test",
            email: u.email,
            userId: u.id,
            departmentId,
          })
        ).id;
        await leave.appendLedgerEntry(tx, {
          employeeId: emp[key]!,
          leaveTypeId,
          entryType: "accrual",
          amount: 20,
          effectiveDate: "2030-01-01",
        });
      }
      const memberships = new EmployeeMembershipRepository();
      // Alice works in sales for ten days and in ops (no policy) for good.
      await memberships.create(tx, {
        employeeId: emp["alice"]!,
        departmentId: dept["sales"]!,
        startDate: "2030-11-01",
        endDate: "2030-11-10",
        createdBy: admin.id,
      });
      await memberships.create(tx, {
        employeeId: emp["alice"]!,
        departmentId: dept["ops"]!,
        startDate: "2030-11-01",
        createdBy: admin.id,
      });
      await leave.createBlackoutPeriod(tx, {
        departmentId: dept["sales"]!,
        startDate: "2030-11-05",
        endDate: "2030-11-06",
        reason: "Sales fair",
      });
      await leave.createBlackoutPeriod(tx, {
        departmentId: dept["sales"]!,
        startDate: "2030-11-20",
        endDate: "2030-11-20",
        reason: "Sales review",
      });
      await leave.createBlackoutPeriod(tx, {
        departmentId: dept["legal"]!,
        startDate: "2030-11-18",
        endDate: "2030-11-18",
        reason: "Legal audit",
      });
    });
    app = createApp({ sql: await db.appSql(), authPort: auth });
  }, 30000);

  afterAll(async () => {
    if (db) await db.close();
  });

  it("applies the blackouts of a secondary department only while the membership is active", async () => {
    const during = await requestLeave(alice, "2030-11-05");
    expect(during.status).toBe(400);
    expect(await during.json()).toMatchObject({ code: "BLACKOUT_PERIOD" });
    // After the sales membership ended, its blackout no longer applies.
    expect((await requestLeave(alice, "2030-11-20")).status).toBe(201);
    // Blackouts of departments the person is not in never apply.
    expect((await requestLeave(alice, "2030-11-18")).status).toBe(201);
  });

  it("blocks at a secondary department's threshold and skips one without a policy", async () => {
    // Sales needs full presence: alice is one of its two heads on that day.
    const blocked = await requestLeave(alice, "2030-11-04");
    expect(blocked.status).toBe(400);
    expect(await blocked.json()).toMatchObject({ code: "COVERAGE_THRESHOLD" });
    // Ops has no policy: it never triggers COVERAGE_NOT_CONFIGURED.
    expect((await requestLeave(alice, "2030-11-12")).status).toBe(201);
  });

  it("counts secondary members and their absences in a department's coverage", async () => {
    // Support needs 50%: carla alone would leave nobody present.
    const alone = await requestLeave(carla, "2031-01-06");
    expect(alone.status).toBe(400);
    expect(await alone.json()).toMatchObject({ code: "COVERAGE_THRESHOLD" });

    await tenant(async (tx) => {
      await new EmployeeMembershipRepository().create(tx, {
        employeeId: emp["alice"]!,
        departmentId: dept["support"]!,
        startDate: "2031-01-01",
        endDate: "2031-01-31",
        createdBy: admin.id,
      });
    });
    // With alice as a secondary member, one of two heads stays present.
    expect((await requestLeave(carla, "2031-01-06")).status).toBe(201);

    // An approved absence of the secondary member counts for support.
    await tenant(async (tx) => {
      const leave = new LeaveRepository();
      const request = await leave.createLeaveRequest(tx, {
        employeeId: emp["alice"]!,
        leaveTypeId,
        startDate: "2031-01-07",
        endDate: "2031-01-07",
        workingDays: 1,
      });
      await leave.approveLeaveRequest(tx, request.id, emp["bruno"]!);
    });
    const taken = await requestLeave(carla, "2031-01-07");
    expect(taken.status).toBe(400);
    expect(await taken.json()).toMatchObject({ code: "COVERAGE_THRESHOLD" });
  });

  it("keeps requiring a policy on the primary department", async () => {
    await tenant(async (tx) => {
      await tx`UPDATE employees SET department_id = ${dept["ops"]!} WHERE id = ${emp["bruno"]!}`;
    });
    const res = await requestLeave(bruno, "2030-11-04");
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "COVERAGE_NOT_CONFIGURED" });
  });
});
