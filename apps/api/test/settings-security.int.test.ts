import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  getTestDatabase,
  seedScopedOrg,
  type ScopedOrgFixture,
  type TestDatabase,
} from "@librehr/testing";
import { runMigrations } from "@librehr/db/migrate";
import { createApp } from "../src/app.js";
import { as, fixtureAuthPort } from "./support/fixture-app.js";

// AUTH-003 organization security settings: anyone in the organization reads
// them, only admins change them, and only for their own organization.
describe("organization security settings API", () => {
  let db: TestDatabase;
  let app: ReturnType<typeof createApp>;
  let a: ScopedOrgFixture;
  let b: ScopedOrgFixture;

  const requireTwoFactor = async (orgId: string) => {
    const rows = await db.sql<{ require_two_factor: boolean }[]>`
      SELECT require_two_factor FROM organizations WHERE id = ${orgId}
    `;
    return rows[0]?.require_two_factor;
  };

  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database) throw new Error("Docker is required for this suite");
    db = database;
    await runMigrations(db.connectionString);
    a = await seedScopedOrg(db.sql, "sec-a");
    b = await seedScopedOrg(db.sql, "sec-b");
    app = createApp({
      sql: db.sql,
      authPort: fixtureAuthPort([a.admin, a.report]),
    });
  }, 60000);
  afterAll(async () => {
    if (db) await db.close();
  });

  describe("GET /v1/settings/security", () => {
    it("requires authentication", async () => {
      expect((await app.request("/v1/settings/security")).status).toBe(401);
    });

    it("returns the caller's organization settings", async () => {
      const res = await app.request("/v1/settings/security", {
        headers: as(a.report),
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        requireTwoFactor: false,
        auditorAccessMaxDays: 90,
      });
    });
  });

  describe("PATCH /v1/settings/security", () => {
    const patch = (who = a.admin, body: unknown = { requireTwoFactor: true }) =>
      app.request("/v1/settings/security", {
        method: "PATCH",
        headers: as(who, true),
        body: JSON.stringify(body),
      });

    it("forbids non-admins", async () => {
      expect((await patch(a.report)).status).toBe(403);
      expect(await requireTwoFactor(a.orgId)).toBe(false);
    });

    it("rejects an invalid body", async () => {
      expect((await patch(a.admin, { requireTwoFactor: "yes" })).status).toBe(
        400,
      );
    });

    it("updates only the admin's own organization", async () => {
      expect((await patch()).status).toBe(200);
      expect(await requireTwoFactor(a.orgId)).toBe(true);
      expect(await requireTwoFactor(b.orgId)).toBe(false);
    });

    it("updates one setting without touching the other (TIM-008)", async () => {
      expect((await patch(a.admin, { requireTwoFactor: true })).status).toBe(
        200,
      );
      const res = await patch(a.admin, { auditorAccessMaxDays: 45 });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        requireTwoFactor: true,
        auditorAccessMaxDays: 45,
      });
      expect(await requireTwoFactor(a.orgId)).toBe(true);
      expect((await patch(a.admin, {})).status).toBe(400);
    });
  });
});
