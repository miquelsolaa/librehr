import type { Sql } from "postgres";
import { describe, expect, it } from "vitest";
import type { AuthUser } from "@librehr/contracts";
import type { AuthPort } from "../src/ports/auth.js";
import { createApp } from "../src/app.js";

// Route-level regressions for errors that used to surface as 500s. The fake
// transaction answers every query with no rows, which is enough to drive the
// "not found" branches without a database. The same paths are covered against
// Postgres in route-errors.int.test.ts.
function emptyResultSql(): Sql {
  const query = async () => [];
  return Object.assign(query, {
    begin: async (fn: (tx: unknown) => Promise<unknown>) => fn(async () => []),
  }) as unknown as Sql;
}

const admin: AuthUser = {
  id: "10000000-0000-0000-0000-000000000201",
  email: "admin@errors.invalid",
  name: "Admin",
  role: "admin",
  organizationId: "10000000-0000-0000-0000-000000000200",
};

const authPort: AuthPort = {
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

const app = createApp({ sql: emptyResultSql(), authPort });
const send = (method: string, path: string, body: string) =>
  app.request(path, {
    method,
    headers: {
      Authorization: "Bearer admin",
      "Content-Type": "application/json",
    },
    body,
  });

const unknownId = "6f1c2a4e-8b3d-4c5e-9f7a-1b2c3d4e5f60";

describe("typed route errors", () => {
  it("returns 404 when instantiating a checklist for an unknown employee", async () => {
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
  });

  it.each([
    ["POST", "/v1/calendar/holidays"],
    ["POST", "/v1/calendar/seed-statutory"],
    ["POST", "/v1/employees/import"],
    ["PATCH", `/v1/checklists/tasks/${unknownId}`],
  ])("returns 400 for malformed JSON on %s %s", async (method, path) => {
    const res = await send(method, path, "{not json");
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "MALFORMED_JSON" });
  });

  it("rejects a non-numeric audit limit with 400", async () => {
    const res = await app.request("/v1/audit?limit=abc", {
      headers: { Authorization: "Bearer admin" },
    });
    expect(res.status).toBe(400);
  });

  it("rejects a non-numeric holiday year with 400", async () => {
    const res = await app.request(
      `/v1/calendar/holidays?locationId=${unknownId}&year=abc`,
      { headers: { Authorization: "Bearer admin" } },
    );
    expect(res.status).toBe(400);
  });

  it("returns 404 for a malformed holiday id", async () => {
    const res = await app.request("/v1/calendar/holidays/not-a-uuid", {
      method: "DELETE",
      headers: { Authorization: "Bearer admin" },
    });
    expect(res.status).toBe(404);
  });
});
