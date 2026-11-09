import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  getTestDatabase,
  seedScopedOrg,
  type FixturePerson,
  type ScopedOrgFixture,
  type TestDatabase,
} from "@librehr/testing";
import { runMigrations } from "@librehr/db/migrate";
import type { OfficialExportResponse } from "@librehr/contracts";
import { createApp } from "../src/app.js";
import { as, fixtureAuthPort } from "./support/fixture-app.js";

// TIM-006 export limits and refusals: tenant isolation, the employee-days
// cap, the rate limit, and no ADM-002 audit entry for a refused export.
const NOV = "startDate=2026-11-02&endDate=2026-11-02";

describe("GET /v1/time/export limits (TIM-006)", () => {
  let db: TestDatabase;
  let a: ScopedOrgFixture;
  let b: ScopedOrgFixture;
  let auditorNoEmployee: FixturePerson;
  let people: FixturePerson[];

  const appWith = async (
    timeExport: Parameters<typeof createApp>[0]["timeExport"],
  ) =>
    createApp({
      sql: await db.appSql(),
      authPort: fixtureAuthPort(people),
      timeExport,
    });
  let app: ReturnType<typeof createApp>;

  const get = (path: string, person: FixturePerson, on = app) =>
    on.request(path, { headers: as(person) });

  // Owner connection (RLS bypassed): filter by organization explicitly.
  const auditCount = async (orgId: string) => {
    const rows = await db.sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM audit_log
      WHERE action = 'time.export' AND organization_id = ${orgId}`;
    return rows[0]?.n ?? 0;
  };

  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database) throw new Error("Docker is required for this suite");
    db = database;
    await runMigrations(db.connectionString);
    a = await seedScopedOrg(db.sql, "txl-a");
    b = await seedScopedOrg(db.sql, "txl-b");
    // An auditor with organization-wide access but no employee record.
    const id = randomUUID();
    const email = `outside-${id.slice(0, 8)}@fixture.invalid`;
    await db.sql`INSERT INTO users (id, email, name) VALUES (${id}, ${email}, 'Fixture outside')`;
    await db.sql`INSERT INTO memberships (organization_id, user_id, role) VALUES (${a.orgId}, ${id}, 'auditor')`;
    auditorNoEmployee = {
      id,
      email,
      name: "Fixture outside",
      role: "auditor",
      organizationId: a.orgId,
      employeeId: "",
    };
    people = [a.admin, a.auditor, b.admin, auditorNoEmployee];
    app = await appWith({ rateLimit: { windowMs: 60_000, max: 1000 } });
  }, 120000);

  afterAll(async () => {
    if (db) await db.close();
  });

  it("never lists another tenant's employees and audits only the caller's tenant", async () => {
    const before = await auditCount(a.orgId);
    const bBefore = await auditCount(b.orgId);
    const res = await get(`/v1/time/export?${NOV}&scope=organization`, b.admin);
    expect(res.status).toBe(200);
    const text = await res.text();
    const doc = JSON.parse(text) as OfficialExportResponse;
    expect(doc.employees.map((e) => e.employeeId).sort()).toEqual(
      [b.admin, b.manager, b.report, b.peer, b.auditor]
        .map((p) => p.employeeId)
        .sort(),
    );
    for (const p of [a.admin, a.manager, a.report, a.peer, a.auditor]) {
      expect(text).not.toContain(p.employeeId);
    }
    expect(await auditCount(a.orgId)).toBe(before);
    expect(await auditCount(b.orgId)).toBe(bBefore + 1);
  });

  it.each([
    [
      "404 for a user without an employee record",
      "self",
      404,
      "EMPLOYEE_NOT_FOUND",
    ],
    ["404 for another tenant's employee", "b", 404, "EMPLOYEE_NOT_FOUND"],
    [
      "409 for an employee without a schedule",
      "peer",
      409,
      "SCHEDULE_NOT_CONFIGURED",
    ],
  ] as const)(
    "answers %s and writes no audit entry",
    async (_, target, status, code) => {
      const filter =
        target === "b"
          ? `&employeeId=${b.report.employeeId}`
          : target === "peer"
            ? `&employeeId=${a.peer.employeeId}`
            : "";
      const person = target === "self" ? auditorNoEmployee : a.admin;
      const before = await auditCount(a.orgId);
      const res = await get(`/v1/time/export?${NOV}${filter}`, person);
      expect(res.status).toBe(status);
      expect(res.headers.get("content-type")).toContain(
        "application/problem+json",
      );
      expect(await res.json()).toMatchObject({ code });
      expect(await auditCount(a.orgId)).toBe(before);
    },
  );

  it("refuses an organization export over the employee-days cap with 422", async () => {
    // Org A lists 5 employees: 5 × 2 days = 10 > 6, while 5 × 1 fits.
    const capped = await appWith({
      maxEmployeeDays: 6,
      rateLimit: { windowMs: 60_000, max: 1000 },
    });
    const before = await auditCount(a.orgId);
    const res = await get(
      "/v1/time/export?startDate=2026-11-02&endDate=2026-11-03&scope=organization",
      a.admin,
      capped,
    );
    expect(res.status).toBe(422);
    expect(res.headers.get("content-type")).toContain(
      "application/problem+json",
    );
    const problem = (await res.json()) as { code: string; detail: string };
    expect(problem.code).toBe("EXPORT_TOO_LARGE");
    expect(problem.detail).toMatch(/shorter period/);
    expect(await auditCount(a.orgId)).toBe(before);
    expect(
      (await get(`/v1/time/export?${NOV}&scope=organization`, a.admin, capped))
        .status,
    ).toBe(200);
  });

  it("rate-limits exports per user with a 429 problem", async () => {
    const limited = await appWith({ rateLimit: { windowMs: 60_000, max: 2 } });
    const path = `/v1/time/export?${NOV}&scope=organization`;
    expect((await get(path, a.admin, limited)).status).toBe(200);
    expect((await get(path, a.admin, limited)).status).toBe(200);
    const before = await auditCount(a.orgId);
    const res = await get(path, a.admin, limited);
    expect(res.status).toBe(429);
    expect(res.headers.get("content-type")).toContain(
      "application/problem+json",
    );
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await res.json()).toMatchObject({ code: "RATE_LIMIT_EXCEEDED" });
    expect(await auditCount(a.orgId)).toBe(before);
    // Another user keeps their own budget.
    expect((await get(path, a.auditor, limited)).status).toBe(200);
  });
});
