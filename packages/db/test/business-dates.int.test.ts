import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDatabase, type TestDatabase } from "@librehr/testing";
import { runMigrations } from "../src/migrate.js";
import { withTenant, type TenantTx } from "../src/with-tenant.js";
import { EmployeeRepository } from "../src/repositories/employee.repository.js";
import { LocationRepository } from "../src/repositories/location.repository.js";
import { OrganizationRepository } from "../src/repositories/org.repository.js";
import { ScheduleRepository } from "../src/repositories/schedule.repository.js";

/** Wraps a transaction so every SQL statement it runs is counted. */
function countingTx(tx: TenantTx): { tx: TenantTx; count: () => number } {
  let calls = 0;
  const proxy = new Proxy(tx, {
    apply(target, thisArg, args) {
      calls++;
      return Reflect.apply(target, thisArg, args) as unknown;
    },
  });
  return { tx: proxy, count: () => calls };
}

function localDate(timeZone: string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

describe("business dates follow the organization or location time zone", () => {
  let db: TestDatabase;
  const orgId = "b0000000-0000-0000-0000-0000000000d1";
  const employees = new EmployeeRepository();
  const locations = new LocationRepository();
  const orgs = new OrganizationRepository();
  const schedules = new ScheduleRepository();

  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database)
      throw new Error("Docker is required for business-date tests");
    db = database;
    await runMigrations(db.connectionString);
    await db.sql`INSERT INTO organizations (id, name, slug, timezone) VALUES (${orgId}, 'Zone Corp', 'zone-corp', 'Europe/Madrid')`;
  });

  afterAll(async () => {
    if (db) await db.close();
  });

  it("resolves the location zone, falling back to the organization zone", async () => {
    await withTenant(db.sql, { organizationId: orgId }, async (tx) => {
      const canary = await locations.create(tx, {
        name: "Las Palmas",
        city: "Las Palmas",
        region: "CN",
        timezone: "Atlantic/Canary",
      });
      expect(await orgs.getBusinessTimeZone(tx)).toBe("Europe/Madrid");
      expect(await orgs.getBusinessTimeZone(tx, canary.id)).toBe(
        "Atlantic/Canary",
      );
      // An unknown location id does not leak another zone.
      expect(
        await orgs.getBusinessTimeZone(
          tx,
          "00000000-0000-0000-0000-00000000dead",
        ),
      ).toBe("Europe/Madrid");
    });
  });

  it("defaults an employment start date to today in the location zone", async () => {
    // UTC+14: its calendar date differs from the UTC date for ten hours a day.
    const zone = "Pacific/Kiritimati";
    await withTenant(db.sql, { organizationId: orgId }, async (tx) => {
      const far = await locations.create(tx, {
        name: "Far east",
        city: "Kiritimati",
        timezone: zone,
      });
      const before = localDate(zone);
      const emp = await employees.create(tx, {
        firstName: "Zone",
        lastName: "Tester",
        email: "zone.tester@zone.test",
        locationId: far.id,
        jobTitle: "Engineer",
      });
      const after = localDate(zone);
      const rows = await tx<{ startDate: string }[]>`
        SELECT start_date::text AS "startDate" FROM employments WHERE employee_id = ${emp.id}
      `;
      expect([before, after]).toContain(rows[0]?.startDate);
    });
  });

  it("fetches every schedule span for a period in a single query", async () => {
    await withTenant(db.sql, { organizationId: orgId }, async (tx) => {
      const emp = await employees.create(tx, {
        firstName: "Span",
        lastName: "Tester",
        email: "span.tester@zone.test",
      });
      const defaults = await tx<{ id: string }[]>`
        INSERT INTO schedules (name, type, weekly_hours, is_default)
        VALUES ('Default', 'fixed', 40, true) RETURNING id
      `;
      const defaultId = defaults[0]!.id;
      await tx`INSERT INTO schedule_rules (schedule_id, day_of_week, expected_hours) VALUES (${defaultId}, 1, 8), (${defaultId}, 7, 0)`;
      const assigned = await schedules.createAssignment(tx, {
        employeeId: emp.id,
        name: "Part time",
        effectiveFrom: "2026-03-29",
        minimumDailyRestHours: 12,
        rules: [
          { dayOfWeek: 1, expectedHours: 4, breakMinutes: 0 },
          { dayOfWeek: 7, expectedHours: 2, breakMinutes: 0 },
        ],
      });
      if (typeof assigned === "string") throw new Error(assigned);

      const counted = countingTx(tx);
      const spans = await schedules.getScheduleSpansForEmployee(
        counted.tx,
        emp.id,
        "2026-03-23",
        "2026-04-05",
      );
      expect(counted.count()).toBe(1);
      expect(spans).toEqual([
        {
          scheduleId: assigned.id,
          isDefault: false,
          effectiveFrom: "2026-03-29",
          effectiveTo: null,
          rules: [
            { dayOfWeek: 1, expectedHours: 4 },
            { dayOfWeek: 7, expectedHours: 2 },
          ],
        },
        {
          scheduleId: defaultId,
          isDefault: true,
          effectiveFrom: null,
          effectiveTo: null,
          rules: [
            { dayOfWeek: 1, expectedHours: 8 },
            { dayOfWeek: 7, expectedHours: 0 },
          ],
        },
      ]);

      // A period ending before the assignment only sees the default.
      const earlier = await schedules.getScheduleSpansForEmployee(
        tx,
        emp.id,
        "2026-03-01",
        "2026-03-28",
      );
      expect(earlier.map((s) => s.isDefault)).toEqual([true]);
    });
  });
});
