import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getTestDatabase, type TestDatabase } from "@librehr/testing";
import {
  DepartmentRepository,
  EmployeeRepository,
  withTenant,
} from "@librehr/db";
import { runMigrations } from "@librehr/db/migrate";
import type { AuthUser } from "@librehr/contracts";
import type { AuthPort } from "../src/ports/auth.js";
import { createApp } from "../src/app.js";

/** ORG-007 (ADR 0008): org groups and employee membership endpoints. */
const org = "10000000-0000-0000-0000-000000008101";
const otherOrg = "10000000-0000-0000-0000-000000008102";
const users: Record<string, AuthUser> = {
  admin: {
    id: "10000000-0000-0000-0000-000000008103",
    email: "admin@memberships.invalid",
    name: "Admin",
    role: "admin",
    organizationId: org,
  },
  employee: {
    id: "10000000-0000-0000-0000-000000008104",
    email: "employee@memberships.invalid",
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

describe("org groups and employee memberships (ORG-007)", () => {
  let db: TestDatabase;
  let app: ReturnType<typeof createApp>;
  let selfId: string;
  let colleagueId: string;
  let otherTenantEmployeeId: string;
  let primaryDept: string;
  let secondDept: string;
  let otherTenantDept: string;

  const call = (
    as: string | null,
    method: string,
    path: string,
    body?: unknown,
  ) =>
    app.request(`/v1${path}`, {
      method,
      headers: {
        ...(as ? { Authorization: `Bearer ${as}` } : {}),
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database) throw new Error("Docker is required for membership tests");
    db = database;
    await runMigrations(db.connectionString);
    await db.sql`INSERT INTO organizations (id, name, slug) VALUES (${org}, 'Memberships', 'memberships-test'), (${otherOrg}, 'Other', 'memberships-other')`;
    for (const u of Object.values(users))
      await db.sql`INSERT INTO users (id, email, name) VALUES (${u.id}, ${u.email}, ${u.name})`;
    const employees = new EmployeeRepository();
    const departments = new DepartmentRepository();
    await withTenant(db.sql, { organizationId: org }, async (tx) => {
      primaryDept = (await departments.create(tx, { name: "Primary" })).id;
      secondDept = (await departments.create(tx, { name: "Second" })).id;
      selfId = (
        await employees.create(tx, {
          userId: users["employee"]!.id,
          firstName: "Self",
          lastName: "Member",
          email: users["employee"]!.email,
          departmentId: primaryDept,
        })
      ).id;
      colleagueId = (
        await employees.create(tx, {
          firstName: "Colleague",
          lastName: "Member",
          email: "colleague@memberships.invalid",
        })
      ).id;
    });
    await withTenant(db.sql, { organizationId: otherOrg }, async (tx) => {
      otherTenantDept = (await departments.create(tx, { name: "Foreign" })).id;
      otherTenantEmployeeId = (
        await employees.create(tx, {
          firstName: "Other",
          lastName: "Tenant",
          email: "other@memberships.invalid",
        })
      ).id;
    });
    app = createApp({ sql: await db.appSql(), authPort: auth });
  }, 60000);

  afterAll(async () => {
    if (db) await db.close();
  });

  it("creates, lists, updates and archives projects and areas", async () => {
    const area = await call("admin", "POST", "/org/groups", {
      kind: "area",
      name: "Sales",
    });
    expect(area.status).toBe(201);
    const areaId = ((await area.json()) as { id: string }).id;
    const project = await call("admin", "POST", "/org/groups", {
      kind: "project",
      name: "Launch",
      parentId: areaId,
      leadEmployeeId: colleagueId,
      startsOn: "2026-01-01",
    });
    expect(project.status).toBe(201);
    const projectId = ((await project.json()) as { id: string }).id;

    // Only a project under an active area: a project cannot be a parent.
    expect(
      (
        await call("admin", "POST", "/org/groups", {
          kind: "project",
          name: "Nested",
          parentId: projectId,
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await call("admin", "POST", "/org/groups", {
          kind: "area",
          name: "SALES",
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await call("admin", "PATCH", `/org/groups/${projectId}`, {
          endsOn: "2025-12-31",
        })
      ).status,
    ).toBe(422);
    const renamed = await call("admin", "PATCH", `/org/groups/${projectId}`, {
      name: "Launch 2027",
    });
    expect(renamed.status).toBe(200);
    expect(((await renamed.json()) as { name: string }).name).toBe(
      "Launch 2027",
    );

    const listed = await call("employee", "GET", "/org/groups?kind=project");
    expect(listed.status).toBe(200);
    expect(
      ((await listed.json()) as { id: string }[]).map((g) => g.id),
    ).toEqual([projectId]);

    const archived = await call(
      "admin",
      "POST",
      `/org/groups/${projectId}/archive`,
    );
    expect(archived.status).toBe(200);
    expect(
      ((await archived.json()) as { archivedAt: string | null }).archivedAt,
    ).not.toBeNull();
    expect(
      (await call("admin", "POST", `/org/groups/${projectId}/archive`)).status,
    ).toBe(200);
    expect(
      (await call("admin", "PATCH", `/org/groups/${projectId}`, { name: "X" }))
        .status,
    ).toBe(409);
    expect(
      (
        (await (
          await call("admin", "GET", "/org/groups?kind=project")
        ).json()) as unknown[]
      ).length,
    ).toBe(0);
    expect(
      (
        (await (
          await call("admin", "GET", "/org/groups?includeArchived=true")
        ).json()) as unknown[]
      ).length,
    ).toBe(2);

    const auditRows = await withTenant(
      db.sql,
      { organizationId: org },
      (tx) => tx<{ action: string; metadata: unknown }[]>`
        SELECT action, metadata FROM audit_log
        WHERE resource_id = ${projectId} ORDER BY created_at`,
    );
    expect(auditRows.map((r) => r.action)).toEqual([
      "org_group.create",
      "org_group.update",
      "org_group.archive",
    ]);
    expect(JSON.stringify(auditRows)).not.toContain("Launch");
  });

  it("guards group endpoints: 401, 403, 400 and cross-tenant 404", async () => {
    expect((await call(null, "GET", "/org/groups")).status).toBe(401);
    expect(
      (
        await call("employee", "POST", "/org/groups", {
          kind: "area",
          name: "A",
        })
      ).status,
    ).toBe(403);
    expect(
      (await call("admin", "POST", "/org/groups", { kind: "team", name: "A" }))
        .status,
    ).toBe(400);
    expect(
      (
        await call("admin", "POST", "/org/groups", {
          kind: "area",
          name: "Foreign lead",
          leadEmployeeId: otherTenantEmployeeId,
        })
      ).status,
    ).toBe(404);
    const foreign = await withTenant(
      db.sql,
      { organizationId: otherOrg },
      (tx) => tx<{ id: string }[]>`
        INSERT INTO org_groups (kind, name) VALUES ('area', 'Foreign')
        RETURNING id`,
    );
    const foreignId = foreign[0]!.id;
    expect(
      (await call("admin", "PATCH", `/org/groups/${foreignId}`, { name: "Y" }))
        .status,
    ).toBe(404);
    expect(
      (await call("admin", "POST", `/org/groups/${foreignId}/archive`)).status,
    ).toBe(404);
  });

  it("adds, updates and ends memberships, warning above 100%", async () => {
    const group = await call("admin", "POST", "/org/groups", {
      kind: "project",
      name: "Allocation",
    });
    const groupId = ((await group.json()) as { id: string }).id;
    const base = `/employees/${selfId}/memberships`;

    const dept = await call("admin", "POST", base, {
      departmentId: secondDept,
      allocationPercent: 60,
      startDate: "2026-01-01",
    });
    expect(dept.status).toBe(201);
    const deptBody = (await dept.json()) as {
      membership: { id: string; targetType: string; targetName: string };
      overAllocation: unknown;
    };
    expect(deptBody.membership.targetType).toBe("department");
    expect(deptBody.membership.targetName).toBe("Second");
    expect(deptBody.overAllocation).toBeNull();

    const proj = await call("admin", "POST", base, {
      groupId,
      role: "member",
      allocationPercent: 50,
      startDate: "2026-03-01",
      endDate: "2026-06-30",
    });
    expect(proj.status).toBe(201);
    const projBody = (await proj.json()) as {
      membership: { id: string };
      overAllocation: { date: string; totalPercent: number } | null;
    };
    expect(projBody.overAllocation).toEqual({
      date: "2026-03-01",
      totalPercent: 110,
    });

    // Same target, overlapping period.
    expect(
      (
        await call("admin", "POST", base, {
          groupId,
          startDate: "2026-06-30",
        })
      ).status,
    ).toBe(409);
    // A later period of the same target is fine; extending into it is not.
    const later = await call("admin", "POST", base, {
      groupId,
      startDate: "2026-09-01",
    });
    expect(later.status).toBe(201);
    const projectPath = `${base}/${projBody.membership.id}`;
    expect(
      (await call("admin", "PATCH", projectPath, { endDate: "2026-09-15" }))
        .status,
    ).toBe(409);
    expect(
      (await call("admin", "PATCH", projectPath, { endDate: "2026-02-01" }))
        .status,
    ).toBe(422);
    const lowered = await call("admin", "PATCH", projectPath, {
      allocationPercent: 40,
    });
    expect(lowered.status).toBe(200);
    expect(
      ((await lowered.json()) as { overAllocation: unknown }).overAllocation,
    ).toBeNull();

    const deptPath = `${base}/${deptBody.membership.id}`;
    expect(
      (
        await call("admin", "POST", `${deptPath}/end`, {
          endDate: "2025-12-31",
        })
      ).status,
    ).toBe(422);
    const ended = await call("admin", "POST", `${deptPath}/end`, {
      endDate: "2026-12-31",
      reason: "Moved",
    });
    expect(ended.status).toBe(200);
    expect(await ended.json()).toMatchObject({
      endDate: "2026-12-31",
      endReason: "Moved",
    });
    expect(
      (
        await call("admin", "POST", `${deptPath}/end`, {
          endDate: "2026-12-31",
        })
      ).status,
    ).toBe(409);

    const own = await call("employee", "GET", base);
    expect(own.status).toBe(200);
    expect(((await own.json()) as unknown[]).length).toBe(3);

    const auditRows = await withTenant(
      db.sql,
      { organizationId: org },
      (tx) => tx<{ action: string; metadata: unknown }[]>`
        SELECT action, metadata FROM audit_log
        WHERE resource_id = ${selfId} AND action LIKE 'employee.membership.%'`,
    );
    expect(auditRows.map((r) => r.action).sort()).toEqual([
      "employee.membership.add",
      "employee.membership.add",
      "employee.membership.add",
      "employee.membership.end",
      "employee.membership.update",
    ]);
    const logged = JSON.stringify(auditRows);
    expect(logged).not.toContain("Moved");
    expect(logged).not.toContain("Second");
  });

  it("rejects invalid targets: primary, unknown, foreign or archived", async () => {
    const base = `/employees/${colleagueId}/memberships`;
    expect(
      (
        await call("admin", "POST", `/employees/${selfId}/memberships`, {
          departmentId: primaryDept,
          startDate: "2026-01-01",
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await call("admin", "POST", base, {
          departmentId: otherTenantDept,
          startDate: "2026-01-01",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call("admin", "POST", base, {
          departmentId: secondDept,
          groupId: secondDept,
          startDate: "2026-01-01",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call("admin", "POST", base, {
          departmentId: secondDept,
          allocationPercent: 101,
          startDate: "2026-01-01",
        })
      ).status,
    ).toBe(400);
    const archived = await call("admin", "POST", "/org/groups", {
      kind: "area",
      name: "Closed",
    });
    const archivedId = ((await archived.json()) as { id: string }).id;
    await call("admin", "POST", `/org/groups/${archivedId}/archive`);
    expect(
      (
        await call("admin", "POST", base, {
          groupId: archivedId,
          startDate: "2026-01-01",
        })
      ).status,
    ).toBe(409);
  });

  it("guards membership endpoints: 401, 403 and cross-tenant 404", async () => {
    const own = `/employees/${selfId}/memberships`;
    expect((await call(null, "GET", own)).status).toBe(401);
    expect(
      (
        await call("employee", "POST", own, {
          departmentId: secondDept,
          startDate: "2027-01-01",
        })
      ).status,
    ).toBe(403);
    expect(
      (await call("employee", "GET", `/employees/${colleagueId}/memberships`))
        .status,
    ).toBe(403);
    expect(
      (
        await call(
          "admin",
          "GET",
          `/employees/${otherTenantEmployeeId}/memberships`,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await call(
          "admin",
          "POST",
          `/employees/${otherTenantEmployeeId}/memberships`,
          { departmentId: otherTenantDept, startDate: "2026-01-01" },
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await call(
          "admin",
          "PATCH",
          `${own}/10000000-0000-0000-0000-0000000081ff`,
          { role: "x" },
        )
      ).status,
    ).toBe(404);
    expect(
      (await call("admin", "GET", "/employees/not-a-uuid/memberships")).status,
    ).toBe(404);
  });
});
