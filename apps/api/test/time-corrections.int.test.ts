import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  getTestDatabase,
  seedScopedOrg,
  type ScopedOrgFixture,
  type TestDatabase,
} from "@librehr/testing";
import { runMigrations } from "@librehr/db/migrate";
import { TimeCorrectionRepository, withTenant } from "@librehr/db";
import { createApp } from "../src/app.js";
import { as, fixtureAuthPort } from "./support/fixture-app.js";

// TIM-003/TIM-008 corrections: list, submit and decide, scoped per AGENTS §6.
describe("time corrections API scope", () => {
  let db: TestDatabase;
  let app: ReturnType<typeof createApp>;
  let a: ScopedOrgFixture;
  let b: ScopedOrgFixture;
  const corrections: Record<string, string> = {};

  const seedCorrection = (fixture: ScopedOrgFixture, employeeId: string) =>
    withTenant(db.sql, { organizationId: fixture.orgId }, (tx) =>
      new TimeCorrectionRepository().create(tx, {
        employeeId,
        proposedEventType: "clock_in",
        proposedOccurredAt: new Date("2026-03-02T08:00:00Z"),
        reason: "Forgot to clock in",
      }),
    );

  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database) throw new Error("Docker is required for this suite");
    db = database;
    await runMigrations(db.connectionString);
    a = await seedScopedOrg(db.sql, "tc-a");
    b = await seedScopedOrg(db.sql, "tc-b");
    corrections["report"] = (await seedCorrection(a, a.report.employeeId)).id;
    corrections["peer"] = (await seedCorrection(a, a.peer.employeeId)).id;
    corrections["manager"] = (await seedCorrection(a, a.manager.employeeId)).id;
    corrections["otherTenant"] = (
      await seedCorrection(b, b.report.employeeId)
    ).id;
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

  const listIds = async (res: Response) =>
    ((await res.json()) as { id: string }[]).map((r) => r.id);

  describe("GET /v1/time/corrections", () => {
    it("requires authentication", async () => {
      expect((await app.request("/v1/time/corrections")).status).toBe(401);
    });

    it("returns only an employee's own corrections", async () => {
      const res = await app.request("/v1/time/corrections", {
        headers: as(a.report),
      });
      expect(res.status).toBe(200);
      expect(await listIds(res)).toEqual([corrections["report"]]);
    });

    it("returns a manager's own and direct reports' corrections only", async () => {
      const res = await app.request("/v1/time/corrections", {
        headers: as(a.manager),
      });
      expect(res.status).toBe(200);
      const ids = await listIds(res);
      expect(ids).toContain(corrections["report"]);
      expect(ids).toContain(corrections["manager"]);
      expect(ids).not.toContain(corrections["peer"]);
    });

    it("forbids a manager filtering on an employee outside their reports", async () => {
      const res = await app.request(
        `/v1/time/corrections?employeeId=${a.peer.employeeId}`,
        { headers: as(a.manager) },
      );
      expect(res.status).toBe(403);
    });

    it("forbids an employee filtering on a colleague", async () => {
      const res = await app.request(
        `/v1/time/corrections?employeeId=${a.peer.employeeId}`,
        { headers: as(a.report) },
      );
      expect(res.status).toBe(403);
    });

    it("never returns another tenant's corrections", async () => {
      const res = await app.request(
        `/v1/time/corrections?employeeId=${b.report.employeeId}`,
        { headers: as(a.admin) },
      );
      expect(res.status).toBe(200);
      expect(await listIds(res)).not.toContain(corrections["otherTenant"]);
    });
  });

  describe("POST /v1/time/corrections", () => {
    const body = JSON.stringify({
      proposedEventType: "clock_out",
      proposedOccurredAt: "2026-03-02T17:00:00Z",
      reason: "Forgot to clock out",
    });

    it("requires authentication", async () => {
      const res = await app.request("/v1/time/corrections", {
        method: "POST",
        body,
      });
      expect(res.status).toBe(401);
    });

    it("creates a correction for the caller's own employee", async () => {
      const res = await app.request("/v1/time/corrections", {
        method: "POST",
        headers: as(a.peer, true),
        body,
      });
      expect(res.status).toBe(201);
      expect(await res.json()).toMatchObject({
        employeeId: a.peer.employeeId,
        status: "pending",
      });
    });

    it("rejects an invalid payload", async () => {
      const res = await app.request("/v1/time/corrections", {
        method: "POST",
        headers: as(a.peer, true),
        body: JSON.stringify({ proposedEventType: "clock_out" }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe("POST /v1/time/corrections/:id/decide", () => {
    const reject = JSON.stringify({ decision: "reject", reason: "Not valid" });

    it("lets a manager decide a direct report's correction", async () => {
      const res = await app.request(
        `/v1/time/corrections/${corrections["report"]}/decide`,
        { method: "POST", headers: as(a.manager, true), body: reject },
      );
      expect(res.status).toBe(200);
    });

    it("forbids a manager deciding a non-report's correction", async () => {
      const res = await app.request(
        `/v1/time/corrections/${corrections["peer"]}/decide`,
        { method: "POST", headers: as(a.manager, true), body: reject },
      );
      expect(res.status).toBe(403);
    });

    it("forbids a manager deciding their own correction", async () => {
      const res = await app.request(
        `/v1/time/corrections/${corrections["manager"]}/decide`,
        { method: "POST", headers: as(a.manager, true), body: reject },
      );
      expect(res.status).toBe(403);
    });

    it("forbids an employee deciding a correction", async () => {
      const res = await app.request(
        `/v1/time/corrections/${corrections["peer"]}/decide`,
        { method: "POST", headers: as(a.report, true), body: reject },
      );
      expect(res.status).toBe(403);
    });

    it("returns 404 for another tenant's correction", async () => {
      const res = await app.request(
        `/v1/time/corrections/${corrections["otherTenant"]}/decide`,
        { method: "POST", headers: as(a.admin, true), body: reject },
      );
      expect(res.status).toBe(404);
    });

    it("returns 404 for a malformed id", async () => {
      const res = await app.request("/v1/time/corrections/nope/decide", {
        method: "POST",
        headers: as(a.admin, true),
        body: reject,
      });
      expect(res.status).toBe(404);
    });
  });
});
