import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getTestDatabase, type TestDatabase } from "@librehr/testing";
import { runMigrations } from "@librehr/db/migrate";
import { withTenant, LocationRepository } from "@librehr/db";
import { createApp } from "../src/app.js";
import type { AuthPort } from "../src/ports/auth.js";
import type { AuthUser } from "@librehr/contracts";

const org = "30000000-0000-0000-0000-000000000091";
const otherOrg = "40000000-0000-0000-0000-000000000091";
const admin: AuthUser = {
  id: "30000000-0000-0000-0000-000000000011",
  email: "admin@example.invalid",
  name: "Admin",
  role: "admin",
  organizationId: org,
};
const staff: AuthUser = {
  id: "30000000-0000-0000-0000-000000000012",
  email: "staff@example.invalid",
  name: "Staff",
  role: "employee",
  organizationId: org,
};
const auth: AuthPort = {
  async verifyCredentials() {
    return null;
  },
  async createSession(user: AuthUser) {
    return { user, token: user.id, expiresAt: new Date(Date.now() + 60000) };
  },
  async getSession(token) {
    const user = token === "admin" ? admin : token === "staff" ? staff : null;
    return user
      ? { user, token, expiresAt: new Date(Date.now() + 60000) }
      : null;
  },
  async revokeSession() {},
};

describe("location legal entity isolation", () => {
  let db: TestDatabase;
  let app: ReturnType<typeof createApp>;
  let ownId: string;
  let otherId: string;
  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database)
      throw new Error("Docker is required for location isolation tests");
    db = database;
    await runMigrations(db.connectionString);
    await db.sql`INSERT INTO users (id, email, name) VALUES (${admin.id}, ${admin.email}, ${admin.name})`;
    await db.sql`INSERT INTO organizations (id, name, slug) VALUES (${org}, 'Location test', 'location-test'), (${otherOrg}, 'Other tenant', 'location-other')`;
    ownId = await withTenant(
      db.sql,
      { organizationId: org },
      async (tx) =>
        (
          await new LocationRepository().createLegalEntity(tx, {
            name: "Own entity",
            taxId: "TEST-A",
          })
        ).id,
    );
    otherId = await withTenant(
      db.sql,
      { organizationId: otherOrg },
      async (tx) =>
        (
          await new LocationRepository().createLegalEntity(tx, {
            name: "Other entity",
            taxId: "TEST-B",
          })
        ).id,
    );
    await withTenant(db.sql, { organizationId: otherOrg }, async (tx) => {
      await new LocationRepository().createLocation(tx, {
        legalEntityId: otherId,
        name: "Other office",
        city: "Other city",
      });
    });
    app = createApp({ sql: await db.appSql(), authPort: auth });
  }, 30000);
  afterAll(async () => {
    if (db) await db.close();
  });
  it("lists only legal entities belonging to the current organization", async () => {
    const response = await app.request("/v1/org/legal-entities", {
      headers: { Authorization: "Bearer admin" },
    });
    expect(response.status).toBe(200);
    const rows = (await response.json()) as Array<{ id: string }>;
    expect(rows.map((r) => r.id)).toEqual([ownId]);
    expect((await app.request("/v1/org/legal-entities")).status).toBe(401);
  });
  it("does not list another tenant's locations", async () => {
    const response = await app.request("/v1/org/locations", {
      headers: { Authorization: "Bearer admin" },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });
  it("rejects another tenant's entity and accepts its own", async () => {
    const create = (legalEntityId: string) =>
      app.request("/v1/org/locations", {
        method: "POST",
        headers: {
          Authorization: "Bearer admin",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          legalEntityId,
          name: "Workplace",
          country: "ES",
          region: "CT",
          city: "Barcelona",
          timezone: "Europe/Madrid",
        }),
      });
    expect(
      (
        await app.request("/v1/org/locations", {
          method: "POST",
          headers: {
            Authorization: "Bearer staff",
            "Content-Type": "application/json",
          },
          body: "{}",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await app.request("/v1/org/locations", {
          method: "POST",
          headers: {
            Authorization: "Bearer admin",
            "Content-Type": "application/json",
          },
          body: "{}",
        })
      ).status,
    ).toBe(400);
    expect((await create(otherId)).status).toBe(404);
    const created = await create(ownId);
    expect(created.status).toBe(201);
    const location = (await created.json()) as { id: string };
    const audit = await withTenant(
      db.sql,
      { organizationId: org },
      (tx) =>
        tx`SELECT actor_id::text AS actor, resource_id::text AS resource FROM audit_log WHERE action = 'location.create'`,
    );
    expect(audit).toEqual([
      expect.objectContaining({ actor: admin.id, resource: location.id }),
    ]);
  });
  it("allows an admin to create a legal entity after validation", async () => {
    const create = (token: string, body: unknown) =>
      app.request("/v1/org/legal-entities", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    expect(
      (await create("staff", { name: "Other", cif: "TEST-ID", country: "ES" }))
        .status,
    ).toBe(403);
    expect(
      (await create("admin", { name: "", cif: "", country: "ES" })).status,
    ).toBe(400);
    const response = await create("admin", {
      name: "New entity",
      cif: "TEST-ID",
      country: "ES",
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ name: "New entity" });
    const audit = await withTenant(
      db.sql,
      { organizationId: org },
      async (tx) =>
        tx`SELECT action FROM audit_log WHERE action = 'legal_entity.create'`,
    );
    expect(audit).toHaveLength(1);
    const list = await app.request("/v1/org/legal-entities", {
      headers: { Authorization: "Bearer admin" },
    });
    expect(await list.json()).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "New entity" })]),
    );
  });
});
