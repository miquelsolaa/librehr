import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  getTestDatabase,
  seedScopedOrg,
  type FixturePerson,
  type ScopedOrgFixture,
  type TestDatabase,
} from "@librehr/testing";
import { runMigrations } from "@librehr/db/migrate";
import { createApp } from "../src/app.js";
import { as, fixtureAuthPort } from "./support/fixture-app.js";

// ONB-002 checklist instances: HR/admin for anyone in the organization,
// managers for their direct reports, employees read their own only.
describe("checklist instances scope", () => {
  let db: TestDatabase;
  let app: ReturnType<typeof createApp>;
  let a: ScopedOrgFixture;
  let b: ScopedOrgFixture;
  let templateId = "";
  let otherTemplateId = "";
  const instances: Record<string, string> = {};

  async function createTemplate(who: FixturePerson): Promise<string> {
    const res = await app.request("/v1/checklists/templates", {
      method: "POST",
      headers: as(who, true),
      body: JSON.stringify({
        name: "Welcome",
        type: "onboarding",
        tasks: [
          {
            title: "Sign contract",
            assignedRole: "employee",
            dueOffsetDays: 0,
          },
        ],
      }),
    });
    if (res.status !== 201) throw new Error(`template failed: ${res.status}`);
    return ((await res.json()) as { id: string }).id;
  }

  const create = (employeeId: string, who: FixturePerson, tpl = templateId) =>
    app.request("/v1/checklists/instances", {
      method: "POST",
      headers: as(who, true),
      body: JSON.stringify({
        templateId: tpl,
        employeeId,
        baseDate: "2026-12-01",
      }),
    });

  const list = (who: FixturePerson, employeeId?: string) =>
    app.request(
      `/v1/checklists/instances${employeeId ? `?employeeId=${employeeId}` : ""}`,
      { headers: as(who) },
    );

  const listEmployeeIds = async (res: Response) =>
    ((await res.json()) as { employeeId: string }[]).map((r) => r.employeeId);

  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database) throw new Error("Docker is required for this suite");
    db = database;
    await runMigrations(db.connectionString);
    a = await seedScopedOrg(db.sql, "chk-a");
    b = await seedScopedOrg(db.sql, "chk-b");
    app = createApp({
      sql: await db.appSql(),
      authPort: fixtureAuthPort([
        a.admin,
        a.manager,
        a.report,
        a.peer,
        a.auditor,
        b.admin,
      ]),
    });
    templateId = await createTemplate(a.admin);
    otherTemplateId = await createTemplate(b.admin);
    for (const [key, person] of [
      ["report", a.report],
      ["peer", a.peer],
      ["manager", a.manager],
    ] as const) {
      const res = await create(person.employeeId, a.admin);
      if (res.status !== 201) throw new Error(`seed failed: ${res.status}`);
      instances[key] = ((await res.json()) as { id: string }).id;
    }
    const other = await create(b.report.employeeId, b.admin, otherTemplateId);
    if (other.status !== 201) throw new Error("other tenant seed failed");
  }, 60000);
  afterAll(async () => {
    if (db) await db.close();
  });

  describe("POST /v1/checklists/instances", () => {
    it("requires authentication", async () => {
      const res = await app.request("/v1/checklists/instances", {
        method: "POST",
      });
      expect(res.status).toBe(401);
    });

    it("lets HR/admin assign a checklist to anyone in the organization", async () => {
      expect((await create(a.peer.employeeId, a.admin)).status).toBe(201);
    });

    it("lets a manager assign a checklist to a direct report", async () => {
      expect((await create(a.report.employeeId, a.manager)).status).toBe(201);
    });

    it("forbids a manager assigning to a non-report or to themselves", async () => {
      expect((await create(a.peer.employeeId, a.manager)).status).toBe(403);
      expect((await create(a.admin.employeeId, a.manager)).status).toBe(403);
      expect((await create(a.manager.employeeId, a.manager)).status).toBe(403);
    });

    it("forbids employees and auditors", async () => {
      expect((await create(a.report.employeeId, a.report)).status).toBe(403);
      expect((await create(a.report.employeeId, a.auditor)).status).toBe(403);
    });

    it("rejects an invalid payload", async () => {
      const res = await app.request("/v1/checklists/instances", {
        method: "POST",
        headers: as(a.admin, true),
        body: JSON.stringify({ employeeId: "nope" }),
      });
      expect(res.status).toBe(422);
    });

    it("returns 404 for another tenant's employee or template", async () => {
      expect((await create(b.report.employeeId, a.admin)).status).toBe(404);
      expect((await create(b.report.employeeId, a.manager)).status).toBe(404);
      expect(
        (await create(a.report.employeeId, a.admin, otherTemplateId)).status,
      ).toBe(404);
    });
  });

  describe("GET /v1/checklists/instances", () => {
    it("requires authentication", async () => {
      expect((await app.request("/v1/checklists/instances")).status).toBe(401);
    });

    it("shows HR/admin the whole organization, never another tenant", async () => {
      const res = await list(a.admin);
      expect(res.status).toBe(200);
      const ids = await listEmployeeIds(res);
      expect(ids).toEqual(
        expect.arrayContaining([
          a.report.employeeId,
          a.peer.employeeId,
          a.manager.employeeId,
        ]),
      );
      expect(ids).not.toContain(b.report.employeeId);
    });

    it("shows a manager their own and their direct reports' only", async () => {
      const res = await list(a.manager);
      expect(res.status).toBe(200);
      const ids = new Set(await listEmployeeIds(res));
      expect([...ids].sort()).toEqual(
        [a.manager.employeeId, a.report.employeeId].sort(),
      );
    });

    it("forbids a manager filtering on a non-report", async () => {
      expect((await list(a.manager, a.peer.employeeId)).status).toBe(403);
    });

    it("shows an employee their own only", async () => {
      const res = await list(a.report);
      expect(res.status).toBe(200);
      expect(new Set(await listEmployeeIds(res))).toEqual(
        new Set([a.report.employeeId]),
      );
      expect((await list(a.report, a.peer.employeeId)).status).toBe(403);
    });

    it("shows an auditor nothing of other people", async () => {
      const res = await list(a.auditor);
      expect(res.status).toBe(200);
      expect(await listEmployeeIds(res)).toEqual([]);
    });

    it("returns 404 when filtering on another tenant's employee", async () => {
      expect((await list(a.manager, b.report.employeeId)).status).toBe(404);
      expect((await list(a.report, b.report.employeeId)).status).toBe(404);
    });
  });
});
