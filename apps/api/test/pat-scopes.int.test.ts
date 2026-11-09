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

// ADM-006: token scopes are enforced, and never exceed the owner's role.
describe("personal access token scope enforcement", () => {
  let db: TestDatabase;
  let app: ReturnType<typeof createApp>;
  let a: ScopedOrgFixture;
  let b: ScopedOrgFixture;

  async function mint(who: FixturePerson, scopes: string[]) {
    const res = await app.request("/v1/tokens", {
      method: "POST",
      headers: as(who, true),
      body: JSON.stringify({ name: `t-${scopes.join("-")}`, scopes }),
    });
    expect(res.status).toBe(201);
    return ((await res.json()) as { plainToken: string }).plainToken;
  }
  const bearer = (token: string, json = false) => ({
    Authorization: `Bearer ${token}`,
    ...(json ? { "Content-Type": "application/json" } : {}),
  });

  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database) throw new Error("Docker is required for this suite");
    db = database;
    await runMigrations(db.connectionString);
    a = await seedScopedOrg(db.sql, "pat-a");
    b = await seedScopedOrg(db.sql, "pat-b");
    app = createApp({
      sql: db.sql,
      authPort: fixtureAuthPort([a.admin, a.report]),
    });
  }, 60000);
  afterAll(async () => {
    if (db) await db.close();
  });

  it("rejects unknown scopes at creation", async () => {
    const res = await app.request("/v1/tokens", {
      method: "POST",
      headers: as(a.admin, true),
      body: JSON.stringify({ name: "bad", scopes: ["everything"] }),
    });
    expect(res.status).toBe(422);
  });

  it("lets a read token read but not write", async () => {
    const token = await mint(a.admin, ["read"]);
    const read = await app.request("/v1/employees", {
      headers: bearer(token),
    });
    expect(read.status).toBe(200);
    const write = await app.request("/v1/departments", {
      method: "POST",
      headers: bearer(token, true),
      body: JSON.stringify({ name: "Ops" }),
    });
    expect(write.status).toBe(403);
    expect(await write.json()).toMatchObject({
      code: "TOKEN_SCOPE_INSUFFICIENT",
    });
  });

  it("keeps admin route groups behind the admin scope", async () => {
    const write = await mint(a.admin, ["read", "write"]);
    expect(
      (await app.request("/v1/audit", { headers: bearer(write) })).status,
    ).toBe(403);
    const admin = await mint(a.admin, ["admin"]);
    expect(
      (await app.request("/v1/audit", { headers: bearer(admin) })).status,
    ).toBe(200);
  });

  it("never lets a token manage tokens", async () => {
    const token = await mint(a.admin, ["read", "write", "admin"]);
    expect(
      (await app.request("/v1/tokens", { headers: bearer(token) })).status,
    ).toBe(403);
  });

  it("does not exceed the owner's role", async () => {
    const token = await mint(a.report, ["admin"]);
    expect(
      (await app.request("/v1/audit", { headers: bearer(token) })).status,
    ).toBe(403);
  });

  it("stays within the owner's tenant", async () => {
    const token = await mint(a.admin, ["read"]);
    const res = await app.request(`/v1/employees/${b.report.employeeId}`, {
      headers: bearer(token),
    });
    expect(res.status).toBe(404);
  });
});
