import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  getTestDatabase,
  seedScopedOrg,
  type FixturePerson,
  type ScopedOrgFixture,
  type TestDatabase,
} from "@librehr/testing";
import { runMigrations } from "@librehr/db/migrate";
import type {
  CloseTimesheetPeriodResponse,
  PeriodTimesheetResponse,
  TimeCorrectionItem,
  TimesheetClosureItem,
  TimesheetClosuresResponse,
} from "@librehr/contracts";
import { createApp } from "../src/app.js";
import { as, fixtureAuthPort } from "./support/fixture-app.js";

// TIM-004 (#31): monthly closure snapshots totals; corrections after a close
// are flagged in the timesheet, never blocked. AGENTS §6: success,
// validation, 401, 403, cross-tenant, audit.
const MONTH = "2026-01";
const JANUARY = "startDate=2026-01-01&endDate=2026-01-31";

describe("timesheet closures (TIM-004)", () => {
  let db: TestDatabase;
  let app: ReturnType<typeof createApp>;
  let a: ScopedOrgFixture;
  let b: ScopedOrgFixture;
  let firstClosedAt: string;

  const post = (path: string, person: FixturePerson | null, body: unknown) =>
    app.request(path, {
      method: "POST",
      headers: person
        ? as(person, true)
        : { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  const get = (path: string, person: FixturePerson) =>
    app.request(path, { headers: as(person) });

  const close = async (
    person: FixturePerson,
    body: unknown = { month: MONTH },
  ) => {
    const res = await post("/v1/time/closures", person, body);
    expect(res.status).toBe(200);
    return (await res.json()) as CloseTimesheetPeriodResponse;
  };
  const resultFor = (body: CloseTimesheetPeriodResponse, employeeId: string) =>
    body.results.find((r) => r.employeeId === employeeId);

  const timesheet = async (person: FixturePerson, range = JANUARY) => {
    const res = await get(`/v1/time/timesheet?${range}`, person);
    expect(res.status).toBe(200);
    return (await res.json()) as PeriodTimesheetResponse;
  };

  // The peer proposes, the admin approves: the approval appends a time event.
  const approvedCorrection = async (
    proposedEventType: "clock_in" | "clock_out",
    proposedOccurredAt: string,
  ) => {
    const created = await post("/v1/time/corrections", a.peer, {
      proposedEventType,
      proposedOccurredAt,
      reason: "Forgot to clock",
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as TimeCorrectionItem;
    const decided = await post(`/v1/time/corrections/${id}/decide`, a.admin, {
      decision: "approve",
    });
    expect(decided.status).toBe(200);
    const item = (await decided.json()) as TimeCorrectionItem;
    return item.createdEventId!;
  };

  // Owner connection (RLS bypassed): filter by organization explicitly.
  const audits = (orgId: string, action: string) =>
    db.sql<{ actorId: string; resourceId: string; metadata: unknown }[]>`
      SELECT actor_id::text AS "actorId", resource_id::text AS "resourceId", metadata
      FROM audit_log
      WHERE action = ${action} AND organization_id = ${orgId}
      ORDER BY created_at`;
  const closureRows = (employeeId: string) =>
    db.sql<{ action: string }[]>`
      SELECT action FROM timesheet_closures
      WHERE employee_id = ${employeeId} ORDER BY created_at`;

  const assignSchedule = async (person: FixturePerson) => {
    const res = await post("/v1/schedules/assignments", a.admin, {
      employeeId: person.employeeId,
      name: "Office",
      effectiveFrom: "2025-01-01",
      minimumDailyRestHours: 12,
      rules: Array.from({ length: 7 }, (_, i) => ({
        dayOfWeek: i + 1,
        expectedHours: i < 5 ? 8 : 0,
        breakMinutes: 0,
      })),
    });
    expect(res.status).toBe(201);
  };

  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database) throw new Error("Docker is required for this suite");
    db = database;
    await runMigrations(db.connectionString);
    a = await seedScopedOrg(db.sql, "tcl-a");
    b = await seedScopedOrg(db.sql, "tcl-b");
    app = createApp({
      sql: await db.appSql(),
      authPort: fixtureAuthPort([
        a.admin,
        a.manager,
        a.report,
        a.peer,
        a.auditor,
        b.admin,
        b.peer,
      ]),
    });
    await assignSchedule(a.peer);
    await assignSchedule(a.report);
    // 8 hours on Monday 5 January, recorded before the close.
    await approvedCorrection("clock_in", "2026-01-05T08:00:00.000Z");
    await approvedCorrection("clock_out", "2026-01-05T16:00:00.000Z");
  }, 90000);

  afterAll(async () => {
    if (db) await db.close();
  });

  it("requires authentication", async () => {
    expect(
      (await post("/v1/time/closures", null, { month: MONTH })).status,
    ).toBe(401);
    expect(
      (
        await post("/v1/time/closures/reopen", null, {
          month: MONTH,
          employeeId: a.peer.employeeId,
          reason: "Wrong totals",
        })
      ).status,
    ).toBe(401);
    expect((await app.request(`/v1/time/closures?month=${MONTH}`)).status).toBe(
      401,
    );
  });

  it("rejects invalid input with 400", async () => {
    for (const body of [
      { month: "2026-13" },
      { month: "2026-1" },
      {},
      { month: MONTH, employeeIds: ["not-a-uuid"] },
      { month: MONTH, employeeIds: [] },
      "{not json",
    ]) {
      expect((await post("/v1/time/closures", a.admin, body)).status).toBe(400);
    }
    expect((await get("/v1/time/closures", a.admin)).status).toBe(400);
    expect((await get("/v1/time/closures?month=jan", a.admin)).status).toBe(
      400,
    );
  });

  it("refuses a month that has not started yet", async () => {
    const res = await post("/v1/time/closures", a.admin, { month: "2999-01" });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { code: string }).code).toBe(
      "PERIOD_IN_FUTURE",
    );
  });

  it("forbids managers, employees and auditors (time.period.close is admin-only)", async () => {
    for (const person of [a.manager, a.report, a.auditor]) {
      expect(
        (await post("/v1/time/closures", person, { month: MONTH })).status,
      ).toBe(403);
      expect(
        (
          await post("/v1/time/closures", person, {
            month: MONTH,
            employeeIds: [a.report.employeeId],
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await post("/v1/time/closures/reopen", person, {
            month: MONTH,
            employeeId: a.report.employeeId,
            reason: "Wrong totals",
          })
        ).status,
      ).toBe(403);
      expect(
        (await get(`/v1/time/closures?month=${MONTH}`, person)).status,
      ).toBe(403);
    }
    expect(await closureRows(a.report.employeeId)).toHaveLength(0);
  });

  it("closes every employee's month, snapshotting totals and reporting missing schedules", async () => {
    const body = await close(a.admin);
    expect(body).toMatchObject({
      month: MONTH,
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
    });
    expect(resultFor(body, a.peer.employeeId)?.status).toBe("closed");
    expect(resultFor(body, a.report.employeeId)?.status).toBe("closed");
    // No schedule: reported, not fatal for the others.
    expect(resultFor(body, a.admin.employeeId)).toEqual({
      employeeId: a.admin.employeeId,
      status: "schedule_not_configured",
      closedAt: null,
    });
    expect(body.results.map((r) => r.employeeId)).not.toContain(
      b.peer.employeeId,
    );
    firstClosedAt = resultFor(body, a.peer.employeeId)!.closedAt!;

    const sheet = await timesheet(a.peer);
    expect(sheet.closure).toEqual({
      closedAt: firstClosedAt,
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
      totals: {
        totalWorkedMinutes: 480,
        totalBreakMinutes: 0,
        totalExpectedHours: sheet.totalExpectedHours,
        totalOvertimeMinutes: sheet.totalOvertimeMinutes,
      },
      postCloseChanges: [],
    });
  });

  it("audits each close with ids only", async () => {
    const rows = await audits(a.orgId, "time.period.close");
    const closed = await db.sql<{ id: string }[]>`
      SELECT id FROM timesheet_closures
      WHERE organization_id = ${a.orgId} AND action = 'close'`;
    expect(rows).toHaveLength(closed.length);
    expect(rows.map((r) => r.resourceId).sort()).toEqual(
      closed.map((r) => r.id).sort(),
    );
    for (const row of rows) {
      expect(row.actorId).toBe(a.admin.id);
      expect(JSON.stringify(row.metadata)).not.toContain("@");
      expect(JSON.stringify(row.metadata)).not.toContain("Fixture");
    }
  });

  it("is idempotent: closing again keeps the first close", async () => {
    const before = (await audits(a.orgId, "time.period.close")).length;
    const body = await close(a.admin, {
      month: MONTH,
      employeeIds: [a.peer.employeeId],
    });
    expect(body.results).toEqual([
      {
        employeeId: a.peer.employeeId,
        status: "already_closed",
        closedAt: firstClosedAt,
      },
    ]);
    expect(await closureRows(a.peer.employeeId)).toEqual([{ action: "close" }]);
    expect(await audits(a.orgId, "time.period.close")).toHaveLength(before);
  });

  it("flags, never blocks, a correction approved after the close", async () => {
    const clockIn = await approvedCorrection(
      "clock_in",
      "2026-01-06T08:00:00.000Z",
    );
    const clockOut = await approvedCorrection(
      "clock_out",
      "2026-01-06T16:00:00.000Z",
    );

    const sheet = await timesheet(a.peer);
    // Live totals include the correction; the snapshot stays frozen.
    expect(sheet.totalWorkedMinutes).toBe(960);
    expect(sheet.closure?.totals.totalWorkedMinutes).toBe(480);
    expect(sheet.closure?.postCloseChanges.map((c) => c.eventId)).toEqual([
      clockIn,
      clockOut,
    ]);

    // A range inside the month carries the whole month's flags.
    const week = await timesheet(
      a.peer,
      "startDate=2026-01-12&endDate=2026-01-18",
    );
    expect(week.closure?.postCloseChanges).toHaveLength(2);
    // A range spanning two months never carries a closure.
    const span = await timesheet(
      a.peer,
      "startDate=2026-01-26&endDate=2026-02-01",
    );
    expect(span.closure).toBeUndefined();
  });

  it("lists the month's closure state for an admin", async () => {
    const res = await get(`/v1/time/closures?month=${MONTH}`, a.admin);
    expect(res.status).toBe(200);
    const body = (await res.json()) as TimesheetClosuresResponse;
    const peer = body.items.find((i) => i.employeeId === a.peer.employeeId);
    expect(peer).toMatchObject({
      status: "closed",
      at: firstClosedAt,
      actorId: a.admin.id,
      reason: null,
      totals: { totalWorkedMinutes: 480 },
    });
    expect(body.items.map((i) => i.employeeId)).not.toContain(
      a.admin.employeeId,
    );
  });

  it("never reaches another organization's employees or closures", async () => {
    const closeOther = await post("/v1/time/closures", b.admin, {
      month: MONTH,
      employeeIds: [a.peer.employeeId],
    });
    expect(closeOther.status).toBe(404);
    const reopenOther = await post("/v1/time/closures/reopen", b.admin, {
      month: MONTH,
      employeeId: a.peer.employeeId,
      reason: "Cross-tenant attempt",
    });
    expect(reopenOther.status).toBe(404);
    const list = await get(`/v1/time/closures?month=${MONTH}`, b.admin);
    expect(list.status).toBe(200);
    expect(((await list.json()) as TimesheetClosuresResponse).items).toEqual(
      [],
    );
    expect(
      (
        await post("/v1/time/closures", a.admin, {
          month: MONTH,
          employeeIds: [b.peer.employeeId],
        })
      ).status,
    ).toBe(404);
    expect(await closureRows(b.peer.employeeId)).toHaveLength(0);
    expect(await closureRows(a.peer.employeeId)).toEqual([{ action: "close" }]);
  });

  it("requires a reason to reopen", async () => {
    for (const reason of [undefined, "", "   ", "no"]) {
      const res = await post("/v1/time/closures/reopen", a.admin, {
        month: MONTH,
        employeeId: a.peer.employeeId,
        ...(reason === undefined ? {} : { reason }),
      });
      expect(res.status).toBe(400);
    }
  });

  it("reopens with a reason, then the month can be closed again", async () => {
    const res = await post("/v1/time/closures/reopen", a.admin, {
      month: MONTH,
      employeeId: a.peer.employeeId,
      reason: "Late overtime approval",
    });
    expect(res.status).toBe(200);
    expect((await res.json()) as TimesheetClosureItem).toMatchObject({
      employeeId: a.peer.employeeId,
      status: "reopened",
      totals: null,
      reason: "Late overtime approval",
    });
    expect((await timesheet(a.peer)).closure).toBeUndefined();

    const reopenAudits = await audits(a.orgId, "time.period.reopen");
    expect(reopenAudits).toHaveLength(1);
    expect(reopenAudits[0]?.metadata).toEqual({
      employeeId: a.peer.employeeId,
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
    });

    // Reopening a month that is not closed is a conflict.
    const again = await post("/v1/time/closures/reopen", a.admin, {
      month: MONTH,
      employeeId: a.peer.employeeId,
      reason: "Late overtime approval",
    });
    expect(again.status).toBe(409);

    const body = await close(a.admin, {
      month: MONTH,
      employeeIds: [a.peer.employeeId],
    });
    const result = resultFor(body, a.peer.employeeId);
    expect(result?.status).toBe("closed");
    expect(result?.closedAt).not.toBe(firstClosedAt);

    const sheet = await timesheet(a.peer);
    // The new snapshot includes the earlier corrections; nothing is flagged.
    expect(sheet.closure?.totals.totalWorkedMinutes).toBe(960);
    expect(sheet.closure?.postCloseChanges).toEqual([]);
    expect(await closureRows(a.peer.employeeId)).toEqual([
      { action: "close" },
      { action: "reopen" },
      { action: "close" },
    ]);
  });
});
