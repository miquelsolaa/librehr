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

// LEA-004 / TIM-003: nobody decides their own leave request or time
// correction, administrators included.
describe("self-approval is forbidden for everyone", () => {
  let db: TestDatabase;
  let app: ReturnType<typeof createApp>;
  let a: ScopedOrgFixture;
  let b: ScopedOrgFixture;
  let secondAdmin: FixturePerson;
  let leaveTypeId = "";

  async function seedSecondAdmin(orgId: string): Promise<FixturePerson> {
    const id = randomUUID();
    const employeeId = randomUUID();
    const email = `admin2-${id.slice(0, 8)}@fixture.invalid`;
    await db.sql`INSERT INTO users (id, email, name) VALUES (${id}, ${email}, 'Fixture admin2')`;
    await db.sql`INSERT INTO memberships (organization_id, user_id, role) VALUES (${orgId}, ${id}, 'admin')`;
    await db.sql`
      INSERT INTO employees (id, organization_id, user_id, first_name, last_name, email)
      VALUES (${employeeId}, ${orgId}, ${id}, 'Fixture', 'admin2', ${email})
    `;
    return {
      id,
      email,
      name: "Fixture admin2",
      role: "admin",
      organizationId: orgId,
      employeeId,
    };
  }

  const seedLeave = (fixture: ScopedOrgFixture, employeeId: string) =>
    withTenant(db.sql, { organizationId: fixture.orgId }, async (tx) => {
      const repo = new LeaveRepository();
      return (
        await repo.createLeaveRequest(tx, {
          employeeId,
          leaveTypeId,
          startDate: "2026-12-14",
          endDate: "2026-12-14",
          workingDays: 1,
        })
      ).id;
    });

  const seedCorrection = (fixture: ScopedOrgFixture, employeeId: string) =>
    withTenant(
      db.sql,
      { organizationId: fixture.orgId },
      async (tx) =>
        (
          await new TimeCorrectionRepository().create(tx, {
            employeeId,
            proposedEventType: "clock_in",
            proposedOccurredAt: new Date("2026-03-02T08:00:00Z"),
            reason: "Forgot to clock in",
          })
        ).id,
    );

  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database) throw new Error("Docker is required for this suite");
    db = database;
    await runMigrations(db.connectionString);
    a = await seedScopedOrg(db.sql, "selfappr-a");
    b = await seedScopedOrg(db.sql, "selfappr-b");
    secondAdmin = await seedSecondAdmin(a.orgId);
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
      authPort: fixtureAuthPort([
        a.admin,
        a.manager,
        a.report,
        secondAdmin,
        b.admin,
      ]),
    });
  }, 60000);
  afterAll(async () => {
    if (db) await db.close();
  });

  const approve = JSON.stringify({ decision: "approve" });
  const reject = JSON.stringify({ decision: "reject", reason: "No" });

  describe("POST /v1/leave/requests/:id/decide", () => {
    const decide = (id: string, who: FixturePerson, body = approve) =>
      app.request(`/v1/leave/requests/${id}/decide`, {
        method: "POST",
        headers: as(who, true),
        body,
      });

    it("forbids an admin approving their own leave with a distinct code", async () => {
      const id = await seedLeave(a, a.admin.employeeId);
      const res = await decide(id, a.admin);
      expect(res.status).toBe(403);
      const problem = (await res.json()) as { code: string; type: string };
      expect(problem.code).toBe("SELF_APPROVAL_FORBIDDEN");
      expect(problem.type).not.toBe("about:blank");
    });

    it("forbids an admin rejecting their own leave", async () => {
      const id = await seedLeave(a, a.admin.employeeId);
      const res = await decide(id, a.admin, reject);
      expect(res.status).toBe(403);
      expect(((await res.json()) as { code: string }).code).toBe(
        "SELF_APPROVAL_FORBIDDEN",
      );
    });

    it("forbids a manager approving their own leave", async () => {
      const id = await seedLeave(a, a.manager.employeeId);
      const res = await decide(id, a.manager);
      expect(res.status).toBe(403);
      expect(((await res.json()) as { code: string }).code).toBe(
        "SELF_APPROVAL_FORBIDDEN",
      );
    });

    it("lets another admin approve an admin's leave", async () => {
      const id = await seedLeave(a, a.admin.employeeId);
      const res = await decide(id, secondAdmin);
      expect(res.status).toBe(200);
      expect(((await res.json()) as { status: string }).status).toBe(
        "approved",
      );
    });

    it("still lets a manager approve a direct report", async () => {
      const id = await seedLeave(a, a.report.employeeId);
      expect((await decide(id, a.manager)).status).toBe(200);
    });

    it("returns 404 for another tenant's request", async () => {
      const otherId = await withTenant(
        db.sql,
        { organizationId: b.orgId },
        async (tx) => {
          const repo = new LeaveRepository();
          const type = await repo.createLeaveType(tx, {
            name: "Vacation",
            code: "VAC",
          });
          return (
            await repo.createLeaveRequest(tx, {
              employeeId: b.admin.employeeId,
              leaveTypeId: type.id,
              startDate: "2026-12-14",
              endDate: "2026-12-14",
              workingDays: 1,
            })
          ).id;
        },
      );
      expect((await decide(otherId, a.admin)).status).toBe(404);
    });
  });

  describe("POST /v1/time/corrections/:id/decide", () => {
    const decide = (id: string, who: FixturePerson, body = reject) =>
      app.request(`/v1/time/corrections/${id}/decide`, {
        method: "POST",
        headers: as(who, true),
        body,
      });

    it("forbids an admin approving their own correction", async () => {
      const id = await seedCorrection(a, a.admin.employeeId);
      const res = await decide(id, a.admin, approve);
      expect(res.status).toBe(403);
      expect(((await res.json()) as { code: string }).code).toBe(
        "SELF_APPROVAL_FORBIDDEN",
      );
    });

    it("forbids an admin rejecting their own correction", async () => {
      const id = await seedCorrection(a, a.admin.employeeId);
      const res = await decide(id, a.admin);
      expect(res.status).toBe(403);
      expect(((await res.json()) as { code: string }).code).toBe(
        "SELF_APPROVAL_FORBIDDEN",
      );
    });

    it("lets another admin decide an admin's correction", async () => {
      const id = await seedCorrection(a, a.admin.employeeId);
      const res = await decide(id, secondAdmin);
      expect(res.status).toBe(200);
      expect(((await res.json()) as { status: string }).status).toBe(
        "rejected",
      );
    });

    it("returns 404 for another tenant's correction", async () => {
      const id = await seedCorrection(b, b.admin.employeeId);
      expect((await decide(id, a.admin)).status).toBe(404);
    });
  });
});
