import { randomUUID } from "node:crypto";
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

// LEA-004 / LEA-008 (#36): an organization's only possible approver may
// approve their own leave with a reason, audited as
// `leave.request.self_approve`. Anyone else who could decide (another admin,
// their manager, an active delegate) keeps the strict 403. Time corrections
// never have the exception.
describe("sole approver self-approval of leave", () => {
  let db: TestDatabase;
  let app: ReturnType<typeof createApp>;
  /** Only one live admin (plus one whose access has expired). */
  let solo: ScopedOrgFixture;
  /** Two live admins. */
  let pair: ScopedOrgFixture;
  /** One admin whose manager has delegated approvals to a colleague. */
  let delegated: ScopedOrgFixture;
  const leaveTypes = new Map<string, string>();

  async function seedAdmin(
    orgId: string,
    accessExpiresAt: Date | null = null,
  ): Promise<FixturePerson> {
    const id = randomUUID();
    const employeeId = randomUUID();
    const email = `admin-${id.slice(0, 8)}@fixture.invalid`;
    await db.sql`INSERT INTO users (id, email, name) VALUES (${id}, ${email}, 'Fixture admin')`;
    await db.sql`
      INSERT INTO memberships (organization_id, user_id, role, access_expires_at)
      VALUES (${orgId}, ${id}, 'admin', ${accessExpiresAt})
    `;
    await db.sql`
      INSERT INTO employees (id, organization_id, user_id, first_name, last_name, email)
      VALUES (${employeeId}, ${orgId}, ${id}, 'Fixture', 'admin', ${email})
    `;
    return {
      id,
      email,
      name: "Fixture admin",
      role: "admin",
      organizationId: orgId,
      employeeId,
    };
  }

  const seedLeave = (fixture: ScopedOrgFixture, employeeId: string) =>
    withTenant(
      db.sql,
      { organizationId: fixture.orgId },
      async (tx) =>
        (
          await new LeaveRepository().createLeaveRequest(tx, {
            employeeId,
            leaveTypeId: leaveTypes.get(fixture.orgId)!,
            startDate: "2026-12-14",
            endDate: "2026-12-15",
            workingDays: 2,
          })
        ).id,
    );

  const decide = (id: string, who: FixturePerson, body: object) =>
    app.request(`/v1/leave/requests/${id}/decide`, {
      method: "POST",
      headers: as(who, true),
      body: JSON.stringify(body),
    });

  const codeOf = async (res: Response) =>
    ((await res.json()) as { code: string }).code;

  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database) throw new Error("Docker is required for this suite");
    db = database;
    await runMigrations(db.connectionString);
    solo = await seedScopedOrg(db.sql, "solo-appr");
    pair = await seedScopedOrg(db.sql, "pair-appr");
    delegated = await seedScopedOrg(db.sql, "deleg-appr");
    // An admin whose access ended yesterday cannot decide anything.
    await seedAdmin(solo.orgId, new Date(Date.now() - 86_400_000));
    const secondAdmin = await seedAdmin(pair.orgId);
    // The admin reports to an employee (no approve permission) who has
    // delegated approvals to the report (LEA-008).
    await db.sql`
      UPDATE employees SET manager_id = ${delegated.peer.employeeId}
      WHERE id = ${delegated.admin.employeeId}
    `;
    await db.sql`
      INSERT INTO approval_delegations
        (organization_id, manager_employee_id, delegate_employee_id, start_date, end_date)
      VALUES (${delegated.orgId}, ${delegated.peer.employeeId}, ${delegated.report.employeeId},
              current_date - 1, current_date + 30)
    `;
    for (const fixture of [solo, pair, delegated]) {
      leaveTypes.set(
        fixture.orgId,
        await withTenant(
          db.sql,
          { organizationId: fixture.orgId },
          async (tx) =>
            (
              await new LeaveRepository().createLeaveType(tx, {
                name: "Vacation",
                code: "VAC",
              })
            ).id,
        ),
      );
    }
    app = createApp({
      sql: await db.appSql(),
      authPort: fixtureAuthPort([
        solo.admin,
        pair.admin,
        secondAdmin,
        delegated.admin,
      ]),
    });
  }, 60000);
  afterAll(async () => {
    if (db) await db.close();
  });

  it("refuses a sole admin's self-approval without a reason (400)", async () => {
    const id = await seedLeave(solo, solo.admin.employeeId);
    for (const body of [
      { decision: "approve" },
      { decision: "approve", reason: "   " },
    ]) {
      const res = await decide(id, solo.admin, body);
      expect(res.status).toBe(400);
      expect(await codeOf(res)).toBe("SELF_APPROVAL_REASON_REQUIRED");
    }
    const status = await withTenant(
      db.sql,
      { organizationId: solo.orgId },
      (tx) => tx`SELECT status FROM leave_requests WHERE id = ${id}`,
    );
    expect(status[0]?.["status"]).toBe("pending");
  });

  it("lists the sole admin's own leave in the inbox as self-approvable", async () => {
    const id = await seedLeave(solo, solo.admin.employeeId);
    const res = await app.request("/v1/approvals/pending", {
      headers: as(solo.admin),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      leaveRequests: { id: string; selfApproval: boolean }[];
    };
    expect(body.leaveRequests).toContainEqual(
      expect.objectContaining({ id, selfApproval: true }),
    );
  });

  it("lets a sole admin approve their own leave with a reason", async () => {
    const id = await seedLeave(solo, solo.admin.employeeId);
    const res = await decide(id, solo.admin, {
      decision: "approve",
      reason: "No other approver in the organization",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      decisionReason: string;
    };
    expect(body.status).toBe("approved");
    expect(body.decisionReason).toBe("No other approver in the organization");

    const { ledger, audit } = await withTenant(
      db.sql,
      { organizationId: solo.orgId },
      async (tx) => ({
        ledger: await tx`
          SELECT entry_type, amount::float AS amount FROM leave_ledger
          WHERE source_ref = ${id}
        `,
        audit: await tx`
          SELECT actor_id::text AS actor, metadata FROM audit_log
          WHERE action = 'leave.request.self_approve' AND resource_id = ${id}
        `,
      }),
    );
    expect(ledger).toEqual([{ entry_type: "usage", amount: -2 }]);
    expect(audit).toHaveLength(1);
    expect(audit[0]?.["actor"]).toBe(solo.admin.id);
    // Ids only (ADM-002): the free-text reason is not copied into the log.
    expect(audit[0]?.["metadata"]).toEqual({
      decision: "approve",
      employeeId: solo.admin.employeeId,
    });
  });

  it("never lets a sole admin reject their own leave", async () => {
    const id = await seedLeave(solo, solo.admin.employeeId);
    const res = await decide(id, solo.admin, {
      decision: "reject",
      reason: "Changed my mind",
    });
    expect(res.status).toBe(403);
    expect(await codeOf(res)).toBe("SELF_APPROVAL_FORBIDDEN");
  });

  it("keeps the strict rule for a sole admin's own time correction", async () => {
    const id = await withTenant(
      db.sql,
      { organizationId: solo.orgId },
      async (tx) =>
        (
          await new TimeCorrectionRepository().create(tx, {
            employeeId: solo.admin.employeeId,
            proposedEventType: "clock_in",
            proposedOccurredAt: new Date("2026-03-02T08:00:00Z"),
            reason: "Forgot to clock in",
          })
        ).id,
    );
    const res = await app.request(`/v1/time/corrections/${id}/decide`, {
      method: "POST",
      headers: as(solo.admin, true),
      body: JSON.stringify({ decision: "approve", reason: "Sole admin" }),
    });
    expect(res.status).toBe(403);
    expect(await codeOf(res)).toBe("SELF_APPROVAL_FORBIDDEN");
  });

  it("keeps 403 when another admin could decide", async () => {
    const id = await seedLeave(pair, pair.admin.employeeId);
    const res = await decide(id, pair.admin, {
      decision: "approve",
      reason: "Trying anyway",
    });
    expect(res.status).toBe(403);
    expect(await codeOf(res)).toBe("SELF_APPROVAL_FORBIDDEN");

    const inbox = (await (
      await app.request("/v1/approvals/pending", { headers: as(pair.admin) })
    ).json()) as { leaveRequests: { id: string }[] };
    expect(inbox.leaveRequests.map((r) => r.id)).not.toContain(id);
  });

  it("keeps 403 when an active delegate could decide (LEA-008)", async () => {
    const id = await seedLeave(delegated, delegated.admin.employeeId);
    const res = await decide(id, delegated.admin, {
      decision: "approve",
      reason: "Trying anyway",
    });
    expect(res.status).toBe(403);
    expect(await codeOf(res)).toBe("SELF_APPROVAL_FORBIDDEN");
  });

  it("returns 404 for another tenant's request", async () => {
    const id = await seedLeave(pair, pair.admin.employeeId);
    const res = await decide(id, solo.admin, {
      decision: "approve",
      reason: "Not mine",
    });
    expect(res.status).toBe(404);
  });
});
