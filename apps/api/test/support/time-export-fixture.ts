import { expect } from "vitest";
import {
  getTestDatabase,
  seedScopedOrg,
  type FixturePerson,
  type ScopedOrgFixture,
  type TestDatabase,
} from "@librehr/testing";
import { runMigrations } from "@librehr/db/migrate";
import { TimeRepository, withTenant } from "@librehr/db";
import { createApp } from "../../src/app.js";
import {
  createTimeChainSigner,
  resolveTimeChainKey,
} from "../../src/lib/time-chain.js";
import { as, fixtureAuthPort } from "./fixture-app.js";

/** The exported period every TIM-006 export suite queries. */
export const PERIOD = "startDate=2026-11-02&endDate=2026-11-04";

export interface TimeExportFixture {
  db: TestDatabase;
  app: ReturnType<typeof createApp>;
  /** The exporting tenant: schedules, punches and a correction for its report. */
  a: ScopedOrgFixture;
  /** Another tenant, only used to prove isolation. */
  b: ScopedOrgFixture;
  get: (path: string, person?: FixturePerson) => Promise<Response>;
  exportAudits: () => Promise<
    { resourceId: string; resourceType: string; metadata: unknown }[]
  >;
}

/**
 * Seeds two tenants for the TIM-006 export suites: tenant `a` in
 * Europe/Madrid with an earlier leaver, weekday schedules for everyone but the
 * peer (left unconfigured on purpose), and the report's punches for the
 * period including one TIM-003 correction.
 */
export async function setupTimeExportFixture(
  slugPrefix: string,
): Promise<TimeExportFixture> {
  const sign = createTimeChainSigner(resolveTimeChainKey(undefined));
  const database = await getTestDatabase();
  if (!database) throw new Error("Docker is required for this suite");
  const db = database;
  await runMigrations(db.connectionString);
  const a = await seedScopedOrg(db.sql, `${slugPrefix}-a`);
  const b = await seedScopedOrg(db.sql, `${slugPrefix}-b`);
  await db.sql`UPDATE organizations SET timezone = 'Europe/Madrid' WHERE id = ${a.orgId}`;
  // Left before the period: never part of an organization export.
  await db.sql`
    INSERT INTO employees (organization_id, first_name, last_name, email, status, termination_date)
    VALUES (${a.orgId}, 'Former', 'Leaver', 'former@fixture.invalid', 'terminated', '2026-01-31')`;
  const app = createApp({
    sql: await db.appSql(),
    authPort: fixtureAuthPort([
      a.admin,
      a.manager,
      a.report,
      a.peer,
      a.auditor,
      b.admin,
    ]),
    // The rate limit has its own test (time-export-integrity.int.test.ts).
    timeExport: { rateLimit: { windowMs: 60_000, max: 1000 } },
  });

  const assignSchedule = async (employeeId: string) => {
    const rules = Array.from({ length: 7 }, (_, i) => ({
      dayOfWeek: i + 1,
      expectedHours: i < 5 ? 8 : 0,
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

  // The peer stays unconfigured on purpose.
  for (const person of [a.admin, a.manager, a.report, a.auditor]) {
    await assignSchedule(person.employeeId);
  }
  await withTenant(
    db.sql,
    { organizationId: a.orgId, userId: a.report.id },
    async (tx) => {
      const repo = new TimeRepository();
      const punch = (eventType: "clock_in" | "clock_out", at: string) =>
        repo.appendEvent(tx, sign, {
          organizationId: a.orgId,
          employeeId: a.report.employeeId,
          eventType,
          occurredAt: new Date(at),
          source: "web",
          actorId: a.report.id,
        });
      await punch("clock_in", "2026-11-02T08:00:00Z");
      await punch("clock_out", "2026-11-02T16:00:00Z");
      await punch("clock_in", "2026-11-03T08:00:00Z");
      const out = await punch("clock_out", "2026-11-03T15:00:00Z");
      // TIM-003: a correction is a new event referencing the original.
      await repo.appendEvent(tx, sign, {
        organizationId: a.orgId,
        employeeId: a.report.employeeId,
        eventType: "clock_out",
        occurredAt: new Date("2026-11-03T16:00:00Z"),
        source: "manual",
        actorId: a.manager.id,
        refEventId: out.id,
        reason: "Forgot to clock out",
      });
    },
  );

  return {
    db,
    app,
    a,
    b,
    get: async (path, person) =>
      app.request(path, person ? { headers: as(person) } : {}),
    exportAudits: () =>
      withTenant(
        db.sql,
        { organizationId: a.orgId },
        (tx) => tx<
          { resourceId: string; resourceType: string; metadata: unknown }[]
        >`
          SELECT resource_id::text AS "resourceId", resource_type AS "resourceType", metadata
          FROM audit_log WHERE action = 'time.export' ORDER BY created_at`,
      ),
  };
}
