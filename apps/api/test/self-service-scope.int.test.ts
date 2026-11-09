import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  getTestDatabase,
  seedScopedOrg,
  type FixturePerson,
  type ScopedOrgFixture,
  type TestDatabase,
} from "@librehr/testing";
import { runMigrations } from "@librehr/db/migrate";
import {
  ChecklistRepository,
  CustomFieldRepository,
  NotificationRepository,
  withTenant,
} from "@librehr/db";
import { createApp } from "../src/app.js";
import { as, fixtureAuthPort } from "./support/fixture-app.js";

// ORG-005 custom field values, ONB-002 checklist task ownership and
// notification ownership.
describe("custom fields, checklist tasks and notifications scope", () => {
  let db: TestDatabase;
  let app: ReturnType<typeof createApp>;
  let a: ScopedOrgFixture;
  let b: ScopedOrgFixture;
  const fields: Record<string, string> = {};
  const tasks: Record<string, string> = {};
  const notifications: Record<string, string> = {};

  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database) throw new Error("Docker is required for this suite");
    db = database;
    await runMigrations(db.connectionString);
    a = await seedScopedOrg(db.sql, "self-a");
    b = await seedScopedOrg(db.sql, "self-b");

    await withTenant(db.sql, { organizationId: a.orgId }, async (tx) => {
      const cf = new CustomFieldRepository();
      for (const visibility of ["employee", "manager", "hr"] as const) {
        const def = await cf.createDefinition(tx, {
          name: `Field ${visibility}`,
          code: `field_${visibility}`,
          fieldType: "text",
          visibility,
        });
        fields[visibility] = def.id;
        await cf.upsertValue(tx, def.id, a.report.employeeId, visibility);
      }
      const instance = await new ChecklistRepository().instantiateChecklist(
        tx,
        {
          employeeId: a.report.employeeId,
          type: "onboarding",
          title: "Onboarding",
          baseDate: "2026-03-02",
          tasks: (["employee", "manager", "admin"] as const).map((role) => ({
            title: `Task for ${role}`,
            assignedRole: role,
            dueDate: "2026-03-09",
          })),
        },
      );
      const rows = await tx<{ id: string; assignedRole: string }[]>`
        SELECT id, assigned_role as "assignedRole" FROM checklist_tasks
        WHERE instance_id = ${instance.id}
      `;
      for (const row of rows) tasks[row.assignedRole] = row.id;
      const n = await new NotificationRepository().create(tx, {
        userId: a.report.id,
        title: "Fixture",
        body: "Fixture notification",
        category: "system",
      });
      notifications["report"] = n.id;
    });
    await withTenant(db.sql, { organizationId: b.orgId }, async (tx) => {
      const def = await new CustomFieldRepository().createDefinition(tx, {
        name: "Other",
        code: "other",
        fieldType: "text",
        visibility: "employee",
      });
      fields["otherTenant"] = def.id;
    });

    app = createApp({
      sql: db.sql,
      authPort: fixtureAuthPort([
        a.admin,
        a.manager,
        a.report,
        a.peer,
        b.admin,
      ]),
    });
  }, 60000);
  afterAll(async () => {
    if (db) await db.close();
  });

  describe("GET /v1/people/:id/custom-fields", () => {
    const read = async (who: FixturePerson, id = a.report.employeeId) => {
      const res = await app.request(`/v1/people/${id}/custom-fields`, {
        headers: as(who),
      });
      return {
        status: res.status,
        codes:
          res.status === 200
            ? ((await res.json()) as { fieldCode: string }[])
                .map((v) => v.fieldCode)
                .sort()
            : [],
      };
    };

    it("requires authentication", async () => {
      const res = await app.request(
        `/v1/people/${a.report.employeeId}/custom-fields`,
      );
      expect(res.status).toBe(401);
    });

    it("applies field visibility per relationship", async () => {
      expect(await read(a.report)).toEqual({
        status: 200,
        codes: ["field_employee"],
      });
      expect(await read(a.manager)).toEqual({
        status: 200,
        codes: ["field_employee", "field_manager"],
      });
      expect(await read(a.admin)).toEqual({
        status: 200,
        codes: ["field_employee", "field_hr", "field_manager"],
      });
    });

    it("forbids colleagues outside the caller's scope", async () => {
      expect((await read(a.peer)).status).toBe(403);
    });

    it("returns 404 for another tenant's employee", async () => {
      expect((await read(b.admin)).status).toBe(404);
    });
  });

  describe("POST /v1/people/:id/custom-fields", () => {
    const write = (
      who: FixturePerson,
      fieldDefinitionId = fields["employee"],
    ) =>
      app.request(`/v1/people/${a.report.employeeId}/custom-fields`, {
        method: "POST",
        headers: as(who, true),
        body: JSON.stringify({ fieldDefinitionId, value: "changed" }),
      });

    it("lets HR/admin write values", async () => {
      expect((await write(a.admin)).status).toBe(200);
    });

    it("forbids the employee, their manager and colleagues", async () => {
      for (const who of [a.report, a.manager, a.peer]) {
        expect((await write(who)).status).toBe(403);
      }
    });

    it("rejects an invalid body", async () => {
      const res = await app.request(
        `/v1/people/${a.report.employeeId}/custom-fields`,
        { method: "POST", headers: as(a.admin, true), body: "{}" },
      );
      expect(res.status).toBe(400);
    });

    it("returns 404 for another tenant's field definition", async () => {
      expect((await write(a.admin, fields["otherTenant"])).status).toBe(404);
    });
  });

  describe("PATCH /v1/checklists/tasks/:id", () => {
    const toggle = (task: string | undefined, who: FixturePerson) =>
      app.request(`/v1/checklists/tasks/${task}`, {
        method: "PATCH",
        headers: as(who, true),
        body: JSON.stringify({ isCompleted: true }),
      });

    it("lets the owner role complete its task", async () => {
      expect((await toggle(tasks["employee"], a.report)).status).toBe(200);
      expect((await toggle(tasks["manager"], a.manager)).status).toBe(200);
      expect((await toggle(tasks["admin"], a.admin)).status).toBe(200);
    });

    it("forbids anyone else", async () => {
      expect((await toggle(tasks["employee"], a.peer)).status).toBe(403);
      expect((await toggle(tasks["manager"], a.report)).status).toBe(403);
      expect((await toggle(tasks["admin"], a.manager)).status).toBe(403);
    });

    it("validates the body", async () => {
      const res = await app.request(`/v1/checklists/tasks/${tasks["admin"]}`, {
        method: "PATCH",
        headers: as(a.admin, true),
        body: JSON.stringify({ isCompleted: "yes" }),
      });
      expect(res.status).toBe(400);
    });

    it("returns 404 for another tenant's task", async () => {
      expect((await toggle(tasks["employee"], b.admin)).status).toBe(404);
    });
  });

  describe("PATCH /v1/notifications/:id/read", () => {
    const markRead = (who: FixturePerson) =>
      app.request(`/v1/notifications/${notifications["report"]}/read`, {
        method: "PATCH",
        headers: as(who),
      });

    it("returns 404 for someone else's notification and leaves it unread", async () => {
      expect((await markRead(a.peer)).status).toBe(404);
      expect((await markRead(b.admin)).status).toBe(404);
      const rows = await db.sql<{ read: boolean }[]>`
        SELECT read FROM notifications WHERE id = ${notifications["report"] ?? ""}
      `;
      expect(rows[0]?.read).toBe(false);
    });

    it("lets the recipient mark it read", async () => {
      expect((await markRead(a.report)).status).toBe(200);
    });
  });
});
