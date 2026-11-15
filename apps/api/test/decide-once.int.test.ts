import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  getTestDatabase,
  seedScopedOrg,
  type FixturePerson,
  type ScopedOrgFixture,
  type TestDatabase,
} from "@librehr/testing";
import {
  LeaveRepository,
  TimeCorrectionRepository,
  withTenant,
} from "@librehr/db";
import { runMigrations } from "@librehr/db/migrate";
import { createApp } from "../src/app.js";
import { as, fixtureAuthPort } from "./support/fixture-app.js";

// LEA-004 / TIM-003: a request is decided once. A second decision (another
// approver, a double click, a stale screen) is a 409 and changes nothing:
// no second ledger entry, no second event in the time record chain.
describe("leave requests and time corrections are decided once", () => {
  let db: TestDatabase;
  let app: ReturnType<typeof createApp>;
  let a: ScopedOrgFixture;
  let leaveTypeId = "";

  const seedLeave = () =>
    withTenant(
      db.sql,
      { organizationId: a.orgId },
      async (tx) =>
        (
          await new LeaveRepository().createLeaveRequest(tx, {
            employeeId: a.report.employeeId,
            leaveTypeId,
            startDate: "2026-12-14",
            endDate: "2026-12-14",
            workingDays: 1,
          })
        ).id,
    );

  const seedCorrection = () =>
    withTenant(
      db.sql,
      { organizationId: a.orgId },
      async (tx) =>
        (
          await new TimeCorrectionRepository().create(tx, {
            employeeId: a.report.employeeId,
            proposedEventType: "clock_out",
            proposedOccurredAt: new Date("2026-03-02T17:00:00Z"),
            reason: "Forgot to clock out",
          })
        ).id,
    );

  const decide = (
    path: "leave/requests" | "time/corrections",
    id: string,
    who: FixturePerson,
    body: Record<string, string>,
  ) =>
    app.request(`/v1/${path}/${id}/decide`, {
      method: "POST",
      headers: as(who, true),
      body: JSON.stringify(body),
    });

  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database) throw new Error("Docker is required for this suite");
    db = database;
    await runMigrations(db.connectionString);
    a = await seedScopedOrg(db.sql, "decide-once");
    leaveTypeId = await withTenant(
      db.sql,
      { organizationId: a.orgId },
      async (tx) =>
        (
          await new LeaveRepository().createLeaveType(tx, {
            name: "Vacation",
            code: "VAC",
          })
        ).id,
    );
    app = createApp({
      sql: await db.appSql(),
      authPort: fixtureAuthPort([a.admin, a.manager]),
    });
  }, 60000);
  afterAll(async () => {
    if (db) await db.close();
  });

  it("refuses a second approval of a leave request without a second ledger entry", async () => {
    const id = await seedLeave();
    expect(
      (await decide("leave/requests", id, a.manager, { decision: "approve" }))
        .status,
    ).toBe(200);
    const again = await decide("leave/requests", id, a.admin, {
      decision: "approve",
    });
    expect(again.status).toBe(409);
    expect(((await again.json()) as { code: string }).code).toBe(
      "ALREADY_DECIDED",
    );
    const usage = await db.sql`
      SELECT 1 FROM leave_ledger WHERE source_ref = ${id} AND entry_type = 'usage'
    `;
    expect(usage).toHaveLength(1);
  });

  it("does not flip a rejected leave request to approved", async () => {
    const id = await seedLeave();
    await decide("leave/requests", id, a.manager, {
      decision: "reject",
      reason: "Team is short",
    });
    const flip = await decide("leave/requests", id, a.admin, {
      decision: "approve",
    });
    expect(flip.status).toBe(409);
    const [row] = await db.sql<{ status: string }[]>`
      SELECT status FROM leave_requests WHERE id = ${id}
    `;
    expect(row?.status).toBe("rejected");
  });

  it("keeps the approver's comment on an approved leave request", async () => {
    const id = await seedLeave();
    const res = await decide("leave/requests", id, a.manager, {
      decision: "approve",
      reason: "Enjoy the break",
    });
    expect(res.status).toBe(200);
    expect(
      ((await res.json()) as { decisionReason: string | null }).decisionReason,
    ).toBe("Enjoy the break");
  });

  it("refuses a second approval of a correction without a second time event", async () => {
    const id = await seedCorrection();
    expect(
      (await decide("time/corrections", id, a.manager, { decision: "approve" }))
        .status,
    ).toBe(200);
    const again = await decide("time/corrections", id, a.admin, {
      decision: "approve",
    });
    expect(again.status).toBe(409);
    expect(((await again.json()) as { code: string }).code).toBe(
      "ALREADY_DECIDED",
    );
    const events = await db.sql`
      SELECT 1 FROM time_events
      WHERE employee_id = ${a.report.employeeId}
        AND occurred_at = '2026-03-02T17:00:00Z'
    `;
    expect(events).toHaveLength(1);
  });

  it("does not flip a rejected correction to approved", async () => {
    const id = await seedCorrection();
    await decide("time/corrections", id, a.manager, {
      decision: "reject",
      reason: "No late shift that day",
    });
    const flip = await decide("time/corrections", id, a.admin, {
      decision: "approve",
    });
    expect(flip.status).toBe(409);
    const [row] = await db.sql<{ status: string }[]>`
      SELECT status FROM time_corrections WHERE id = ${id}
    `;
    expect(row?.status).toBe("rejected");
  });
});
