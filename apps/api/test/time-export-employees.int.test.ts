import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  getTestDatabase,
  seedScopedOrg,
  type FixturePerson,
  type ScopedOrgFixture,
  type TestDatabase,
} from "@librehr/testing";
import { runMigrations } from "@librehr/db/migrate";
import type { ExportEmployeesResponse } from "@librehr/contracts";
import { createApp } from "../src/app.js";
import { as, fixtureAuthPort } from "./support/fixture-app.js";

// TIM-006 / TIM-008: the export's employee picker lists whom the caller may
// export (time.record.read scope), never gated on employee.read, per AGENTS §6
// (success, validation, 401, scope, cross-tenant).
const PERIOD = "startDate=2026-11-02&endDate=2026-11-04";
const PATH = `/v1/time/export/employees?${PERIOD}`;

describe("GET /v1/time/export/employees (TIM-006, TIM-008)", () => {
  let db: TestDatabase;
  let app: ReturnType<typeof createApp>;
  let a: ScopedOrgFixture;
  let b: ScopedOrgFixture;
  let leaverId: string;

  const get = (path: string, person?: FixturePerson) =>
    app.request(path, person ? { headers: as(person) } : {});

  const items = async (person: FixturePerson) => {
    const res = await get(PATH, person);
    expect(res.status).toBe(200);
    return ((await res.json()) as ExportEmployeesResponse).items;
  };

  const everyone = (org: ScopedOrgFixture) =>
    [org.admin, org.manager, org.report, org.peer, org.auditor].map(
      (p) => p.employeeId,
    );

  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database) throw new Error("Docker is required for this suite");
    db = database;
    await runMigrations(db.connectionString);
    a = await seedScopedOrg(db.sql, "txe-a");
    b = await seedScopedOrg(db.sql, "txe-b");
    // Left before the period: never part of an organization export.
    const [leaver] = await db.sql<{ id: string }[]>`
      INSERT INTO employees (organization_id, first_name, last_name, email, status, termination_date)
      VALUES (${a.orgId}, 'Former', 'Leaver', 'former-txe@fixture.invalid', 'terminated', '2026-01-31')
      RETURNING id`;
    leaverId = leaver!.id;
    app = createApp({
      sql: await db.appSql(),
      authPort: fixtureAuthPort([
        a.admin,
        a.manager,
        a.report,
        a.peer,
        a.auditor,
        b.admin,
        b.auditor,
      ]),
    });
  }, 90000);

  afterAll(async () => {
    if (db) await db.close();
  });

  it("lists every employee employed in the period for an admin, by name, id and name only", async () => {
    const list = await items(a.admin);
    expect(list.map((e) => e.id).sort()).toEqual(everyone(a).sort());
    expect(list.map((e) => e.id)).not.toContain(leaverId);
    const names = list.map((e) => e.name);
    expect(names).toEqual([...names].sort((x, y) => x.localeCompare(y, "es")));
    expect(names).toContain("Fixture report");
    for (const item of list)
      expect(Object.keys(item).sort()).toEqual(["id", "name"]);
  });

  it("lists the whole organization for an auditor without employee.read", async () => {
    const list = await items(a.auditor);
    expect(list.map((e) => e.id).sort()).toEqual(everyone(a).sort());
    // The directory stays closed to the auditor.
    expect((await get("/v1/employees", a.auditor)).status).toBe(403);
  });

  it("lists only self and direct reports for a manager", async () => {
    const list = await items(a.manager);
    expect(list.map((e) => e.id).sort()).toEqual(
      [a.manager.employeeId, a.report.employeeId].sort(),
    );
  });

  it("lists only the caller for an employee", async () => {
    expect((await items(a.peer)).map((e) => e.id)).toEqual([a.peer.employeeId]);
  });

  it("never lists another organization's employees", async () => {
    for (const person of [b.admin, b.auditor]) {
      const ids = (await items(person)).map((e) => e.id);
      expect(ids.sort()).toEqual(everyone(b).sort());
      for (const id of everyone(a)) expect(ids).not.toContain(id);
    }
  });

  it("rejects invalid periods with 400 problem+json", async () => {
    for (const query of [
      "startDate=2026-13-01&endDate=2026-11-04",
      "startDate=2026-11-02",
      "startDate=2026-11-04&endDate=2026-11-02",
      "startDate=2026-01-01&endDate=2027-01-02",
    ]) {
      const res = await get(`/v1/time/export/employees?${query}`, a.admin);
      expect(res.status).toBe(400);
      expect(res.headers.get("content-type")).toContain(
        "application/problem+json",
      );
    }
  });

  it("requires authentication", async () => {
    expect((await get(PATH)).status).toBe(401);
  });
});
