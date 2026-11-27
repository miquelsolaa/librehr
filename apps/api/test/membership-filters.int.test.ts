import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getTestDatabase, type TestDatabase } from "@librehr/testing";
import {
  DepartmentRepository,
  EmployeeMembershipRepository,
  EmployeeRepository,
  LeaveRepository,
  OrgGroupRepository,
  withTenant,
} from "@librehr/db";
import { runMigrations } from "@librehr/db/migrate";
import type { AuthUser } from "@librehr/contracts";
import type { AuthPort } from "../src/ports/auth.js";
import { createApp } from "../src/app.js";

/**
 * ORG-007 (issue #81, ADR 0008): the directory and the team calendar filter
 * by any membership, not only the primary department.
 */
const org = "10000000-0000-0000-0000-000000008401";
const otherOrg = "10000000-0000-0000-0000-000000008402";
const users: Record<string, AuthUser> = {
  admin: {
    id: "10000000-0000-0000-0000-000000008403",
    email: "admin@membership-filters.invalid",
    name: "Admin",
    role: "admin",
    organizationId: org,
  },
  employee: {
    id: "10000000-0000-0000-0000-000000008404",
    email: "employee@membership-filters.invalid",
    name: "Employee",
    role: "employee",
    organizationId: org,
  },
};
const auth: AuthPort = {
  async verifyCredentials() {
    return null;
  },
  async createSession(user: AuthUser) {
    return { user, token: user.id, expiresAt: new Date(Date.now() + 60000) };
  },
  async getSession(token) {
    const user = users[token];
    return user
      ? { user, token, expiresAt: new Date(Date.now() + 60000) }
      : null;
  },
  async revokeSession() {},
};

interface DirectoryPage {
  items: {
    id: string;
    secondaryMemberships: {
      type: string;
      id: string;
      name: string;
      allocationPercent: number | null;
    }[];
  }[];
  total: number;
}
interface Absence {
  employeeId: string;
  leaveTypeCode: string;
}

describe("directory and team calendar filters by membership (ORG-007)", () => {
  let db: TestDatabase;
  let app: ReturnType<typeof createApp>;
  // Ids filled in beforeAll.
  const id = {} as Record<
    | "ops"
    | "sales"
    | "launch"
    | "primary"
    | "secondary"
    | "ended"
    | "future"
    | "otherGroup",
    string
  >;

  const get = async (as: string | null, path: string) => {
    const res = await app.request(`/v1${path}`, {
      headers: as ? { Authorization: `Bearer ${as}` } : {},
    });
    return { status: res.status, body: (await res.json()) as unknown };
  };
  const directory = async (query: string) => {
    const res = await get("admin", `/employees?${query}`);
    expect(res.status).toBe(200);
    return res.body as DirectoryPage;
  };
  const absences = async (query: string, as = "admin") => {
    const res = await get(
      as,
      `/calendar/team-absences?startDate=2026-03-01&endDate=2026-03-31&${query}`,
    );
    expect(res.status).toBe(200);
    return res.body as Absence[];
  };
  const ids = (rows: { id?: string; employeeId?: string }[]) =>
    rows.map((r) => r.employeeId ?? r.id).sort();

  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database) throw new Error("Docker is required for filter tests");
    db = database;
    await runMigrations(db.connectionString);
    await db.sql`INSERT INTO organizations (id, name, slug) VALUES (${org}, 'Filters', 'membership-filters'), (${otherOrg}, 'Other', 'membership-filters-other')`;
    for (const u of Object.values(users))
      await db.sql`INSERT INTO users (id, email, name) VALUES (${u.id}, ${u.email}, ${u.name})`;
    const employees = new EmployeeRepository();
    const departments = new DepartmentRepository();
    const groups = new OrgGroupRepository();
    const memberships = new EmployeeMembershipRepository();
    const leave = new LeaveRepository();
    const createdBy = users["admin"]!.id;
    await withTenant(db.sql, { organizationId: org }, async (tx) => {
      id.ops = (await departments.create(tx, { name: "Operations" })).id;
      id.sales = (await departments.create(tx, { name: "Sales" })).id;
      id.launch = (
        await groups.create(tx, { kind: "project", name: "Launch" })
      ).id;
      const person = async (name: string, departmentId: string) =>
        (
          await employees.create(tx, {
            firstName: name,
            lastName: "Filter",
            email: `${name.toLowerCase()}@membership-filters.invalid`,
            departmentId,
          })
        ).id;
      id.primary = await person("Primary", id.ops);
      id.secondary = await person("Secondary", id.sales);
      id.ended = await person("Ended", id.sales);
      id.future = await person("Future", id.sales);
      // Active today and during March 2026.
      await memberships.create(tx, {
        employeeId: id.secondary,
        departmentId: id.ops,
        allocationPercent: 50,
        startDate: "2020-01-01",
        createdBy,
      });
      await memberships.create(tx, {
        employeeId: id.secondary,
        groupId: id.launch,
        startDate: "2020-01-01",
        createdBy,
      });
      // Ended before March 2026 and before today.
      await memberships.create(tx, {
        employeeId: id.ended,
        departmentId: id.ops,
        startDate: "2020-01-01",
        endDate: "2020-12-31",
        createdBy,
      });
      // In Launch only from 11 to 20 March 2026.
      await memberships.create(tx, {
        employeeId: id.ended,
        groupId: id.launch,
        startDate: "2026-03-11",
        endDate: "2026-03-20",
        createdBy,
      });
      await memberships.create(tx, {
        employeeId: id.future,
        departmentId: id.ops,
        startDate: "2099-01-01",
        createdBy,
      });

      const type = await leave.createLeaveType(tx, {
        name: "Private leave",
        code: "private",
        isPaid: true,
        requiresApproval: true,
      });
      for (const employeeId of [id.primary, id.secondary, id.ended]) {
        const request = await leave.createLeaveRequest(tx, {
          employeeId,
          leaveTypeId: type.id,
          startDate: "2026-03-09",
          endDate: "2026-03-12",
          workingDays: 4,
        });
        await leave.approveLeaveRequest(tx, request.id, id.primary);
      }
    });
    await withTenant(db.sql, { organizationId: otherOrg }, async (tx) => {
      id.otherGroup = (
        await groups.create(tx, { kind: "project", name: "Launch" })
      ).id;
    });
    app = createApp({ sql: await db.appSql(), authPort: auth });
  }, 60000);

  afterAll(async () => {
    if (db) await db.close();
  });

  it("matches a department filter on the primary or a membership active today", async () => {
    const any = await directory(`departmentId=${id.ops}`);
    expect(ids(any.items)).toEqual([id.primary, id.secondary].sort());
    expect(any.total).toBe(2);

    const primary = await directory(
      `departmentId=${id.ops}&membership=primary`,
    );
    expect(ids(primary.items)).toEqual([id.primary]);
    expect(primary.total).toBe(1);
  });

  it("filters by project and lists the memberships active today", async () => {
    const page = await directory(`groupId=${id.launch}`);
    expect(ids(page.items)).toEqual([id.secondary]);
    expect(page.items[0]!.secondaryMemberships).toEqual([
      {
        type: "department",
        id: id.ops,
        name: "Operations",
        allocationPercent: 50,
      },
      {
        type: "project",
        id: id.launch,
        name: "Launch",
        allocationPercent: null,
      },
    ]);
    const all = await directory("pageSize=100");
    const ended = all.items.find((item) => item.id === id.ended)!;
    expect(ended.secondaryMemberships).toEqual([]);
  });

  it("rejects bad filters and unauthenticated calls", async () => {
    expect((await get("admin", "/employees?groupId=nope")).status).toBe(400);
    expect((await get("admin", "/employees?membership=all")).status).toBe(400);
    expect(
      (await get("admin", "/calendar/team-absences?groupId=nope")).status,
    ).toBe(400);
    expect((await get(null, `/employees?groupId=${id.launch}`)).status).toBe(
      401,
    );
    expect(
      (await get(null, `/calendar/team-absences?groupId=${id.launch}`)).status,
    ).toBe(401);
  });

  it("never matches another tenant's group", async () => {
    expect((await directory(`groupId=${id.otherGroup}`)).total).toBe(0);
    expect(await absences(`groupId=${id.otherGroup}`)).toEqual([]);
  });

  it("shows absences under every department or group whose membership overlaps them", async () => {
    expect(ids(await absences(`departmentId=${id.ops}`))).toEqual(
      [id.primary, id.secondary].sort(),
    );
    expect(ids(await absences(`groupId=${id.launch}`))).toEqual(
      [id.secondary, id.ended].sort(),
    );
    // Clipped to the window, the absence (9-10 March) misses the membership.
    const clipped = await get(
      "admin",
      `/calendar/team-absences?startDate=2026-03-01&endDate=2026-03-10&groupId=${id.launch}`,
    );
    expect(ids(clipped.body as Absence[])).toEqual([id.secondary]);
    // Unfiltered, each request appears once.
    expect(ids(await absences(""))).toEqual(
      [id.primary, id.secondary, id.ended].sort(),
    );
  });

  it("keeps masking leave types for non-HR callers", async () => {
    const rows = await absences(`groupId=${id.launch}`, "employee");
    expect(rows.length).toBe(2);
    expect(rows.every((row) => row.leaveTypeCode === "away")).toBe(true);
  });
});
