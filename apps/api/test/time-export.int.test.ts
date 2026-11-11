import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FixturePerson, ScopedOrgFixture } from "@librehr/testing";
import type { OfficialExportResponse } from "@librehr/contracts";
import {
  PERIOD,
  setupTimeExportFixture,
  type TimeExportFixture,
} from "./support/time-export-fixture.js";

// TIM-006 Labour Inspectorate export: formats, content hash, validation and
// the ADM-002 audit entry, per AGENTS §6. Authorization and tenant isolation
// live in time-export-authz.int.test.ts.
describe("GET /v1/time/export (TIM-006)", () => {
  let fx: TimeExportFixture;
  let a: ScopedOrgFixture;

  const get = (path: string, person?: FixturePerson) => fx.get(path, person);
  const exportAudits = () => fx.exportAudits();

  beforeAll(async () => {
    fx = await setupTimeExportFixture("tx");
    a = fx.a;
  }, 90000);

  afterAll(async () => {
    if (fx) await fx.db.close();
  });

  it("returns the JSON document with hash, metadata, corrections and chain status", async () => {
    const res = await get(
      `/v1/time/export?${PERIOD}&employeeId=${a.report.employeeId}&locale=en`,
      a.manager,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const doc = (await res.json()) as OfficialExportResponse;
    expect(res.headers.get("x-export-id")).toBe(doc.exportId);
    expect(res.headers.get("x-content-sha256")).toBe(doc.contentHash);
    expect(doc).toMatchObject({
      scope: "employee",
      locale: "en",
      periodStart: "2026-11-02",
      periodEnd: "2026-11-04",
      timeZone: "Europe/Madrid",
      generatedBy: { name: a.manager.name, role: "manager" },
    });
    expect(doc.employees).toEqual([
      {
        employeeId: a.report.employeeId,
        name: "Fixture report",
        timeZone: "Europe/Madrid",
        scheduleConfigured: true,
        chainStatus: "verified",
        totalWorkedMinutes: 960,
        totalOvertimeMinutes: -480,
      },
    ]);
    expect(doc.columns[8]).toBe("Corrected");
    const byDate = new Map(doc.rows.map((cells) => [cells[1], cells]));
    expect(byDate.get("2026-11-02")?.[2]).toBe("09:00-17:00");
    expect(byDate.get("2026-11-02")?.[8]).toBe("No");
    expect(byDate.get("2026-11-03")?.[2]).toBe("09:00-17:00");
    expect(byDate.get("2026-11-03")?.[8]).toBe("Yes");
    expect(byDate.get("2026-11-03")?.[9]).toBe("Verified");
    expect(doc.columns[10]).toBe("Time zone");
    expect(byDate.get("2026-11-03")?.[10]).toBe("Europe/Madrid");
    expect(doc.metadataLines).toContain(`Export id: ${doc.exportId}`);
  });

  it("returns a BOM-prefixed CSV whose body hashes to the signature line", async () => {
    const res = await get(`/v1/time/export?${PERIOD}&format=csv`, a.report);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    const prefix = a.report.employeeId.slice(0, 8);
    expect(res.headers.get("content-disposition")).toBe(
      `attachment; filename="registro-jornada-2026-11-02-2026-11-04-${prefix}.csv"`,
    );
    const bytes = Buffer.from(await res.arrayBuffer());
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const csv = bytes.subarray(3).toString("utf8");
    const signatureAt = csv.lastIndexOf("# sha256=");
    const body = csv.slice(0, signatureAt);
    const hash = createHash("sha256").update(body, "utf8").digest("hex");
    expect(csv.slice(signatureAt)).toBe(`# sha256=${hash}\r\n`);
    expect(res.headers.get("x-content-sha256")).toBe(hash);
    expect(body).toContain("Registro de jornada");
  });

  it("returns a PDF that carries the export id and hash", async () => {
    const res = await get(`/v1/time/export?${PERIOD}&format=pdf`, a.report);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toMatch(
      /^attachment; filename="registro-jornada-2026-11-02-2026-11-04-[0-9a-f]{8}\.pdf"$/,
    );
    const pdf = Buffer.from(await res.arrayBuffer()).toString("latin1");
    expect(pdf.startsWith("%PDF-1.4")).toBe(true);
    expect(pdf).toContain(res.headers.get("x-content-sha256") ?? "missing");
    expect(pdf).toContain(res.headers.get("x-export-id") ?? "missing");
  });

  it.each([
    ["admin", () => a.admin],
    ["auditor", () => a.auditor],
  ])("exports the whole organization as %s", async (_, person) => {
    const res = await get(
      `/v1/time/export?${PERIOD}&scope=organization&locale=en`,
      person(),
    );
    expect(res.status).toBe(200);
    const doc = (await res.json()) as OfficialExportResponse;
    expect(doc.scope).toBe("organization");
    expect(doc.employees.map((e) => e.name)).toEqual([
      "Fixture admin",
      "Fixture auditor",
      "Fixture manager",
      "Fixture peer",
      "Fixture report",
    ]);
    const peer = doc.employees.find((e) => e.employeeId === a.peer.employeeId);
    expect(peer).toMatchObject({
      scheduleConfigured: false,
      totalWorkedMinutes: null,
    });
    const peerRows = doc.rows.filter((cells) => cells[0] === "Fixture peer");
    expect(peerRows).toEqual([
      expect.arrayContaining(["", "Schedule not configured"]),
    ]);
    expect(doc.rows).toHaveLength(4 * 3 + 1);
  });

  it.each([
    ["an impossible date", "startDate=2026-02-30&endDate=2026-03-02"],
    ["an end before the start", "startDate=2026-11-04&endDate=2026-11-02"],
    ["a period over 366 days", "startDate=2025-01-01&endDate=2026-01-02"],
    ["an unknown format", `${PERIOD}&format=xml`],
    ["an unknown locale", `${PERIOD}&locale=fr`],
    ["an unknown scope", `${PERIOD}&scope=team`],
    [
      "an employee id with organization scope",
      `${PERIOD}&scope=organization&employeeId=11111111-1111-4111-8111-111111111111`,
    ],
  ])("rejects %s with a 400 problem", async (_, query) => {
    const res = await get(`/v1/time/export?${query}`, a.admin);
    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toContain(
      "application/problem+json",
    );
    expect(await res.json()).toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("accepts a full leap year period", async () => {
    const res = await get(
      "/v1/time/export?startDate=2028-01-01&endDate=2028-12-31",
      a.report,
    );
    expect(res.status).toBe(200);
  });

  it("answers 409 for an employee without a configured schedule", async () => {
    const res = await get(
      `/v1/time/export?${PERIOD}&employeeId=${a.peer.employeeId}`,
      a.admin,
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "SCHEDULE_NOT_CONFIGURED" });
  });

  it("writes exactly one audit entry per export, without personal data", async () => {
    const before = (await exportAudits()).length;
    const denied = await get(
      `/v1/time/export?${PERIOD}&scope=organization`,
      a.manager,
    );
    expect(denied.status).toBe(403);
    expect((await exportAudits()).length).toBe(before);

    const one = await get(
      `/v1/time/export?${PERIOD}&employeeId=${a.report.employeeId}&format=pdf&locale=ca`,
      a.admin,
    );
    expect(one.status).toBe(200);
    const org = await get(
      `/v1/time/export?${PERIOD}&scope=organization&format=csv`,
      a.auditor,
    );
    expect(org.status).toBe(200);

    const audits = await exportAudits();
    expect(audits).toHaveLength(before + 2);
    const [employeeEntry, orgEntry] = audits.slice(before);
    expect(employeeEntry).toEqual({
      resourceId: one.headers.get("x-export-id"),
      resourceType: "time_export",
      metadata: {
        scope: "employee",
        format: "pdf",
        locale: "ca",
        periodStart: "2026-11-02",
        periodEnd: "2026-11-04",
        employeeCount: 1,
        contentHash: one.headers.get("x-content-sha256"),
        employeeId: a.report.employeeId,
      },
    });
    expect(orgEntry).toEqual({
      resourceId: org.headers.get("x-export-id"),
      resourceType: "time_export",
      metadata: {
        scope: "organization",
        format: "csv",
        locale: "es",
        periodStart: "2026-11-02",
        periodEnd: "2026-11-04",
        employeeCount: 5,
        contentHash: org.headers.get("x-content-sha256"),
      },
    });
    const stored = JSON.stringify(audits.slice(before));
    expect(stored).not.toMatch(/Fixture|@|fixture\.invalid/);
  });
});
