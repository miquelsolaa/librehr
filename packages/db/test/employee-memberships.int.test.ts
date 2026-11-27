import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createRoleSeparatedDatabase,
  getTestDatabase,
  type RoleSeparatedDatabase,
  type TestDatabase,
} from "@librehr/testing";
import { runMigrations } from "../src/migrate.js";
import { withTenant, type TenantTx } from "../src/with-tenant.js";
import { EmployeeMembershipRepository } from "../src/repositories/employee-membership.repository.js";
import { OrgGroupRepository } from "../src/repositories/org-group.repository.js";

// ORG-007 (issue #81, ADR 0008): org_groups and employee_memberships (0046),
// exercised as the runtime role so RLS applies.
describe("employee memberships and org groups (0046)", () => {
  let base: TestDatabase;
  let db: RoleSeparatedDatabase;
  const memberships = new EmployeeMembershipRepository();
  const groups = new OrgGroupRepository();
  const actor = crypto.randomUUID();
  const ids = {
    orgA: crypto.randomUUID(),
    orgB: crypto.randomUUID(),
    empA: crypto.randomUUID(),
    empA2: crypto.randomUUID(),
    empB: crypto.randomUUID(),
    deptA: crypto.randomUUID(),
    deptA2: crypto.randomUUID(),
    deptB: crypto.randomUUID(),
  };

  const asOrg = <T>(orgId: string, fn: (tx: TenantTx) => Promise<T>) =>
    withTenant(db.appSql, { organizationId: orgId }, fn);
  const inA = <T>(fn: (tx: TenantTx) => Promise<T>) => asOrg(ids.orgA, fn);

  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database) throw new Error("Docker is required for these tests");
    base = database;
    db = await createRoleSeparatedDatabase(base);
    await runMigrations(db.ownerConnectionString);

    const sql = db.adminSql;
    await sql`
      INSERT INTO organizations (id, name, slug)
      VALUES (${ids.orgA}, 'Org A', ${`org-a-${ids.orgA}`}),
             (${ids.orgB}, 'Org B', ${`org-b-${ids.orgB}`})`;
    await sql`
      INSERT INTO departments (id, organization_id, name)
      VALUES (${ids.deptA}, ${ids.orgA}, 'Sales'),
             (${ids.deptA2}, ${ids.orgA}, 'Support'),
             (${ids.deptB}, ${ids.orgB}, 'Sales')`;
    await sql`
      INSERT INTO employees (id, organization_id, department_id, first_name, last_name, email)
      VALUES (${ids.empA}, ${ids.orgA}, ${ids.deptA}, 'Ana', 'A', 'ana@a.test'),
             (${ids.empA2}, ${ids.orgA}, ${ids.deptA}, 'Bea', 'A', 'bea@a.test'),
             (${ids.empB}, ${ids.orgB}, ${ids.deptB}, 'Carla', 'B', 'carla@b.test')`;
  }, 60000);

  afterAll(async () => {
    if (db) await db.close();
    if (base) await base.close();
  });

  it("creates, lists and ends a department membership with its history", async () => {
    const created = await inA((tx) =>
      memberships.create(tx, {
        employeeId: ids.empA,
        departmentId: ids.deptA2,
        role: "member",
        allocationPercent: 40.5,
        startDate: "2026-01-01",
        createdBy: actor,
      }),
    );
    expect(created).toMatchObject({
      organizationId: ids.orgA,
      employeeId: ids.empA,
      departmentId: ids.deptA2,
      groupId: null,
      targetType: "department",
      targetName: "Support",
      allocationPercent: 40.5,
      startDate: "2026-01-01",
      endDate: null,
      createdBy: actor,
    });

    const ended = await inA((tx) =>
      memberships.end(tx, ids.empA, created.id, {
        endDate: "2026-06-30",
        endedBy: actor,
        endReason: "reassigned",
      }),
    );
    expect(ended).toMatchObject({
      endDate: "2026-06-30",
      endedBy: actor,
      endReason: "reassigned",
    });

    const active = await inA((tx) =>
      memberships.listActiveOn(tx, ids.empA, "2026-07-01"),
    );
    expect(active.map((m) => m.id)).not.toContain(created.id);
    const all = await inA((tx) => memberships.listForEmployee(tx, ids.empA));
    expect(all.map((m) => m.id)).toContain(created.id);
  });

  it("rejects an end date before the start (23514)", async () => {
    const m = await inA((tx) =>
      memberships.create(tx, {
        employeeId: ids.empA2,
        departmentId: ids.deptA2,
        startDate: "2026-03-01",
        createdBy: actor,
      }),
    );
    await expect(
      inA((tx) =>
        memberships.end(tx, ids.empA2, m.id, {
          endDate: "2026-02-28",
          endedBy: actor,
        }),
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("rejects overlapping periods of the same target (23P01) and accepts the next period", async () => {
    const group = await inA((tx) =>
      groups.create(tx, { kind: "project", name: "Overlap project" }),
    );
    const add = (startDate: string, endDate: string | null) =>
      inA((tx) =>
        memberships.create(tx, {
          employeeId: ids.empA,
          groupId: group.id,
          startDate,
          endDate,
          createdBy: actor,
        }),
      );

    await add("2026-01-01", "2026-12-31");
    await expect(add("2026-12-31", null)).rejects.toMatchObject({
      code: "23P01",
    });
    await expect(add("2027-01-01", null)).resolves.toMatchObject({
      targetType: "project",
      targetName: "Overlap project",
    });
    // An open-ended row blocks any later start for the same target.
    await expect(add("2030-01-01", null)).rejects.toMatchObject({
      code: "23P01",
    });
  });

  it("enforces exactly one target and the allocation range (23514)", async () => {
    const group = await inA((tx) =>
      groups.create(tx, { kind: "area", name: "Checks area" }),
    );
    const insert = (
      deptId: string | null,
      groupId: string | null,
      pct: number | null,
    ) =>
      inA(
        (tx) => tx`
          INSERT INTO employee_memberships
            (employee_id, department_id, group_id, allocation_percent, start_date, created_by)
          VALUES (${ids.empA2}, ${deptId}, ${groupId}, ${pct}, '2026-01-01', ${actor})`,
      );

    await expect(insert(ids.deptA, group.id, null)).rejects.toMatchObject({
      code: "23514",
    });
    await expect(insert(null, null, null)).rejects.toMatchObject({
      code: "23514",
    });
    await expect(insert(null, group.id, 100.01)).rejects.toMatchObject({
      code: "23514",
    });
    await expect(insert(null, group.id, 0)).rejects.toMatchObject({
      code: "23514",
    });
  });

  it("accepts only coarse end reasons (23514)", async () => {
    const m = await inA((tx) =>
      memberships.create(tx, {
        employeeId: ids.empA,
        departmentId: ids.deptA2,
        startDate: "2030-01-01",
        createdBy: actor,
      }),
    );
    await expect(
      inA(
        (tx) => tx`
          UPDATE employee_memberships SET end_reason = 'sick leave'
          WHERE id = ${m.id}`,
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("keeps an invitation's department in the tenant and clears it on delete", async () => {
    const invite = (deptId: string) =>
      inA(
        (tx) => tx<{ id: string }[]>`
          INSERT INTO invitations (email, role, token, expires_at, department_id)
          VALUES (${`${crypto.randomUUID()}@a.test`}, 'employee',
                  ${crypto.randomUUID()}, now() + interval '1 day', ${deptId})
          RETURNING id`,
      );
    await expect(invite(ids.deptB)).rejects.toMatchObject({ code: "23503" });

    const doomed = crypto.randomUUID();
    await db.adminSql`
      INSERT INTO departments (id, organization_id, name)
      VALUES (${doomed}, ${ids.orgA}, 'Doomed')`;
    const [row] = await invite(doomed);
    await db.adminSql`DELETE FROM departments WHERE id = ${doomed}`;
    const [after] = await db.adminSql<
      { organizationId: string; departmentId: string | null }[]
    >`
      SELECT organization_id AS "organizationId", department_id AS "departmentId"
      FROM invitations WHERE id = ${row!.id}`;
    expect(after).toEqual({ organizationId: ids.orgA, departmentId: null });
  });

  it("rejects links to another tenant's employee, department or group (composite FKs)", async () => {
    const groupB = await asOrg(ids.orgB, (tx) =>
      groups.create(tx, { kind: "project", name: "B project" }),
    );

    await expect(
      inA((tx) =>
        memberships.create(tx, {
          employeeId: ids.empA,
          departmentId: ids.deptB,
          startDate: "2026-01-01",
          createdBy: actor,
        }),
      ),
    ).rejects.toMatchObject({ code: "23503" });
    await expect(
      inA((tx) =>
        memberships.create(tx, {
          employeeId: ids.empA,
          groupId: groupB.id,
          startDate: "2026-01-01",
          createdBy: actor,
        }),
      ),
    ).rejects.toMatchObject({ code: "23503" });
    await expect(
      inA((tx) =>
        memberships.create(tx, {
          employeeId: ids.empB,
          departmentId: ids.deptA,
          startDate: "2026-01-01",
          createdBy: actor,
        }),
      ),
    ).rejects.toMatchObject({ code: "23503" });
    await expect(
      inA((tx) =>
        groups.create(tx, {
          kind: "project",
          name: "Foreign lead",
          leadEmployeeId: ids.empB,
        }),
      ),
    ).rejects.toMatchObject({ code: "23503" });
    await expect(
      inA((tx) =>
        groups.create(tx, {
          kind: "project",
          name: "Foreign parent",
          parentId: groupB.id,
        }),
      ),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("isolates tenants: B neither reads A's rows nor writes into A (RLS)", async () => {
    const groupA = await inA((tx) =>
      groups.create(tx, { kind: "area", name: "Private area" }),
    );
    const m = await inA((tx) =>
      memberships.create(tx, {
        employeeId: ids.empA,
        groupId: groupA.id,
        startDate: "2026-01-01",
        createdBy: actor,
      }),
    );

    await asOrg(ids.orgB, async (tx) => {
      expect(await groups.findById(tx, groupA.id)).toBeNull();
      expect(
        (await groups.findMany(tx, { includeArchived: true })).map((g) => g.id),
      ).not.toContain(groupA.id);
      expect(await memberships.findById(tx, ids.empA, m.id)).toBeNull();
      expect(await memberships.listForEmployee(tx, ids.empA)).toEqual([]);
      expect(await groups.archive(tx, groupA.id)).toBeNull();
      expect(
        await memberships.end(tx, ids.empA, m.id, {
          endDate: "2026-01-31",
          endedBy: actor,
        }),
      ).toBeNull();
      const raw = await tx`SELECT id FROM employee_memberships`;
      expect(raw.map((r) => r["id"])).not.toContain(m.id);
    });

    await expect(
      asOrg(
        ids.orgB,
        (tx) => tx`
          INSERT INTO org_groups (organization_id, kind, name)
          VALUES (${ids.orgA}, 'area', 'Smuggled')`,
      ),
    ).rejects.toMatchObject({ code: "42501" });

    const stillOpen = await inA((tx) =>
      memberships.findById(tx, ids.empA, m.id),
    );
    expect(stillOpen?.endDate).toBeNull();
  });

  it("archives groups instead of deleting them; active names are unique per kind", async () => {
    const g = await inA((tx) =>
      groups.create(tx, {
        kind: "project",
        name: "Apollo",
        startsOn: "2026-02-01",
        endsOn: "2026-11-30",
      }),
    );
    expect(g).toMatchObject({
      kind: "project",
      startsOn: "2026-02-01",
      endsOn: "2026-11-30",
      archivedAt: null,
    });

    await expect(
      inA((tx) => groups.create(tx, { kind: "project", name: "apollo" })),
    ).rejects.toMatchObject({ code: "23505" });
    // Another kind may share the name.
    await expect(
      inA((tx) => groups.create(tx, { kind: "area", name: "Apollo" })),
    ).resolves.toMatchObject({ kind: "area" });

    const archived = await inA((tx) => groups.archive(tx, g.id));
    expect(archived?.archivedAt).toBeInstanceOf(Date);
    const again = await inA((tx) => groups.archive(tx, g.id));
    expect(again?.archivedAt?.getTime()).toBe(archived?.archivedAt?.getTime());

    const listed = await inA((tx) => groups.findMany(tx, { kind: "project" }));
    expect(listed.map((x) => x.id)).not.toContain(g.id);
    await expect(
      inA((tx) => groups.create(tx, { kind: "project", name: "Apollo" })),
    ).resolves.toMatchObject({ archivedAt: null });

    const renamed = await inA((tx) =>
      groups.update(tx, g.id, { description: "Moon", endsOn: null }),
    );
    expect(renamed).toMatchObject({ description: "Moon", endsOn: null });
  });

  it("keeps history: a referenced department or group cannot be deleted (23503)", async () => {
    const g = await inA((tx) =>
      groups.create(tx, { kind: "project", name: "Referenced" }),
    );
    await inA((tx) =>
      memberships.create(tx, {
        employeeId: ids.empA2,
        groupId: g.id,
        startDate: "2025-01-01",
        endDate: "2025-12-31",
        createdBy: actor,
      }),
    );

    await expect(
      inA((tx) => tx`DELETE FROM departments WHERE id = ${ids.deptA2}`),
    ).rejects.toMatchObject({ code: "23503" });
    await expect(
      inA((tx) => tx`DELETE FROM org_groups WHERE id = ${g.id}`),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("removes memberships with their employee and clears a deleted lead", async () => {
    const sql = db.adminSql;
    const orgC = crypto.randomUUID();
    const deptC = crypto.randomUUID();
    const empC = crypto.randomUUID();
    await sql`INSERT INTO organizations (id, name, slug) VALUES (${orgC}, 'Org C', ${`org-c-${orgC}`})`;
    await sql`INSERT INTO departments (id, organization_id, name) VALUES (${deptC}, ${orgC}, 'Ops')`;
    await sql`
      INSERT INTO employees (id, organization_id, first_name, last_name, email)
      VALUES (${empC}, ${orgC}, 'Dana', 'C', 'dana@c.test')`;

    const g = await asOrg(orgC, (tx) =>
      groups.create(tx, { kind: "area", name: "Led", leadEmployeeId: empC }),
    );
    await asOrg(orgC, (tx) =>
      memberships.create(tx, {
        employeeId: empC,
        departmentId: deptC,
        startDate: "2026-01-01",
        createdBy: actor,
      }),
    );

    await sql`DELETE FROM employees WHERE id = ${empC}`;
    const [count] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM employee_memberships WHERE employee_id = ${empC}`;
    expect(count?.n).toBe(0);
    const [group] = await sql<{ lead: string | null; org: string }[]>`
      SELECT lead_employee_id AS lead, organization_id AS org FROM org_groups WHERE id = ${g.id}`;
    expect(group).toEqual({ lead: null, org: orgC });
  });

  it("still deletes a whole organization with memberships, groups and departments", async () => {
    const sql = db.adminSql;
    const orgD = crypto.randomUUID();
    const deptD = crypto.randomUUID();
    const empD = crypto.randomUUID();
    await sql`INSERT INTO organizations (id, name, slug) VALUES (${orgD}, 'Org D', ${`org-d-${orgD}`})`;
    await sql`INSERT INTO departments (id, organization_id, name) VALUES (${deptD}, ${orgD}, 'Ops')`;
    await sql`
      INSERT INTO employees (id, organization_id, department_id, first_name, last_name, email)
      VALUES (${empD}, ${orgD}, ${deptD}, 'Eva', 'D', 'eva@d.test')`;
    const g = await asOrg(orgD, (tx) =>
      groups.create(tx, {
        kind: "area",
        name: "Parent area",
        leadEmployeeId: empD,
      }),
    );
    await asOrg(orgD, (tx) =>
      groups.create(tx, { kind: "project", name: "Child", parentId: g.id }),
    );
    await asOrg(orgD, async (tx) => {
      await memberships.create(tx, {
        employeeId: empD,
        groupId: g.id,
        startDate: "2026-01-01",
        createdBy: actor,
      });
    });

    await sql`DELETE FROM organizations WHERE id = ${orgD}`;
    const [left] = await sql<{ n: number }[]>`
      SELECT (SELECT count(*) FROM org_groups WHERE organization_id = ${orgD})
           + (SELECT count(*) FROM employee_memberships WHERE organization_id = ${orgD}) AS n`;
    expect(Number(left?.n)).toBe(0);
  });
});
