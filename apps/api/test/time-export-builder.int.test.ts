import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { OfficialExportResponse } from "@librehr/contracts";
import { withTenant } from "@librehr/db";
import {
  buildOfficialExport,
  organizationExportSubjects,
} from "@librehr/time-export";
import { resolveTimeChainKey } from "../src/lib/time-chain.js";
import {
  PERIOD,
  setupTimeExportFixture,
  type TimeExportFixture,
} from "./support/time-export-fixture.js";

// Issue #38: the shared builder outside any HTTP request (as the worker will
// run it) yields the very document the synchronous route served.
describe("buildOfficialExport (TIM-006, issue #38)", () => {
  let fx: TimeExportFixture;

  beforeAll(async () => {
    fx = await setupTimeExportFixture("txb");
  }, 90000);

  afterAll(async () => {
    if (fx) await fx.db.close();
  });

  it("reproduces the route's organization export (same content hash)", async () => {
    const { a } = fx;
    const res = await fx.get(
      `/v1/time/export?${PERIOD}&scope=organization&locale=es&format=json`,
      a.admin,
    );
    expect(res.status).toBe(200);
    const served = (await res.json()) as OfficialExportResponse;

    const build = await withTenant(
      fx.db.sql,
      { organizationId: a.orgId, userId: a.admin.id },
      async (tx) => {
        const period = { startDate: "2026-11-02", endDate: "2026-11-04" };
        const { subjects, employeeDays } = await organizationExportSubjects(
          tx,
          period,
        );
        expect(employeeDays).toBe(subjects.length * 3);
        return buildOfficialExport(tx, {
          exportId: served.exportId,
          generatedAt: served.generatedAt,
          generatedBy: served.generatedBy,
          organizationName: served.organizationName,
          scope: "organization",
          format: "csv",
          locale: "es",
          period,
          subjects,
          timeChainKey: resolveTimeChainKey(undefined),
        });
      },
    );
    if (!build.ok) throw new Error("expected a document");
    expect(build.result.contentHash).toBe(served.contentHash);
    expect(build.result.columns).toEqual(served.columns);
    expect(build.result.metadataLines).toEqual(served.metadataLines);
    expect(build.input.timeZone).toBe(served.timeZone);
    expect(build.employees.map((e) => e.input.employeeId)).toEqual(
      served.employees.map((e) => e.employeeId),
    );
    // The hash covers the whole CSV body, so the files are identical too.
    expect(build.result.csv).toContain(`# sha256=${served.contentHash}`);
    expect(build.pdf).toBeNull();
  });

  it("refuses an employee export with an unconfigured schedule", async () => {
    const { a } = fx;
    const build = await withTenant(
      fx.db.sql,
      { organizationId: a.orgId, userId: a.admin.id },
      async (tx) => {
        const [peer] = await tx<
          {
            id: string;
            locationId: string | null;
            firstName: string;
            lastName: string;
          }[]
        >`SELECT id, location_id AS "locationId", first_name AS "firstName",
                 last_name AS "lastName" FROM employees WHERE id = ${a.peer.employeeId}`;
        return buildOfficialExport(tx, {
          exportId: "00000000-0000-4000-8000-000000000038",
          generatedAt: "2026-11-26T10:00:00.000Z",
          generatedBy: { name: "Builder", role: "admin" },
          organizationName: "Fixture",
          scope: "employee",
          format: "pdf",
          locale: "en",
          period: { startDate: "2026-11-02", endDate: "2026-11-04" },
          subjects: [peer!],
          timeChainKey: resolveTimeChainKey(undefined),
        });
      },
    );
    expect(build).toEqual({ ok: false, reason: "schedule_not_configured" });
  });
});
