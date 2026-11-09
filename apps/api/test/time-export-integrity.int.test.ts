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
import { TimeRepository, withTenant } from "@librehr/db";
import type { OfficialExportResponse } from "@librehr/contracts";
import { createApp } from "../src/app.js";
import {
  createTimeChainSigner,
  resolveTimeChainKey,
} from "../src/lib/time-chain.js";
import { verifyEmployeeChain } from "../src/lib/time-export-chain.js";
import { as, fixtureAuthPort } from "./support/fixture-app.js";

// TIM-006 export: per-employee time zones, DST and period edges, bounded
// event reads with corrections and the paged chain check. Limits, tenant
// isolation and refusals are in time-export-limits.int.test.ts.
const key = resolveTimeChainKey(undefined);
const sign = createTimeChainSigner(key);
const NOV = "startDate=2026-11-02&endDate=2026-11-02";
type Punch = "clock_in" | "clock_out";

describe("GET /v1/time/export integrity (TIM-006)", () => {
  let db: TestDatabase;
  let app: ReturnType<typeof createApp>;
  let a: ScopedOrgFixture;
  let dst: FixturePerson;
  let fixer: FixturePerson;

  const get = (path: string, person: FixturePerson, on = app) =>
    on.request(path, { headers: as(person) });
  const json = async (res: Response) =>
    (await res.json()) as OfficialExportResponse;

  const addEmployee = async (label: string): Promise<FixturePerson> => {
    const id = randomUUID();
    const employeeId = randomUUID();
    const email = `${label}-${id.slice(0, 8)}@fixture.invalid`;
    await db.sql`INSERT INTO users (id, email, name) VALUES (${id}, ${email}, ${`Fixture ${label}`})`;
    await db.sql`INSERT INTO memberships (organization_id, user_id, role) VALUES (${a.orgId}, ${id}, 'employee')`;
    await db.sql`
      INSERT INTO employees (id, organization_id, user_id, first_name, last_name, email)
      VALUES (${employeeId}, ${a.orgId}, ${id}, 'Fixture', ${label}, ${email})`;
    return {
      id,
      email,
      name: `Fixture ${label}`,
      role: "employee",
      organizationId: a.orgId,
      employeeId,
    };
  };

  const assignSchedule = async (employeeId: string) => {
    const rules = Array.from({ length: 7 }, (_, i) => ({
      dayOfWeek: i + 1,
      expectedHours: 8,
      breakMinutes: 0,
    }));
    const res = await app.request("/v1/schedules/assignments", {
      method: "POST",
      headers: as(a.admin, true),
      body: JSON.stringify({
        employeeId,
        name: "Office",
        effectiveFrom: "2026-01-01",
        minimumDailyRestHours: 12,
        rules,
      }),
    });
    expect(res.status).toBe(201);
  };

  const punch = (
    employeeId: string,
    eventType: Punch,
    at: string,
    refEventId?: string,
  ) =>
    withTenant(db.sql, { organizationId: a.orgId, userId: a.admin.id }, (tx) =>
      new TimeRepository().appendEvent(tx, sign, {
        organizationId: a.orgId,
        employeeId,
        eventType,
        occurredAt: new Date(at),
        source: refEventId ? "manual" : "web",
        actorId: a.admin.id,
        ...(refEventId ? { refEventId, reason: "Wrong time" } : {}),
      }),
    );

  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database) throw new Error("Docker is required for this suite");
    db = database;
    await runMigrations(db.connectionString);
    a = await seedScopedOrg(db.sql, "txi-a");
    await db.sql`UPDATE organizations SET timezone = 'Europe/Madrid' WHERE id = ${a.orgId}`;
    const [canary] = await db.sql<{ id: string }[]>`
      INSERT INTO locations (organization_id, name, city, timezone)
      VALUES (${a.orgId}, 'Las Palmas', 'Las Palmas', 'Atlantic/Canary')
      RETURNING id`;
    await db.sql`UPDATE employees SET location_id = ${canary!.id} WHERE id = ${a.report.employeeId}`;
    dst = await addEmployee("dst");
    fixer = await addEmployee("fixer");
    app = createApp({
      sql: await db.appSql(),
      authPort: fixtureAuthPort([a.admin, a.manager, a.report, a.auditor]),
      timeExport: { rateLimit: { windowMs: 60_000, max: 1000 } },
    });
    for (const p of [a.admin, a.manager, a.report, a.auditor, dst, fixer]) {
      await assignSchedule(p.employeeId);
    }
    // Same instants for a Madrid and a Canary employee.
    for (const p of [a.admin, a.report]) {
      await punch(p.employeeId, "clock_in", "2026-11-02T08:00:00Z");
      await punch(p.employeeId, "clock_out", "2026-11-02T16:00:00Z");
    }
  }, 120000);

  afterAll(async () => {
    if (db) await db.close();
  });

  it("shows each employee in their own zone, identically in both scopes", async () => {
    const one = await json(
      await get(
        `/v1/time/export?${NOV}&employeeId=${a.report.employeeId}&locale=en`,
        a.admin,
      ),
    );
    expect(one.timeZone).toBe("Europe/Madrid");
    expect(one.employees[0]?.timeZone).toBe("Atlantic/Canary");
    expect(one.rows).toEqual([
      [
        "Fixture report",
        "2026-11-02",
        "08:00-16:00",
        "0",
        "480",
        "480",
        "0",
        "No",
        "No",
        "Verified",
        "Atlantic/Canary",
      ],
    ]);

    const org = await json(
      await get(`/v1/time/export?${NOV}&scope=organization&locale=en`, a.admin),
    );
    expect(org.timeZone).toBe("Europe/Madrid");
    expect(org.rows.filter((r) => r[0] === "Fixture report")).toEqual(one.rows);
    const admin = org.rows.find((r) => r[0] === "Fixture admin");
    expect([admin?.[2], admin?.[10]]).toEqual(["09:00-17:00", "Europe/Madrid"]);
    expect(
      org.employees.find((e) => e.employeeId === a.report.employeeId)?.timeZone,
    ).toBe("Atlantic/Canary");
  });

  it("splits a DST period at local midnights, edges inclusive", async () => {
    // Night shifts crossing the period's first and last midnight (CEST, then
    // CET) and one across the fall-back hour itself.
    await punch(dst.employeeId, "clock_in", "2026-10-23T20:00:00Z");
    await punch(dst.employeeId, "clock_out", "2026-10-24T00:00:00Z");
    await punch(dst.employeeId, "clock_in", "2026-10-25T00:30:00Z");
    await punch(dst.employeeId, "clock_out", "2026-10-25T01:30:00Z");
    await punch(dst.employeeId, "clock_in", "2026-10-26T21:00:00Z");
    await punch(dst.employeeId, "clock_out", "2026-10-27T01:00:00Z");
    const doc = await json(
      await get(
        `/v1/time/export?startDate=2026-10-24&endDate=2026-10-26&employeeId=${dst.employeeId}`,
        a.admin,
      ),
    );
    expect(doc.rows.map((r) => [r[1], r[2], r[4]])).toEqual([
      ["2026-10-24", "00:00-02:00", "120"],
      ["2026-10-25", "02:30-02:30", "60"],
      ["2026-10-26", "22:00-00:00", "120"],
    ]);
    expect(doc.employees[0]?.totalWorkedMinutes).toBe(300);
  });

  it("applies a correction whose original lies outside the loaded window", async () => {
    // The original clock-out was punched on the 14th, outside the window of
    // the 16th (15th to 17th); its correction moves it to the 16th.
    await punch(fixer.employeeId, "clock_in", "2026-11-16T08:00:00Z");
    const wrong = await punch(
      fixer.employeeId,
      "clock_out",
      "2026-11-14T16:00:00Z",
    );
    await punch(
      fixer.employeeId,
      "clock_out",
      "2026-11-16T15:00:00Z",
      wrong.id,
    );
    const res = await get(
      `/v1/time/export?startDate=2026-11-16&endDate=2026-11-16&employeeId=${fixer.employeeId}&locale=en`,
      a.admin,
    );
    expect(res.status).toBe(200);
    const doc = await json(res);
    expect(doc.rows.map((r) => [r[2], r[4], r[8], r[9]])).toEqual([
      ["09:00-16:00", "420", "Yes", "Verified"],
    ]);
  });

  it("verifies the same chain page by page as in one page", async () => {
    const status = (pageSize: number) =>
      withTenant(db.sql, { organizationId: a.orgId }, (tx) =>
        verifyEmployeeChain(tx, key, dst.employeeId, pageSize),
      );
    expect(await status(2)).toBe("verified");
    expect(await status(1000)).toBe("verified");
  });
});
