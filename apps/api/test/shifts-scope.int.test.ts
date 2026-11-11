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

// TIM-004/TIM-005 rostering and LEA-003 holiday configuration: managers act
// on their direct reports only; holidays are admin/HR settings.
describe("shifts and calendar scope", () => {
  let db: TestDatabase;
  let app: ReturnType<typeof createApp>;
  let a: ScopedOrgFixture;
  let b: ScopedOrgFixture;
  let swapId = "";
  let otherTenantSwapId = "";

  const assign = (who: FixturePerson, employeeId: string) =>
    app.request("/v1/shifts/assignments", {
      method: "POST",
      headers: as(who, true),
      body: JSON.stringify({
        assignments: [
          { employeeId, date: "2026-04-01", shiftTemplateId: null },
        ],
      }),
    });
  const requestSwap = async (who: FixturePerson, target: string) => {
    const res = await app.request("/v1/shifts/swaps", {
      method: "POST",
      headers: as(who, true),
      body: JSON.stringify({
        targetEmployeeId: target,
        requesterDate: "2026-04-01",
        targetDate: "2026-04-02",
      }),
    });
    expect(res.status).toBe(201);
    return ((await res.json()) as { id: string }).id;
  };

  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database) throw new Error("Docker is required for this suite");
    db = database;
    await runMigrations(db.connectionString);
    a = await seedScopedOrg(db.sql, "shift-a");
    b = await seedScopedOrg(db.sql, "shift-b");
    app = createApp({
      sql: db.sql,
      authPort: fixtureAuthPort([
        a.admin,
        a.manager,
        a.report,
        a.peer,
        b.report,
      ]),
    });
    swapId = await requestSwap(a.report, a.peer.employeeId);
    otherTenantSwapId = await requestSwap(b.report, b.peer.employeeId);
  }, 60000);
  afterAll(async () => {
    if (db) await db.close();
  });

  describe("POST /v1/shifts/assignments", () => {
    it("lets a manager roster a direct report", async () => {
      expect((await assign(a.manager, a.report.employeeId)).status).toBe(200);
    });
    it("forbids a manager rostering a non-report or themselves", async () => {
      expect((await assign(a.manager, a.peer.employeeId)).status).toBe(403);
      expect((await assign(a.manager, a.manager.employeeId)).status).toBe(403);
    });
    it("forbids employees", async () => {
      expect((await assign(a.report, a.report.employeeId)).status).toBe(403);
    });
    it("returns 404 for another tenant's employee", async () => {
      expect((await assign(a.admin, b.report.employeeId)).status).toBe(404);
    });
  });

  describe("GET /v1/shifts/assignments", () => {
    const list = (who: FixturePerson, employeeId?: string) =>
      app.request(
        `/v1/shifts/assignments?startDate=2026-04-01&endDate=2026-04-30${
          employeeId ? `&employeeId=${employeeId}` : ""
        }`,
        { headers: as(who) },
      );

    it("returns an employee's own roster", async () => {
      const res = await list(a.report);
      expect(res.status).toBe(200);
      const rows = (await res.json()) as { employeeId: string }[];
      expect(rows.map((r) => r.employeeId)).toEqual([a.report.employeeId]);
    });
    it("forbids an employee filtering on a colleague", async () => {
      expect((await list(a.report, a.peer.employeeId)).status).toBe(403);
    });
    it("forbids a manager filtering on a non-report", async () => {
      expect((await list(a.manager, a.peer.employeeId)).status).toBe(403);
    });
  });

  describe("PATCH /v1/shifts/swaps/:id", () => {
    const decide = (who: FixturePerson, id: string) =>
      app.request(`/v1/shifts/swaps/${id}`, {
        method: "PATCH",
        headers: as(who, true),
        body: JSON.stringify({ status: "rejected" }),
      });

    it("forbids a manager when one side is not their report", async () => {
      expect((await decide(a.manager, swapId)).status).toBe(403);
    });
    it("forbids employees", async () => {
      expect((await decide(a.report, swapId)).status).toBe(403);
    });
    it("returns 404 for another tenant's swap", async () => {
      expect((await decide(a.admin, otherTenantSwapId)).status).toBe(404);
    });
    it("lets admin/HR decide", async () => {
      expect((await decide(a.admin, swapId)).status).toBe(200);
    });
    it("forbids an admin deciding a swap they requested or are the target of", async () => {
      const own = await requestSwap(a.admin, a.peer.employeeId);
      const ownRes = await decide(a.admin, own);
      expect(ownRes.status).toBe(403);
      expect(await ownRes.json()).toMatchObject({
        code: "SELF_APPROVAL_FORBIDDEN",
      });
      const targeted = await requestSwap(a.peer, a.admin.employeeId);
      const targetedRes = await decide(a.admin, targeted);
      expect(targetedRes.status).toBe(403);
      expect(await targetedRes.json()).toMatchObject({
        code: "SELF_APPROVAL_FORBIDDEN",
      });
    });
  });

  it("hides swaps that involve nobody in the caller's scope", async () => {
    const res = await app.request("/v1/shifts/swaps", {
      headers: as(b.report),
    });
    const ids = ((await res.json()) as { id: string }[]).map((s) => s.id);
    expect(ids).toContain(otherTenantSwapId);
    expect(ids).not.toContain(swapId);
  });

  describe("POST /v1/calendar/holidays", () => {
    const body = JSON.stringify({
      locationId: "6f1c2a4e-8b3d-4c5e-9f7a-1b2c3d4e5f60",
      date: "2026-09-24",
      name: "Local holiday",
    });
    it("forbids managers and employees (LEA-003)", async () => {
      for (const who of [a.manager, a.report]) {
        const res = await app.request("/v1/calendar/holidays", {
          method: "POST",
          headers: as(who, true),
          body,
        });
        expect(res.status).toBe(403);
      }
    });
  });
});
