import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  getTestDatabase,
  seedScopedOrg,
  type FixturePerson,
  type ScopedOrgFixture,
  type TestDatabase,
} from "@librehr/testing";
import { runMigrations } from "@librehr/db/migrate";
import { LeaveRepository, withTenant } from "@librehr/db";
import { createApp } from "../src/app.js";
import { as, fixtureAuthPort } from "./support/fixture-app.js";

// LEA-008: GET /leave/delegations returns only what the caller may see. The
// free-text reason can carry special-category data, so a caller without a
// linked employee must get nothing, never the whole organization.
describe("approval delegation list scope (LEA-008)", () => {
  let db: TestDatabase;
  let app: ReturnType<typeof createApp>;
  let a: ScopedOrgFixture;
  let b: ScopedOrgFixture;
  let unlinked: FixturePerson;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database) throw new Error("Docker is required for this suite");
    db = database;
    await runMigrations(db.connectionString);
    a = await seedScopedOrg(db.sql, "deleg-a");
    b = await seedScopedOrg(db.sql, "deleg-b");

    // A member (manager role) with no employee record.
    const userId = randomUUID();
    const email = `unlinked-${userId.slice(0, 8)}@fixture.invalid`;
    await db.sql`INSERT INTO users (id, email, name) VALUES (${userId}, ${email}, 'Fixture unlinked')`;
    await db.sql`INSERT INTO memberships (organization_id, user_id, role)
      VALUES (${a.orgId}, ${userId}, 'manager')`;
    unlinked = {
      id: userId,
      email,
      name: "Fixture unlinked",
      role: "manager",
      organizationId: a.orgId,
      employeeId: randomUUID(),
    };

    const repo = new LeaveRepository();
    await withTenant(db.sql, { organizationId: a.orgId }, async (tx) => {
      ids["managerToReport"] = (
        await repo.createApprovalDelegation(tx, {
          managerEmployeeId: a.manager.employeeId,
          delegateEmployeeId: a.report.employeeId,
          startDate: "2026-07-01",
          endDate: "2026-07-15",
          reason: "fixture reason one",
        })
      ).id;
      ids["adminToPeer"] = (
        await repo.createApprovalDelegation(tx, {
          managerEmployeeId: a.admin.employeeId,
          delegateEmployeeId: a.peer.employeeId,
          startDate: "2026-08-01",
          endDate: "2026-08-15",
          reason: "fixture reason two",
        })
      ).id;
    });

    app = createApp({
      sql: await db.appSql(),
      authPort: fixtureAuthPort([
        a.admin,
        a.manager,
        a.report,
        a.peer,
        a.auditor,
        b.admin,
        unlinked,
      ]),
    });
  }, 90000);

  afterAll(async () => {
    if (db) await db.close();
  });

  const list = async (person: FixturePerson, query = "") => {
    const res = await app.request(`/v1/leave/delegations${query}`, {
      headers: as(person),
    });
    return {
      status: res.status,
      ids: res.ok
        ? ((await res.json()) as { id: string }[]).map((d) => d.id).sort()
        : [],
    };
  };

  it("returns an empty list to a non-admin without a linked employee", async () => {
    expect(await list(unlinked)).toEqual({ status: 200, ids: [] });
  });

  it("shows other non-admins only the delegations they take part in", async () => {
    expect(await list(a.report)).toEqual({
      status: 200,
      ids: [ids["managerToReport"]],
    });
    expect(await list(a.manager)).toEqual({
      status: 200,
      ids: [ids["managerToReport"]],
    });
    expect(await list(a.peer)).toEqual({
      status: 200,
      ids: [ids["adminToPeer"]],
    });
    expect(await list(a.auditor)).toEqual({ status: 200, ids: [] });
    // A non-admin cannot widen the list with the filter.
    expect(await list(a.peer, `?employeeId=${a.manager.employeeId}`)).toEqual({
      status: 200,
      ids: [ids["adminToPeer"]],
    });
  });

  it("shows admins the organization's delegations, optionally filtered", async () => {
    expect((await list(a.admin)).ids).toEqual(
      [ids["managerToReport"], ids["adminToPeer"]].sort(),
    );
    expect(await list(a.admin, `?employeeId=${a.report.employeeId}`)).toEqual({
      status: 200,
      ids: [ids["managerToReport"]],
    });
    expect((await list(a.admin, "?employeeId=not-a-uuid")).status).toBe(400);
  });

  it("never returns another tenant's delegations", async () => {
    expect(await list(b.admin)).toEqual({ status: 200, ids: [] });
    expect(await list(b.admin, `?employeeId=${a.report.employeeId}`)).toEqual({
      status: 200,
      ids: [],
    });
  });

  it("requires authentication", async () => {
    const res = await app.request("/v1/leave/delegations");
    expect(res.status).toBe(401);
  });
});
