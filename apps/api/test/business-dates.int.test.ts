import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  getTestDatabase,
  seedScopedOrg,
  type ScopedOrgFixture,
  type TestDatabase,
} from "@librehr/testing";
import { runMigrations } from "@librehr/db/migrate";
import { LeaveRepository, withTenant } from "@librehr/db";
import { createApp } from "../src/app.js";
import { as, fixtureAuthPort } from "./support/fixture-app.js";

// Business dates follow the organization's or location's time zone, never the
// UTC date (AGENTS.md section 5; LEA-005 ledger, TIM-004/TIM-005 timesheets).
describe("business dates in the organization and location time zone", () => {
  let db: TestDatabase;
  let app: ReturnType<typeof createApp>;
  let a: ScopedOrgFixture;
  const leave = new LeaveRepository();

  /** Pins only `Date`, so database and HTTP timers keep running. */
  const freezeAt = (iso: string) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(iso));
  };

  const ledgerDate = async (entryId: string) => {
    const rows = await db.sql<{ effectiveDate: string }[]>`
      SELECT effective_date::text AS "effectiveDate" FROM leave_ledger WHERE id = ${entryId}
    `;
    return rows[0]?.effectiveDate;
  };

  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database) throw new Error("Docker is required for this suite");
    db = database;
    await runMigrations(db.connectionString);
    a = await seedScopedOrg(db.sql, "biz-dates");
    await db.sql`UPDATE organizations SET timezone = 'Europe/Madrid' WHERE id = ${a.orgId}`;
    // The peer works at a Canary Islands location (one hour behind Madrid).
    const loc = await db.sql<{ id: string }[]>`
      INSERT INTO locations (organization_id, name, city, region, timezone)
      VALUES (${a.orgId}, 'Las Palmas', 'Las Palmas', 'CN', 'Atlantic/Canary')
      RETURNING id
    `;
    await db.sql`UPDATE employees SET location_id = ${loc[0]!.id} WHERE id = ${a.peer.employeeId}`;
    app = createApp({
      sql: await db.appSql(),
      authPort: fixtureAuthPort([a.admin, a.manager, a.report, a.peer]),
    });
  }, 60000);

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(async () => {
    if (db) await db.close();
  });

  it("dates a cancellation reversal at 23:30 UTC on 31 December as 1 January in Madrid", async () => {
    const requestId = await withTenant(
      db.sql,
      { organizationId: a.orgId },
      async (tx) => {
        const type = await leave.createLeaveType(tx, {
          name: "Vacation",
          code: "vacation",
          isPaid: true,
          requiresApproval: true,
        });
        const req = await leave.createLeaveRequest(tx, {
          employeeId: a.report.employeeId,
          leaveTypeId: type.id,
          startDate: "2027-02-01",
          endDate: "2027-02-02",
          workingDays: 2,
        });
        await leave.approveLeaveRequest(tx, req.id, a.manager.employeeId);
        return req.id;
      },
    );

    freezeAt("2026-12-31T23:30:00Z");
    const res = await app.request(`/v1/leave/requests/${requestId}/cancel`, {
      method: "POST",
      headers: as(a.report, true),
    });
    expect(res.status).toBe(200);
    const rows = await db.sql<{ reversal: string }[]>`
      SELECT reversal_ledger_entry_id::text AS reversal FROM leave_requests WHERE id = ${requestId}
    `;
    expect(await ledgerDate(rows[0]!.reversal)).toBe("2027-01-01");
  });

  it("dates an undated balance adjustment in the employee's location zone", async () => {
    freezeAt("2026-12-31T23:30:00Z");
    const adjust = async (employeeId: string) => {
      const res = await app.request("/v1/leave/adjust", {
        method: "POST",
        headers: as(a.admin, true),
        body: JSON.stringify({ employeeId, amount: 1, note: "Year-end fix" }),
      });
      expect(res.status).toBe(201);
      return ((await res.json()) as { id: string }).id;
    };
    // Madrid (organization zone) is already in 2027; the Canaries are not.
    expect(await ledgerDate(await adjust(a.report.employeeId))).toBe(
      "2027-01-01",
    );
    expect(await ledgerDate(await adjust(a.peer.employeeId))).toBe(
      "2026-12-31",
    );
  });

  it("sums a timesheet across the March DST change by local days", async () => {
    await withTenant(db.sql, { organizationId: a.orgId }, async (tx) => {
      const rows = await tx<{ id: string }[]>`
        INSERT INTO schedules (name, type, weekly_hours, is_default)
        VALUES ('Default', 'fixed', 56, true) RETURNING id
      `;
      for (let day = 1; day <= 7; day++) {
        await tx`INSERT INTO schedule_rules (schedule_id, day_of_week, expected_hours) VALUES (${rows[0]!.id}, ${day}, 8)`;
      }
      // 09:00-17:00 Madrid time, Fri 27 to Mon 30 March 2026; clocks go
      // forward on Sunday 29 at 02:00, so the UTC offset changes mid-period.
      const shifts = [
        ["2026-03-27T08:00:00Z", "2026-03-27T16:00:00Z"],
        ["2026-03-28T08:00:00Z", "2026-03-28T16:00:00Z"],
        ["2026-03-29T07:00:00Z", "2026-03-29T15:00:00Z"],
        ["2026-03-30T07:00:00Z", "2026-03-30T15:00:00Z"],
      ];
      for (const [i, [start, end]] of shifts.entries()) {
        // time_events accepts only chained v2 rows (0025); the timesheet
        // does not verify hashes, so placeholder hashes with a seq suffice.
        await tx`INSERT INTO time_events (employee_id, event_type, occurred_at, recorded_at, source, actor_id, hash, seq) VALUES (${a.report.employeeId}, 'clock_in', ${start!}, ${start!}, 'web', ${a.report.id}, ${`dst-in-${i}`}, ${2 * i + 1}), (${a.report.employeeId}, 'clock_out', ${end!}, ${end!}, 'web', ${a.report.id}, ${`dst-out-${i}`}, ${2 * i + 2})`;
      }
    });

    const res = await app.request(
      "/v1/time/timesheet?startDate=2026-03-27&endDate=2026-03-30",
      { headers: as(a.report) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      days: { date: string; dayOfWeek: number; totalWorkedMinutes: number }[];
      totalWorkedMinutes: number;
      totalExpectedHours: number;
      totalOvertimeMinutes: number;
    };
    expect(
      body.days.map((d) => [d.date, d.dayOfWeek, d.totalWorkedMinutes]),
    ).toEqual([
      ["2026-03-27", 5, 480],
      ["2026-03-28", 6, 480],
      ["2026-03-29", 7, 480],
      ["2026-03-30", 1, 480],
    ]);
    expect(body.totalWorkedMinutes).toBe(1920);
    expect(body.totalExpectedHours).toBe(32);
    expect(body.totalOvertimeMinutes).toBe(0);
  });
});
