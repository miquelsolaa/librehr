import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  getTestDatabase,
  seedScopedOrg,
  type FixturePerson,
  type ScopedOrgFixture,
  type TestDatabase,
} from "@librehr/testing";
import { runMigrations } from "@librehr/db/migrate";
import { withTenant } from "@librehr/db";
import { createApp } from "../src/app.js";
import { as, fixtureAuthPort } from "./support/fixture-app.js";

// TIM-008: the auditor reads timesheets and time banks through the same
// permission + scope policy as everyone else (organization-scope
// time.record.read), and each timesheet access is logged without PII.
const PERIOD = "startDate=2026-11-02&endDate=2026-11-04";

describe("auditor access to time records (TIM-008, ADM-002)", () => {
  let db: TestDatabase;
  let app: ReturnType<typeof createApp>;
  let a: ScopedOrgFixture;
  let b: ScopedOrgFixture;

  const get = (path: string, person: FixturePerson) =>
    app.request(path, { headers: as(person) });

  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database) throw new Error("Docker is required for this suite");
    db = database;
    await runMigrations(db.connectionString);
    a = await seedScopedOrg(db.sql, "aud-a");
    b = await seedScopedOrg(db.sql, "aud-b");
    app = createApp({
      sql: await db.appSql(),
      authPort: fixtureAuthPort([a.admin, a.auditor, a.peer, b.auditor]),
    });
    const res = await app.request("/v1/schedules/assignments", {
      method: "POST",
      headers: as(a.admin, true),
      body: JSON.stringify({
        employeeId: a.peer.employeeId,
        name: "Office",
        effectiveFrom: "2026-01-01",
        minimumDailyRestHours: 12,
        rules: Array.from({ length: 7 }, (_, i) => ({
          dayOfWeek: i + 1,
          expectedHours: i < 5 ? 8 : 0,
          breakMinutes: 0,
        })),
      }),
    });
    expect(res.status).toBe(201);
  }, 90000);

  afterAll(async () => {
    if (db) await db.close();
  });

  it("reads another employee's timesheet and logs the access without the auditor's email", async () => {
    const res = await get(
      `/v1/time/timesheet?${PERIOD}&employeeId=${a.peer.employeeId}`,
      a.auditor,
    );
    expect(res.status).toBe(200);

    const rows = await withTenant(
      db.sql,
      { organizationId: a.orgId },
      (tx) => tx<{ actorId: string; resourceId: string; metadata: unknown }[]>`
        SELECT actor_id::text AS "actorId", resource_id::text AS "resourceId", metadata
        FROM audit_log WHERE action = 'inspector.timesheet_access'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorId: a.auditor.id,
      resourceId: a.peer.employeeId,
      metadata: { periodStart: "2026-11-02", periodEnd: "2026-11-04" },
    });
    expect(JSON.stringify(rows[0]?.metadata)).not.toContain("@");
  });

  it("reads another employee's time bank", async () => {
    const res = await get(
      `/v1/time/time-bank?employeeId=${a.peer.employeeId}`,
      a.auditor,
    );
    expect(res.status).toBe(200);
  });

  it("never reaches another organization's employees", async () => {
    for (const path of [
      `/v1/time/timesheet?${PERIOD}&employeeId=${a.peer.employeeId}`,
      `/v1/time/time-bank?employeeId=${a.peer.employeeId}`,
    ]) {
      const res = await get(path, b.auditor);
      expect(res.status).toBe(404);
    }
  });
});
