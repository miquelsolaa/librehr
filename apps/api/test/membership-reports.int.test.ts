import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getTestDatabase, type TestDatabase } from "@librehr/testing";
import {
  DepartmentRepository,
  EmployeeMembershipRepository,
  EmployeeRepository,
  OrgGroupRepository,
  withTenant,
  type TenantTx,
} from "@librehr/db";
import { runMigrations } from "@librehr/db/migrate";
import type { AuthUser, OrgChartNode } from "@librehr/contracts";
import type { AuthPort } from "../src/ports/auth.js";
import { createApp } from "../src/app.js";

/**
 * ORG-007 (issue #81, ADR 0008): headcount by membership with FTE, dotted
 * lines on the org chart, and memberships in the data-subject export.
 */
const org = "10000000-0000-0000-0000-000000008801";
const otherOrg = "10000000-0000-0000-0000-000000008802";
const users: Record<string, AuthUser> = {
  admin: {
    id: "10000000-0000-0000-0000-000000008803",
    email: "admin@membership-reports.invalid",
    name: "Admin",
    role: "admin",
    organizationId: org,
  },
  employee: {
    id: "10000000-0000-0000-0000-000000008804",
    email: "employee@membership-reports.invalid",
    name: "Employee",
    role: "employee",
    organizationId: org,
  },
  otherAdmin: {
    id: "10000000-0000-0000-0000-000000008805",
    email: "admin@membership-reports-other.invalid",
    name: "Other admin",
    role: "admin",
    organizationId: otherOrg,
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

const period = "startDate=2026-01-01&endDate=2026-06-30";

describe("reports, org chart and DSR export by membership (ORG-007)", () => {
  let db: TestDatabase;
  let app: ReturnType<typeof createApp>;
  // Ids filled in beforeAll.
  const id = {} as Record<
    "ops" | "sales" | "launch" | "risk" | "lead" | "ana" | "ben" | "other",
    string
  >;

  const get = (as: string | null, path: string) =>
    app.request(`/v1${path}`, {
      headers: as ? { Authorization: `Bearer ${as}` } : {},
    });
  const breakdown = async (query: string, as = "admin") => {
    const res = await get(as, `/reports/headcount?${period}&${query}`);
    expect(res.status).toBe(200);
    return ((await res.json()) as { breakdown: unknown }).breakdown;
  };

  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database) throw new Error("Docker is required for report tests");
    db = database;
    await runMigrations(db.connectionString);
    await db.sql`INSERT INTO organizations (id, name, slug) VALUES (${org}, 'Reports', 'membership-reports'), (${otherOrg}, 'Other', 'membership-reports-other')`;
    for (const u of Object.values(users))
      await db.sql`INSERT INTO users (id, email, name) VALUES (${u.id}, ${u.email}, ${u.name})`;
    const employees = new EmployeeRepository();
    const departments = new DepartmentRepository();
    const groups = new OrgGroupRepository();
    const memberships = new EmployeeMembershipRepository();
    const person = async (tx: TenantTx, name: string, departmentId: string) => {
      const { id: employeeId } = await employees.create(tx, {
        firstName: name,
        lastName: "Report",
        email: `${name.toLowerCase()}@membership-reports.invalid`,
        departmentId,
      });
      await tx`INSERT INTO employments (employee_id, job_title, start_date) VALUES (${employeeId}, 'Employee', '2025-01-01')`;
      return employeeId;
    };

    await withTenant(db.sql, { organizationId: org }, async (tx) => {
      const createdBy = users["admin"]!.id;
      id.ops = (await departments.create(tx, { name: "Operations" })).id;
      id.sales = (await departments.create(tx, { name: "Sales" })).id;
      id.lead = await person(tx, "Lead", id.ops);
      id.ana = await person(tx, "Ana", id.sales);
      id.ben = await person(tx, "Ben", id.ops);
      await tx`UPDATE departments SET lead_employee_id = ${id.lead} WHERE id = ${id.ops}`;
      id.launch = (
        await groups.create(tx, {
          kind: "project",
          name: "Launch",
          leadEmployeeId: id.lead,
        })
      ).id;
      id.risk = (await groups.create(tx, { kind: "area", name: "Risk" })).id;
      await memberships.create(tx, {
        employeeId: id.ana,
        departmentId: id.ops,
        allocationPercent: 25,
        startDate: "2020-01-01",
        createdBy,
      });
      await memberships.create(tx, {
        employeeId: id.ana,
        groupId: id.launch,
        allocationPercent: 40,
        startDate: "2020-01-01",
        createdBy,
      });
      await memberships.create(tx, {
        employeeId: id.ben,
        groupId: id.launch,
        startDate: "2020-01-01",
        createdBy,
      });
      // Ended long before the report date and today.
      await memberships.create(tx, {
        employeeId: id.ben,
        groupId: id.risk,
        startDate: "2020-01-01",
        endDate: "2020-12-31",
        createdBy,
      });
    });
    await withTenant(db.sql, { organizationId: otherOrg }, async (tx) => {
      const dept = (await departments.create(tx, { name: "Operations" })).id;
      id.other = await person(tx, "Other", dept);
      const group = await groups.create(tx, {
        kind: "project",
        name: "Launch",
      });
      await memberships.create(tx, {
        employeeId: id.other,
        groupId: group.id,
        startDate: "2020-01-01",
        createdBy: users["otherAdmin"]!.id,
      });
    });
    app = createApp({ sql: await db.appSql(), authPort: auth });
  }, 60000);

  afterAll(async () => {
    if (db) await db.close();
  });

  it("requires an administrator and validates groupBy and basis", async () => {
    const path = `/reports/headcount?${period}&groupBy=group`;
    expect((await get(null, path)).status).toBe(401);
    expect((await get("employee", path)).status).toBe(403);
    for (const query of [
      "groupBy=team",
      "basis=membership",
      "groupBy=group&basis=primary",
      "groupBy=department&basis=all",
    ]) {
      const res = await get("admin", `/reports/headcount?${period}&${query}`);
      expect(res.status).toBe(400);
    }
  });

  it("counts primary departments by default, adding up to the headcount", async () => {
    const res = await get(
      "admin",
      `/reports/headcount?${period}&groupBy=department`,
    );
    const body = (await res.json()) as {
      headcount: { endingHeadcount: number };
      breakdown: unknown;
    };
    expect(body.headcount.endingHeadcount).toBe(3);
    expect(body.breakdown).toEqual({
      groupBy: "department",
      basis: "primary",
      asOf: "2026-06-30",
      totalsOverlap: false,
      rows: [
        {
          type: "department",
          id: id.ops,
          name: "Operations",
          headcount: 2,
          fte: 2,
        },
        {
          type: "department",
          id: id.sales,
          name: "Sales",
          headcount: 1,
          fte: 1,
        },
      ],
    });
  });

  it("adds secondary members weighted by allocation on the membership basis", async () => {
    expect(
      await breakdown("groupBy=department&basis=membership"),
    ).toMatchObject({
      basis: "membership",
      totalsOverlap: true,
      rows: [
        { id: id.ops, headcount: 3, fte: 2.25 },
        { id: id.sales, headcount: 1, fte: 1 },
      ],
    });
  });

  it("breaks down projects and areas without ended or other-tenant members", async () => {
    expect(await breakdown("groupBy=group")).toEqual({
      groupBy: "group",
      basis: "membership",
      asOf: "2026-06-30",
      totalsOverlap: true,
      rows: [
        {
          type: "project",
          id: id.launch,
          name: "Launch",
          headcount: 2,
          fte: 1.4,
        },
      ],
    });
  });

  it("omits the breakdown without groupBy", async () => {
    const res = await get("admin", `/reports/headcount?${period}`);
    expect(await res.json()).not.toHaveProperty("breakdown");
  });

  it("exports the breakdown as CSV and audits it", async () => {
    const path = `/reports/headcount/export?${period}&groupBy=group`;
    expect((await get(null, path)).status).toBe(401);
    expect((await get("employee", path)).status).toBe(403);
    const res = await get("admin", path);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain(
      "headcount-group-2026-01-01-2026-06-30.csv",
    );
    expect(await res.text()).toBe(
      "as_of,basis,totals_overlap,group_type,group_id,group_name,headcount,fte\r\n" +
        `2026-06-30,membership,true,project,${id.launch},Launch,2,1.4\r\n`,
    );
    const rows = await withTenant(
      db.sql,
      { organizationId: org },
      (tx) => tx<{ metadata: unknown }[]>`
        SELECT metadata FROM audit_log
        WHERE action = 'report.headcount_export'`,
    );
    expect(rows).toHaveLength(1);
    const metadata = rows[0]!.metadata;
    expect(
      typeof metadata === "string" ? JSON.parse(metadata) : metadata,
    ).toEqual({
      startDate: "2026-01-01",
      endDate: "2026-06-30",
      groupBy: "group",
      basis: "membership",
    });
  });

  it("draws active memberships as dotted lines to their leads on the org chart", async () => {
    const res = await get("admin", "/people/org-chart");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { roots: OrgChartNode[] };
    const nodes = new Map<string, OrgChartNode>();
    const walk = (list: OrgChartNode[]) => {
      for (const n of list) {
        nodes.set(n.id, n);
        walk(n.directReports);
      }
    };
    walk(body.roots);
    expect([...nodes.keys()].sort()).toEqual([id.ana, id.ben, id.lead].sort());
    expect(nodes.get(id.ana)!.secondaryMemberships).toEqual([
      {
        type: "department",
        id: id.ops,
        name: "Operations",
        allocationPercent: 25,
        leadEmployeeId: id.lead,
        leadName: "Lead Report",
      },
      {
        type: "project",
        id: id.launch,
        name: "Launch",
        allocationPercent: 40,
        leadEmployeeId: id.lead,
        leadName: "Lead Report",
      },
    ]);
    // The ended Risk membership is not drawn.
    expect(nodes.get(id.ben)!.secondaryMemberships.map((m) => m.id)).toEqual([
      id.launch,
    ]);
    expect(nodes.get(id.lead)!.secondaryMemberships).toEqual([]);
  });

  it("includes current and past memberships in the data-subject export", async () => {
    const res = await get("admin", `/employees/${id.ben}/dsr-export`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { memberships: unknown[] };
    // Both start on the same day, so the order between them is not fixed.
    expect(body.memberships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetType: "area",
          targetName: "Risk",
          startDate: "2020-01-01",
          endDate: "2020-12-31",
        }),
        expect.objectContaining({
          targetType: "project",
          targetName: "Launch",
          allocationPercent: null,
          endDate: null,
        }),
      ]),
    );
    expect(body.memberships).toHaveLength(2);
    // Who recorded or ended a membership is someone else's data.
    expect(JSON.stringify(body.memberships)).not.toContain(users["admin"]!.id);
  });

  it("keeps other tenants out of the export and the org chart", async () => {
    expect(
      (await get("admin", `/employees/${id.other}/dsr-export`)).status,
    ).toBe(404);
    const res = await get("otherAdmin", "/people/org-chart");
    const body = (await res.json()) as { roots: OrgChartNode[] };
    expect(body.roots.map((n) => n.id)).toEqual([id.other]);
    expect(
      body.roots[0]!.secondaryMemberships.map((m) => m.leadEmployeeId),
    ).toEqual([null]);
  });
});
