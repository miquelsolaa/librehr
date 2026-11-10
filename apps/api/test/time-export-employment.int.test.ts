import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ScopedOrgFixture } from "@librehr/testing";
import type { OfficialExportResponse } from "@librehr/contracts";
import { TimeRepository, withTenant } from "@librehr/db";
import {
  createTimeChainSigner,
  resolveTimeChainKey,
} from "../src/lib/time-chain.js";
import { as } from "./support/fixture-app.js";
import {
  PERIOD,
  setupTimeExportFixture,
  type TimeExportFixture,
} from "./support/time-export-fixture.js";

// TIM-006: days outside an employee's employment periods are flagged as not
// employed and expect nothing, in every format: never a fake absence.
const EMPLOYED = 11;
const EXPECTED = 5;
const DIFFERENCE = 6;

describe("GET /v1/time/export employment days (TIM-006)", () => {
  let fx: TimeExportFixture;
  let a: ScopedOrgFixture;
  let formerReportId: string;
  let newHireId: string;

  const insertReport = async (lastName: string) => {
    const [row] = await fx.db.sql<{ id: string }[]>`
      INSERT INTO employees (organization_id, manager_id, first_name, last_name, email)
      VALUES (${a.orgId}, ${a.manager.employeeId}, 'Fixture', ${lastName},
              ${`${lastName.toLowerCase()}-txemp@fixture.invalid`})
      RETURNING id`;
    return row!.id;
  };
  const employment = (employeeId: string, start: string, end: string | null) =>
    fx.db.sql`
      INSERT INTO employments (organization_id, employee_id, job_title, start_date, end_date)
      VALUES (${a.orgId}, ${employeeId}, 'Employee', ${start}, ${end})`;
  const exportJson = async (query: string) => {
    const res = await fx.get(`/v1/time/export?${query}`, a.manager);
    expect(res.status).toBe(200);
    return (await res.json()) as OfficialExportResponse;
  };

  beforeAll(async () => {
    fx = await setupTimeExportFixture("txemp");
    a = fx.a;
    // A direct report whose employment ended before the period, with no
    // schedule at all: before TIM-006 employment days this was a 409.
    formerReportId = await insertReport("Former");
    await employment(formerReportId, "2025-01-01", "2026-06-30");
    // A direct report hired on the period's second day, who clocked in the
    // day before (recorded work is never hidden).
    newHireId = await insertReport("Newhire");
    await employment(newHireId, "2026-11-03", null);
    const res = await fx.app.request("/v1/schedules/assignments", {
      method: "POST",
      headers: as(a.admin, true),
      body: JSON.stringify({
        employeeId: newHireId,
        name: "Office",
        effectiveFrom: "2026-11-03",
        minimumDailyRestHours: 12,
        rules: Array.from({ length: 7 }, (_, i) => ({
          dayOfWeek: i + 1,
          expectedHours: i < 5 ? 8 : 0,
          breakMinutes: 0,
        })),
      }),
    });
    expect(res.status).toBe(201);
    const sign = createTimeChainSigner(resolveTimeChainKey(undefined));
    await withTenant(fx.db.sql, { organizationId: a.orgId }, async (tx) => {
      const repo = new TimeRepository();
      for (const [eventType, at] of [
        ["clock_in", "2026-11-02T08:00:00Z"],
        ["clock_out", "2026-11-02T10:00:00Z"],
      ] as const) {
        await repo.appendEvent(tx, sign, {
          organizationId: a.orgId,
          employeeId: newHireId,
          eventType,
          occurredAt: new Date(at),
          source: "web",
          actorId: a.manager.id,
        });
      }
    });
  }, 90000);

  afterAll(async () => {
    if (fx) await fx.db.close();
  });

  it("exports a former report's period as not employed, never as absent", async () => {
    const doc = await exportJson(
      `${PERIOD}&employeeId=${formerReportId}&locale=en`,
    );
    expect(doc.columns[EMPLOYED]).toBe("Employed");
    expect(doc.rows.map((cells) => cells[1])).toEqual([
      "2026-11-02",
      "2026-11-03",
      "2026-11-04",
    ]);
    for (const cells of doc.rows) {
      expect(cells[EMPLOYED]).toBe("No");
      expect(cells[EXPECTED]).toBe("0");
      expect(cells[DIFFERENCE]).toBe("0");
    }
    expect(doc.rowsEmployed).toEqual([false, false, false]);
    expect(doc.employees[0]).toMatchObject({
      scheduleConfigured: true,
      totalWorkedMinutes: 0,
      totalOvertimeMinutes: 0,
    });
  });

  it("signs the former report's CSV with a hash that recomputes", async () => {
    const res = await fx.get(
      `/v1/time/export?${PERIOD}&employeeId=${formerReportId}&format=csv`,
      a.manager,
    );
    expect(res.status).toBe(200);
    const csv = Buffer.from(await res.arrayBuffer())
      .subarray(3)
      .toString("utf8");
    const signatureAt = csv.lastIndexOf("# sha256=");
    const hash = createHash("sha256")
      .update(csv.slice(0, signatureAt), "utf8")
      .digest("hex");
    expect(csv.slice(signatureAt)).toBe(`# sha256=${hash}\r\n`);
    expect(res.headers.get("x-content-sha256")).toBe(hash);
    expect(csv).toContain(",Contratado\r\n");
    expect(csv.match(/,No\r\n/g)).toHaveLength(3);
  });

  it("flags the days before a mid-period hire, keeping the work recorded on them", async () => {
    const doc = await exportJson(`${PERIOD}&employeeId=${newHireId}&locale=en`);
    expect(doc.rowsEmployed).toEqual([false, true, true]);
    const [before, hired] = doc.rows;
    expect(before?.slice(1, 7)).toEqual([
      "2026-11-02",
      "09:00-11:00",
      "0",
      "120",
      "0",
      "120",
    ]);
    expect(before?.[EMPLOYED]).toBe("No");
    expect(hired?.[EXPECTED]).toBe("480");
    expect(hired?.[EMPLOYED]).toBe("Yes");
    expect(doc.employees[0]).toMatchObject({
      totalWorkedMinutes: 120,
      totalOvertimeMinutes: 120 - 2 * 480,
    });
  });

  it("includes the flag in the organization export", async () => {
    const res = await fx.get(
      `/v1/time/export?${PERIOD}&scope=organization&locale=en`,
      a.admin,
    );
    expect(res.status).toBe(200);
    const doc = (await res.json()) as OfficialExportResponse;
    expect(doc.rowsEmployed).toHaveLength(doc.rows.length);
    const rowsOf = (name: string) =>
      doc.rows.flatMap((cells, i) =>
        cells[0] === name ? [[cells[EMPLOYED], doc.rowsEmployed[i]]] : [],
      );
    expect(rowsOf("Fixture Newhire")).toEqual([
      ["No", false],
      ["Yes", true],
      ["Yes", true],
    ]);
    // Legacy employees (no employment records) are employed every day.
    expect(rowsOf("Fixture report")).toEqual([
      ["Yes", true],
      ["Yes", true],
      ["Yes", true],
    ]);
    // Without a schedule: one row, no flag.
    expect(rowsOf("Fixture peer")).toEqual([["", null]]);
    // Not employed and no recorded work: not listed at all.
    expect(rowsOf("Fixture Former")).toEqual([]);
  });

  it("still answers 409 when an employed day has no schedule", async () => {
    const res = await fx.get(
      `/v1/time/export?${PERIOD}&employeeId=${a.peer.employeeId}`,
      a.admin,
    );
    expect(res.status).toBe(409);
  });
});
