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
import { EXPORT_EMPLOYEE_COLLATOR } from "../src/routes/time-export-employees.js";
import { as, fixtureAuthPort } from "./support/fixture-app.js";

// TIM-006 / TIM-008: the export's employee picker lists whom the caller may
// export (time.record.read scope), never gated on employee.read, per AGENTS §6
// (success, validation, 401, scope, cross-tenant, audit, rate limit).
const PERIOD = "startDate=2026-11-02&endDate=2026-11-04";
const PATH = `/v1/time/export/employees?${PERIOD}`;

describe("GET /v1/time/export/employees (TIM-006, TIM-008)", () => {
  let db: TestDatabase;
  let app: ReturnType<typeof createApp>;
  let a: ScopedOrgFixture;
  let b: ScopedOrgFixture;
  let people: FixturePerson[];
  let leaverId: string;
  let formerReportId: string;

  const get = (path: string, person?: FixturePerson, on = app) =>
    on.request(path, person ? { headers: as(person) } : {});

  const items = async (person: FixturePerson) => {
    const res = await get(PATH, person);
    expect(res.status).toBe(200);
    return ((await res.json()) as ExportEmployeesResponse).items;
  };

  // Employed in the period. Org A's peer left before it (see beforeAll).
  const employed = (org: ScopedOrgFixture) =>
    [
      org.admin,
      org.manager,
      org.report,
      org.auditor,
      ...(org === a ? [] : [org.peer]),
    ].map((p) => p.employeeId);

  // Owner connection (RLS bypassed): filter by organization explicitly.
  const pickerAudits = (orgId: string) =>
    db.sql<{ actorId: string; resourceType: string; metadata: unknown }[]>`
      SELECT actor_id::text AS "actorId", resource_type AS "resourceType", metadata
      FROM audit_log
      WHERE action = 'inspector.export_picker_access' AND organization_id = ${orgId}
      ORDER BY created_at`;

  const insertEmployee = async (
    orgId: string,
    firstName: string,
    lastName: string,
    managerId: string | null,
  ) => {
    const [row] = await db.sql<{ id: string }[]>`
      INSERT INTO employees (organization_id, manager_id, first_name, last_name, email)
      VALUES (${orgId}, ${managerId}, ${firstName}, ${lastName},
              ${`${lastName.toLowerCase()}-txe@fixture.invalid`})
      RETURNING id`;
    return row!.id;
  };

  const endEmployment = (orgId: string, employeeId: string) =>
    db.sql`
      INSERT INTO employments (organization_id, employee_id, job_title, start_date, end_date)
      VALUES (${orgId}, ${employeeId}, 'Employee', '2025-01-01', '2026-06-30')`;

  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database) throw new Error("Docker is required for this suite");
    db = database;
    await runMigrations(db.connectionString);
    a = await seedScopedOrg(db.sql, "txe-a");
    b = await seedScopedOrg(db.sql, "txe-b");
    // Left before the period: never part of an organization export.
    leaverId = await insertEmployee(a.orgId, "Former", "Leaver", null);
    await db.sql`
      UPDATE employees SET status = 'terminated', termination_date = '2026-01-31'
      WHERE id = ${leaverId}`;
    // A direct report of the manager whose employment ended before the period.
    formerReportId = await insertEmployee(
      a.orgId,
      "Former",
      "Report",
      a.manager.employeeId,
    );
    await endEmployment(a.orgId, formerReportId);
    // The peer (an employee caller) is not employed during the period.
    await endEmployment(a.orgId, a.peer.employeeId);
    people = [
      a.admin,
      a.manager,
      a.report,
      a.peer,
      a.auditor,
      b.admin,
      b.auditor,
    ];
    app = createApp({
      sql: await db.appSql(),
      authPort: fixtureAuthPort(people),
    });
  }, 90000);

  afterAll(async () => {
    if (db) await db.close();
  });

  it("lists every employee employed in the period for an admin, by name, id and name only", async () => {
    const list = await items(a.admin);
    const ids = list.map((e) => e.id);
    expect([...ids].sort()).toEqual(employed(a).sort());
    expect(ids).not.toContain(leaverId);
    expect(ids).not.toContain(formerReportId);
    const names = list.map((e) => e.name);
    expect(names).toEqual([...names].sort(EXPORT_EMPLOYEE_COLLATOR.compare));
    expect(names).toContain("Fixture report");
    for (const item of list) {
      expect(Object.keys(item).sort()).toEqual(["id", "name"]);
    }
  });

  it("lists the whole organization for an auditor without employee.read", async () => {
    const list = await items(a.auditor);
    expect(list.map((e) => e.id).sort()).toEqual(employed(a).sort());
    // The directory stays closed to the auditor.
    expect((await get("/v1/employees", a.auditor)).status).toBe(403);
  });

  it("lists only self and direct reports employed in the period for a manager", async () => {
    const ids = (await items(a.manager)).map((e) => e.id);
    expect(ids.sort()).toEqual(
      [a.manager.employeeId, a.report.employeeId].sort(),
    );
    expect(ids).not.toContain(formerReportId);
  });

  it("lists only the caller for an employee", async () => {
    expect((await items(a.report)).map((e) => e.id)).toEqual([
      a.report.employeeId,
    ]);
  });

  it("lists nobody for an employee not employed during the period", async () => {
    expect(await items(a.peer)).toEqual([]);
  });

  it("never lists another organization's employees", async () => {
    for (const person of [b.admin, b.auditor]) {
      const ids = (await items(person)).map((e) => e.id);
      expect(ids.sort()).toEqual(employed(b).sort());
      for (const id of [...employed(a), a.peer.employeeId]) {
        expect(ids).not.toContain(id);
      }
    }
  });

  it("audits each inspector listing once, with counts only (TIM-008)", async () => {
    const before = (await pickerAudits(a.orgId)).length;
    const list = await items(a.auditor);
    const after = await pickerAudits(a.orgId);
    expect(after).toHaveLength(before + 1);
    const entry = after.at(-1);
    expect(entry).toMatchObject({
      actorId: a.auditor.id,
      resourceType: "time_export",
      metadata: {
        periodStart: "2026-11-02",
        periodEnd: "2026-11-04",
        employeeCount: list.length,
      },
    });
    const metadata = JSON.stringify(entry?.metadata);
    expect(metadata).not.toContain("@");
    expect(metadata).not.toContain("Fixture");
    expect(Object.keys(entry?.metadata as object).sort()).toEqual([
      "employeeCount",
      "periodEnd",
      "periodStart",
    ]);
  });

  it("writes no picker audit entry for admins, managers or employees", async () => {
    const before = (await pickerAudits(a.orgId)).length;
    for (const person of [a.admin, a.manager, a.report]) await items(person);
    expect(await pickerAudits(a.orgId)).toHaveLength(before);
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

  it("rate-limits per user with a 429 problem, apart from the export", async () => {
    const limited = createApp({
      sql: await db.appSql(),
      authPort: fixtureAuthPort(people),
      timeExport: {
        rateLimit: { windowMs: 60_000, max: 1 },
        pickerRateLimit: { windowMs: 60_000, max: 2 },
      },
    });
    expect((await get(PATH, a.admin, limited)).status).toBe(200);
    expect((await get(PATH, a.admin, limited)).status).toBe(200);
    const res = await get(PATH, a.admin, limited);
    expect(res.status).toBe(429);
    expect(res.headers.get("content-type")).toContain(
      "application/problem+json",
    );
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await res.json()).toMatchObject({ code: "RATE_LIMIT_EXCEEDED" });
    // Another user keeps their own budget, and the export its own.
    expect((await get(PATH, a.auditor, limited)).status).toBe(200);
    expect(
      (
        await get(
          `/v1/time/export?${PERIOD}&scope=organization`,
          a.admin,
          limited,
        )
      ).status,
    ).not.toBe(429);
  });
});
