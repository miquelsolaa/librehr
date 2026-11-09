import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  getTestDatabase,
  seedScopedOrg,
  type FixturePerson,
  type ScopedOrgFixture,
  type TestDatabase,
} from "@librehr/testing";
import { runMigrations } from "@librehr/db/migrate";
import { TimeRepository, withTenant } from "@librehr/db";
import type { OfficialExportResponse } from "@librehr/contracts";
import { createApp } from "../src/app.js";
import {
  createTimeChainSigner,
  resolveTimeChainKey,
} from "../src/lib/time-chain.js";
import { as, fixtureAuthPort } from "./support/fixture-app.js";

// TIM-006 Labour Inspectorate export: formats, content hash, scope and the
// ADM-002 audit entry, per AGENTS §6 (success, validation, 401, 403, tenant).
const PERIOD = "startDate=2026-11-02&endDate=2026-11-04";
const sign = createTimeChainSigner(resolveTimeChainKey(undefined));

describe("GET /v1/time/export (TIM-006)", () => {
  let db: TestDatabase;
  let app: ReturnType<typeof createApp>;
  let a: ScopedOrgFixture;
  let b: ScopedOrgFixture;

  const get = (path: string, person?: FixturePerson) =>
    app.request(path, person ? { headers: as(person) } : {});

  const assignSchedule = async (employeeId: string) => {
    const rules = Array.from({ length: 7 }, (_, i) => ({
      dayOfWeek: i + 1,
      expectedHours: i < 5 ? 8 : 0,
      breakMinutes: 0,
    }));
    const res = await app.request("/v1/schedules/assignments", {
      method: "POST",
      headers: as(a.admin, true),
      body: JSON.stringify({
        employeeId,
        name: "Office",
        effectiveFrom: "2026-01-01",
        minimumDailyRestHours: 12,
        rules,
      }),
    });
    expect(res.status).toBe(201);
  };

  const exportAudits = () =>
    withTenant(
      db.sql,
      { organizationId: a.orgId },
      (tx) => tx<
        { resourceId: string; resourceType: string; metadata: unknown }[]
      >`
        SELECT resource_id::text AS "resourceId", resource_type AS "resourceType", metadata
        FROM audit_log WHERE action = 'time.export' ORDER BY created_at`,
    );

  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database) throw new Error("Docker is required for this suite");
    db = database;
    await runMigrations(db.connectionString);
    a = await seedScopedOrg(db.sql, "tx-a");
    b = await seedScopedOrg(db.sql, "tx-b");
    await db.sql`UPDATE organizations SET timezone = 'Europe/Madrid' WHERE id = ${a.orgId}`;
    // Left before the period: never part of an organization export.
    await db.sql`
      INSERT INTO employees (organization_id, first_name, last_name, email, status, termination_date)
      VALUES (${a.orgId}, 'Former', 'Leaver', 'former@fixture.invalid', 'terminated', '2026-01-31')`;
    app = createApp({
      sql: await db.appSql(),
      authPort: fixtureAuthPort([
        a.admin,
        a.manager,
        a.report,
        a.peer,
        a.auditor,
        b.admin,
      ]),
      // The rate limit has its own test (time-export-integrity.int.test.ts).
      timeExport: { rateLimit: { windowMs: 60_000, max: 1000 } },
    });
    // The peer stays unconfigured on purpose.
    for (const person of [a.admin, a.manager, a.report, a.auditor]) {
      await assignSchedule(person.employeeId);
    }
    await withTenant(
      db.sql,
      { organizationId: a.orgId, userId: a.report.id },
      async (tx) => {
        const repo = new TimeRepository();
        const punch = (eventType: "clock_in" | "clock_out", at: string) =>
          repo.appendEvent(tx, sign, {
            organizationId: a.orgId,
            employeeId: a.report.employeeId,
            eventType,
            occurredAt: new Date(at),
            source: "web",
            actorId: a.report.id,
          });
        await punch("clock_in", "2026-11-02T08:00:00Z");
        await punch("clock_out", "2026-11-02T16:00:00Z");
        await punch("clock_in", "2026-11-03T08:00:00Z");
        const out = await punch("clock_out", "2026-11-03T15:00:00Z");
        // TIM-003: a correction is a new event referencing the original.
        await repo.appendEvent(tx, sign, {
          organizationId: a.orgId,
          employeeId: a.report.employeeId,
          eventType: "clock_out",
          occurredAt: new Date("2026-11-03T16:00:00Z"),
          source: "manual",
          actorId: a.manager.id,
          refEventId: out.id,
          reason: "Forgot to clock out",
        });
      },
    );
  }, 90000);

  afterAll(async () => {
    if (db) await db.close();
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
