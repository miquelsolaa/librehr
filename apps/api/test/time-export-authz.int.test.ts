import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FixturePerson, ScopedOrgFixture } from "@librehr/testing";
import {
  PERIOD,
  setupTimeExportFixture,
  type TimeExportFixture,
} from "./support/time-export-fixture.js";

// TIM-006 export authorization, per AGENTS §6: organization scope needs
// organization-wide access, employee scope follows each role, 401 without a
// session and nothing from another tenant.
describe("GET /v1/time/export authorization (TIM-006)", () => {
  let fx: TimeExportFixture;
  let a: ScopedOrgFixture;
  let b: ScopedOrgFixture;

  const get = (path: string, person?: FixturePerson) => fx.get(path, person);

  beforeAll(async () => {
    fx = await setupTimeExportFixture("txz");
    a = fx.a;
    b = fx.b;
  }, 90000);

  afterAll(async () => {
    if (fx) await fx.db.close();
  });

  it("forbids organization scope without organization-wide access", async () => {
    for (const person of [a.manager, a.report]) {
      const res = await get(
        `/v1/time/export?${PERIOD}&scope=organization`,
        person,
      );
      expect(res.status).toBe(403);
      expect(res.headers.get("content-type")).toContain(
        "application/problem+json",
      );
    }
  });

  it("applies employee scope for every role", async () => {
    const at = async (person: FixturePerson, employeeId?: string) => {
      const filter = employeeId ? `&employeeId=${employeeId}` : "";
      return (await get(`/v1/time/export?${PERIOD}${filter}`, person)).status;
    };
    expect(await at(a.manager, a.report.employeeId)).toBe(200);
    expect(await at(a.manager, a.admin.employeeId)).toBe(403);
    expect(await at(a.report)).toBe(200);
    expect(await at(a.report, a.report.employeeId)).toBe(200);
    expect(await at(a.report, a.manager.employeeId)).toBe(403);
    expect(await at(a.auditor, a.report.employeeId)).toBe(200);
    expect(await at(a.admin, a.report.employeeId)).toBe(200);
  });

  it("never exposes another tenant's employee", async () => {
    const res = await get(
      `/v1/time/export?${PERIOD}&employeeId=${b.report.employeeId}&format=csv`,
      a.admin,
    );
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("Fixture");
  });

  it("requires authentication", async () => {
    expect((await get(`/v1/time/export?${PERIOD}`)).status).toBe(401);
  });
});
