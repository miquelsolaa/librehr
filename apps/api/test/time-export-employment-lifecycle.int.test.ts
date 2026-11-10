import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ScopedOrgFixture } from "@librehr/testing";
import type { OfficialExportResponse } from "@librehr/contracts";
import { as } from "./support/fixture-app.js";
import {
  PERIOD,
  setupTimeExportFixture,
  type TimeExportFixture,
} from "./support/time-export-fixture.js";

// TIM-006 employment days across the employee lifecycle: a termination
// through the real EMP-007 route, a re-hire with a gap, tenant isolation, and
// the timesheet endpoint, which does not apply employment days.
const EMPLOYED = 11;
const EXPECTED = 5;

describe("GET /v1/time/export employment lifecycle (TIM-006)", () => {
  let fx: TimeExportFixture;
  let a: ScopedOrgFixture;
  let b: ScopedOrgFixture;
  let terminatedId: string;
  let rehiredId: string;
  let otherTenantFormerId: string;
  let formerId: string;

  const insertEmployee = async (orgId: string, lastName: string) => {
    const [row] = await fx.db.sql<{ id: string }[]>`
      INSERT INTO employees (organization_id, first_name, last_name, email)
      VALUES (${orgId}, 'Fixture', ${lastName},
              ${`${lastName.toLowerCase()}-txlife@fixture.invalid`})
      RETURNING id`;
    return row!.id;
  };
  const employment = (
    orgId: string,
    employeeId: string,
    start: string,
    end: string | null,
  ) =>
    fx.db.sql`
      INSERT INTO employments (organization_id, employee_id, job_title, start_date, end_date)
      VALUES (${orgId}, ${employeeId}, 'Employee', ${start}, ${end})`;
  const post = (path: string, body: unknown) =>
    fx.app.request(path, {
      method: "POST",
      headers: as(a.admin, true),
      body: JSON.stringify(body),
    });
  const assignSchedule = async (employeeId: string) => {
    const res = await post("/v1/schedules/assignments", {
      employeeId,
      name: "Office",
      effectiveFrom: "2026-01-01",
      minimumDailyRestHours: 12,
      rules: Array.from({ length: 7 }, (_, i) => ({
        dayOfWeek: i + 1,
        expectedHours: 8,
        breakMinutes: 0,
      })),
    });
    expect(res.status).toBe(201);
  };
  const exportOf = async (employeeId: string) => {
    const res = await fx.get(
      `/v1/time/export?${PERIOD}&employeeId=${employeeId}&locale=en`,
      a.admin,
    );
    expect(res.status).toBe(200);
    return (await res.json()) as OfficialExportResponse;
  };

  beforeAll(async () => {
    fx = await setupTimeExportFixture("txlife");
    a = fx.a;
    b = fx.b;
    // Hired long ago with an open employment row, then offboarded mid-period
    // through the real route (which leaves the row open).
    terminatedId = await insertEmployee(a.orgId, "Offboarded");
    await employment(a.orgId, terminatedId, "2025-01-01", null);
    await assignSchedule(terminatedId);
    const res = await post(`/v1/employees/${terminatedId}/terminate`, {
      terminationDate: "2026-11-03",
      terminationReason: "voluntary_resignation",
    });
    expect(res.status).toBe(200);
    // Left on the first day of the period, re-hired on the last.
    rehiredId = await insertEmployee(a.orgId, "Rehired");
    await employment(a.orgId, rehiredId, "2025-01-01", "2026-11-02");
    await employment(a.orgId, rehiredId, "2026-11-04", null);
    await assignSchedule(rehiredId);
    // A former employee without any schedule, for the timesheet regression.
    formerId = await insertEmployee(a.orgId, "Former");
    await employment(a.orgId, formerId, "2025-01-01", "2026-06-30");
    // Another tenant's former employee.
    otherTenantFormerId = await insertEmployee(b.orgId, "Elsewhere");
    await employment(b.orgId, otherTenantFormerId, "2025-01-01", "2026-06-30");
  }, 90000);

  afterAll(async () => {
    if (fx) await fx.db.close();
  });

  it("stops expecting work after a termination made through the API", async () => {
    const doc = await exportOf(terminatedId);
    expect(doc.rowsEmployed).toEqual([true, true, false]);
    expect(doc.rows.map((cells) => cells[EXPECTED])).toEqual([
      "480",
      "480",
      "0",
    ]);
    expect(doc.rows.map((cells) => cells[EMPLOYED])).toEqual([
      "Yes",
      "Yes",
      "No",
    ]);
  });

  it("flags only the gap of a re-hire inside the period", async () => {
    const doc = await exportOf(rehiredId);
    expect(doc.rowsEmployed).toEqual([true, false, true]);
    expect(doc.employees[0]).toMatchObject({
      totalWorkedMinutes: 0,
      totalOvertimeMinutes: -960,
    });
  });

  it("answers 404 for another organization's former employee", async () => {
    const res = await fx.get(
      `/v1/time/export?${PERIOD}&employeeId=${otherTenantFormerId}`,
      a.admin,
    );
    expect(res.status).toBe(404);
    const body = JSON.stringify(await res.json());
    expect(body).not.toContain("Elsewhere");
  });

  it("keeps /v1/time/timesheet unaware of employment days (409 without a schedule)", async () => {
    const res = await fx.get(
      `/v1/time/timesheet?${PERIOD}&employeeId=${formerId}`,
      a.admin,
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "SCHEDULE_NOT_CONFIGURED" });
    // The export of the same employee is not a 409: every day is flagged.
    expect((await exportOf(formerId)).rowsEmployed).toEqual([
      false,
      false,
      false,
    ]);
  });
});
