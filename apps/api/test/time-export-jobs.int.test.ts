import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FixturePerson } from "@librehr/testing";
import type { TimeExportJob } from "@librehr/contracts";
import { createApp } from "../src/app.js";
import { createLocalExportFileReader } from "../src/lib/export-files.js";
import { isolatedRateLimitStore } from "./support/rate-limit.js";
import { as, fixtureAuthPort } from "./support/fixture-app.js";
import {
  PERIOD,
  setupTimeExportFixture,
  type TimeExportFixture,
} from "./support/time-export-fixture.js";

// TIM-006 (issue #38): queue, status and download of background organization
// exports. The worker's side has its own suite; here a "ready" export is a
// row and file set up the way the worker leaves them.
const BODY = { format: "csv", startDate: "2026-11-02", endDate: "2026-11-04" };

describe("/v1/time/exports (TIM-006 background exports)", () => {
  let f: TimeExportFixture;
  let storageDir: string;
  let auditor: FixturePerson;
  let app: ReturnType<typeof createApp>;
  let csv: Buffer;
  let csvHash: string;

  const appWith = async (
    timeExport: Parameters<typeof createApp>[0]["timeExport"] = {},
  ) =>
    createApp({
      sql: await f.db.appSql(),
      authPort: fixtureAuthPort([
        f.a.admin,
        f.a.manager,
        f.a.report,
        f.a.auditor,
        f.b.admin,
        auditor,
      ]),
      rateLimitStore: isolatedRateLimitStore(await f.db.appSql()),
      timeExportFiles: createLocalExportFileReader(storageDir),
      timeExport: {
        rateLimit: { windowMs: 60_000, max: 1000 },
        jobsRateLimit: { windowMs: 60_000, max: 1000 },
        ...timeExport,
      },
    });

  const post = (person: FixturePerson | null, body: unknown, on = app) =>
    on.request("/v1/time/exports", {
      method: "POST",
      headers: person
        ? as(person, true)
        : { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  const get = (url: string, person: FixturePerson, on = app) =>
    on.request(url, { headers: as(person) });

  // Superuser connection: filter by organization explicitly.
  const auditRows = (action: string) =>
    f.db.sql<{ resourceId: string; actorId: string; metadata: unknown }[]>`
      SELECT resource_id::text AS "resourceId", actor_id::text AS "actorId", metadata
      FROM audit_log WHERE organization_id = ${f.a.orgId} AND action = ${action}
      ORDER BY created_at`;

  /** A finished export, as the worker leaves it: file on disk, row ready. */
  const readyExport = async (
    person: FixturePerson,
    options: { expiresAt?: Date; file?: boolean } = {},
  ) => {
    const id = randomUUID();
    const key = `time-exports/${f.a.orgId}/${id}-1.csv`;
    if (options.file !== false) {
      await mkdir(path.join(storageDir, path.dirname(key)), {
        recursive: true,
      });
      await writeFile(path.join(storageDir, key), csv);
    }
    await f.db.sql`
      INSERT INTO time_exports (id, organization_id, requested_by, format, locale,
        period_start, period_end, employee_days, status, attempts, content_hash,
        employee_count, byte_size, storage_key, started_at, completed_at, expires_at)
      VALUES (${id}, ${f.a.orgId}, ${person.id}, 'csv', 'es', '2026-11-02',
        '2026-11-04', 15, 'ready', 1, ${csvHash}, 5, ${csv.byteLength}, ${key},
        now(), now(), ${options.expiresAt ?? new Date(Date.now() + 3_600_000)})`;
    return id;
  };

  beforeAll(async () => {
    f = await setupTimeExportFixture("txj");
    storageDir = await mkdtemp(path.join(tmpdir(), "librehr-exports-"));
    // An auditor of org A whose TIM-008 window can be closed by a test.
    const id = randomUUID();
    const email = `auditor-${id.slice(0, 8)}@fixture.invalid`;
    await f.db
      .sql`INSERT INTO users (id, email, name) VALUES (${id}, ${email}, 'Fixture auditor')`;
    await f.db.sql`
      INSERT INTO memberships (organization_id, user_id, role, access_expires_at)
      VALUES (${f.a.orgId}, ${id}, 'auditor', now() + interval '30 days')`;
    auditor = {
      id,
      email,
      name: "Fixture auditor",
      role: "auditor",
      organizationId: f.a.orgId,
      employeeId: "",
    };
    app = await appWith();
    // The stored file is the synchronous CSV without its BOM (as the worker
    // writes it).
    const res = await get(
      `/v1/time/export?${PERIOD}&scope=organization&format=csv`,
      f.a.admin,
    );
    expect(res.status).toBe(200);
    csv = Buffer.from(await res.arrayBuffer()).subarray(3);
    csvHash = res.headers.get("x-content-sha256") ?? "";
  }, 120000);

  afterAll(async () => {
    if (storageDir) await rm(storageDir, { recursive: true, force: true });
    if (f) await f.db.close();
  });

  it("queues an export (202) without building, auditing or storing anything", async () => {
    const audits = (await auditRows("time.export")).length;
    const res = await post(f.a.admin, BODY);
    expect(res.status).toBe(202);
    const job = (await res.json()) as TimeExportJob;
    expect(res.headers.get("location")).toBe(
      `/v1/time/exports/${job.exportId}`,
    );
    expect(job).toMatchObject({
      status: "queued",
      scope: "organization",
      format: "csv",
      locale: "es",
      periodStart: "2026-11-02",
      periodEnd: "2026-11-04",
      contentHash: null,
      expiresAt: null,
    });
    expect(job.employeeDays).toBeGreaterThan(0);
    expect(job).not.toHaveProperty("storageKey");
    expect(job).not.toHaveProperty("requestedBy");
    expect((await auditRows("time.export")).length).toBe(audits);

    const status = await get(`/v1/time/exports/${job.exportId}`, f.a.admin);
    expect(status.status).toBe(200);
    expect(await status.json()).toEqual(job);
    const list = await get("/v1/time/exports", f.a.admin);
    const { items } = (await list.json()) as { items: TimeExportJob[] };
    expect(items[0]).toEqual(job);

    // One queued or running export per requester.
    const again = await post(f.a.admin, { ...BODY, format: "pdf" });
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ code: "EXPORT_IN_PROGRESS" });
    // Not downloadable until the worker finishes it.
    const early = await get(
      `/v1/time/exports/${job.exportId}/download`,
      f.a.admin,
    );
    expect(early.status).toBe(409);
    expect(await early.json()).toMatchObject({ code: "EXPORT_NOT_READY" });
  });

  it.each([
    ["json format", { ...BODY, format: "json" }],
    ["employee scope", { ...BODY, scope: "employee" }],
    ["end before start", { ...BODY, endDate: "2026-11-01" }],
    ["a period over 366 days", { ...BODY, endDate: "2027-11-04" }],
    ["malformed JSON", "{"],
  ])("refuses %s with 400", async (_, body) => {
    const res = await post(f.a.auditor, body);
    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toContain(
      "application/problem+json",
    );
  });

  it("refuses an export over the async cap with 422", async () => {
    const capped = await appWith({ asyncMaxEmployeeDays: 1 });
    const res = await post(f.a.auditor, BODY, capped);
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: "EXPORT_TOO_LARGE" });
  });

  it("answers 401 without a session", async () => {
    expect((await post(null, BODY)).status).toBe(401);
    expect((await app.request("/v1/time/exports")).status).toBe(401);
  });

  it.each([
    ["a manager (reports scope)", () => f.a.manager],
    ["an employee", () => f.a.report],
  ])("forbids %s", async (_, person) => {
    expect((await post(person(), BODY)).status).toBe(403);
    expect((await get("/v1/time/exports", person())).status).toBe(403);
  });

  it("caps queued and running exports per organization at 3", async () => {
    const others = [randomUUID(), randomUUID(), randomUUID()];
    for (const requester of others) {
      await f.db.sql`
        INSERT INTO time_exports (organization_id, requested_by, format, locale,
          period_start, period_end, employee_days)
        VALUES (${f.a.orgId}, ${requester}, 'csv', 'es', '2026-11-02', '2026-11-04', 9)`;
    }
    try {
      const res = await post(auditor, BODY);
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: "EXPORT_IN_PROGRESS" });
    } finally {
      await f.db.sql`
        UPDATE time_exports SET status = 'failed', error_code = 'EXPORT_FAILED'
        WHERE organization_id = ${f.a.orgId} AND status IN ('queued', 'running')
          AND requested_by <> ${f.a.admin.id}`;
    }
  });

  it("downloads a ready export with the synchronous headers and audits it", async () => {
    const id = await readyExport(f.a.auditor);
    const res = await get(`/v1/time/exports/${id}/download`, f.a.auditor);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-export-id")).toBe(id);
    expect(res.headers.get("x-content-sha256")).toBe(csvHash);
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="registro-jornada-2026-11-02-2026-11-04.csv"',
    );
    const bytes = Buffer.from(await res.arrayBuffer());
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(bytes.subarray(3).equals(csv)).toBe(true);
    // COMPLIANCE.md recipe: the BOM and the signature line are not hashed.
    const text = bytes.subarray(3).toString("utf8");
    const body = text.slice(0, text.lastIndexOf("# sha256="));
    expect(createHash("sha256").update(body, "utf8").digest("hex")).toBe(
      csvHash,
    );

    const audits = (await auditRows("time.export.download")).filter(
      (row) => row.resourceId === id,
    );
    expect(audits).toHaveLength(1);
    expect(audits[0]?.actorId).toBe(f.a.auditor.id);
    expect(audits[0]?.metadata).toEqual({
      format: "csv",
      contentHash: csvHash,
    });
  });

  it("answers 404 to anyone but the requester, in any tenant, and serves no bytes", async () => {
    const id = await readyExport(f.a.auditor);
    const before = (await auditRows("time.export.download")).length;
    for (const person of [f.a.admin, f.b.admin, f.a.manager]) {
      for (const url of [
        `/v1/time/exports/${id}`,
        `/v1/time/exports/${id}/download`,
      ]) {
        const res = await get(url, person);
        expect(res.status).toBe(404);
        expect(await res.text()).not.toContain(csvHash);
      }
    }
    expect((await get("/v1/time/exports/not-a-uuid", f.a.auditor)).status).toBe(
      404,
    );
    expect((await auditRows("time.export.download")).length).toBe(before);
  });

  it("answers 410 once the file expired or is gone", async () => {
    const past = await readyExport(f.a.auditor, {
      expiresAt: new Date(Date.now() - 1000),
    });
    const missing = await readyExport(f.a.auditor, { file: false });
    const swept = await readyExport(f.a.auditor);
    await f.db
      .sql`UPDATE time_exports SET status = 'expired', storage_key = NULL WHERE id = ${swept}`;
    for (const id of [past, missing, swept]) {
      const res = await get(`/v1/time/exports/${id}/download`, f.a.auditor);
      expect(res.status).toBe(410);
      expect(await res.json()).toMatchObject({ code: "EXPORT_EXPIRED" });
    }
  });

  it("hides the export from an auditor whose TIM-008 window closed", async () => {
    const id = await readyExport(auditor);
    expect((await get(`/v1/time/exports/${id}/download`, auditor)).status).toBe(
      200,
    );
    await f.db.sql`
      UPDATE memberships SET access_expires_at = now() - interval '1 minute'
      WHERE organization_id = ${f.a.orgId} AND user_id = ${auditor.id}`;
    try {
      expect((await get(`/v1/time/exports/${id}`, auditor)).status).toBe(404);
      expect(
        (await get(`/v1/time/exports/${id}/download`, auditor)).status,
      ).toBe(404);
      expect((await post(auditor, BODY)).status).toBe(403);
    } finally {
      await f.db.sql`
        UPDATE memberships SET access_expires_at = now() + interval '30 days'
        WHERE organization_id = ${f.a.orgId} AND user_id = ${auditor.id}`;
    }
  });

  it("rate-limits the export routes per user with 429", async () => {
    const limited = await appWith({
      jobsRateLimit: { windowMs: 60_000, max: 2 },
    });
    expect((await get("/v1/time/exports", f.a.auditor, limited)).status).toBe(
      200,
    );
    expect((await get("/v1/time/exports", f.a.auditor, limited)).status).toBe(
      200,
    );
    const res = await get("/v1/time/exports", f.a.auditor, limited);
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ code: "RATE_LIMIT_EXCEEDED" });
  });
});
