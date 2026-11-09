import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getTestDatabase, type TestDatabase } from "@librehr/testing";
import { runMigrations } from "@librehr/db/migrate";
import type { AuthUser } from "@librehr/contracts";
import type { AuthPort } from "../src/ports/auth.js";
import { createApp } from "../src/app.js";

const org = "10000000-0000-0000-0000-000000000301";
const admin: AuthUser = {
  id: "10000000-0000-0000-0000-000000000302",
  email: "admin@route-errors.invalid",
  name: "Admin",
  role: "admin",
  organizationId: org,
};
const auth: AuthPort = {
  async verifyCredentials() {
    return null;
  },
  async createSession(user) {
    return { user, token: "admin", expiresAt: new Date(Date.now() + 60000) };
  },
  async getSession(token) {
    return token === "admin"
      ? { user: admin, token, expiresAt: new Date(Date.now() + 60000) }
      : null;
  },
  async revokeSession() {},
};
const unknownId = "6f1c2a4e-8b3d-4c5e-9f7a-1b2c3d4e5f60";

describe("typed route errors against Postgres", () => {
  let db: TestDatabase;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database) throw new Error("Docker is required for route error tests");
    db = database;
    await runMigrations(db.connectionString);
    await db.sql`INSERT INTO organizations (id, name, slug) VALUES (${org}, 'Errors', 'route-errors-test')`;
    await db.sql`INSERT INTO users (id, email, name) VALUES (${admin.id}, ${admin.email}, ${admin.name})`;
    app = createApp({ sql: await db.appSql(), authPort: auth });
  }, 30000);
  afterAll(async () => {
    if (db) await db.close();
  });

  const send = (method: string, path: string, body?: string) =>
    app.request(path, {
      method,
      headers: {
        Authorization: "Bearer admin",
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body }),
    });

  it("returns 404 problem+json when instantiating a checklist for an unknown employee", async () => {
    const res = await send(
      "POST",
      "/v1/checklists/instances",
      JSON.stringify({
        templateId: unknownId,
        employeeId: unknownId,
        baseDate: "2026-01-01",
      }),
    );
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain(
      "application/problem+json",
    );
    expect(await res.json()).toMatchObject({ code: "NOT_FOUND" });
  });

  it("returns 404 when generating a roster for an unknown shift pattern", async () => {
    const res = await send(
      "POST",
      "/v1/shifts/generate-roster",
      JSON.stringify({
        patternId: unknownId,
        anchorDate: "2026-01-01",
        startDate: "2026-01-01",
        endDate: "2026-01-07",
        employeeIds: [],
      }),
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: "PATTERN_NOT_FOUND" });
  });

  it("returns 400 for malformed JSON on a calendar route", async () => {
    const res = await send("POST", "/v1/calendar/holidays", "{not json");
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "MALFORMED_JSON" });
  });

  it("returns 404 instead of a database error for a malformed holiday id", async () => {
    const res = await send("DELETE", "/v1/calendar/holidays/not-a-uuid");
    expect(res.status).toBe(404);
  });

  it("returns 400 instead of a database error for invalid audit filters", async () => {
    expect((await send("GET", "/v1/audit?limit=abc")).status).toBe(400);
    expect((await send("GET", "/v1/audit?actorId=nope")).status).toBe(400);
    expect((await send("GET", "/v1/audit?actorId=&limit=5")).status).toBe(200);
  });
});
