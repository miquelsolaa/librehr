import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createRoleSeparatedDatabase,
  getTestDatabase,
  type RoleSeparatedDatabase,
  type TestDatabase,
} from "@librehr/testing";
import { runMigrations } from "@librehr/db/migrate";
import {
  createDatabaseClient,
  TimeExportRepository,
  withTenant,
  type Sql,
} from "@librehr/db";
import {
  buildOfficialExport,
  organizationExportSubjects,
} from "@librehr/time-export";
import {
  handleTimeExport,
  TIME_EXPORT_FAILED_CATEGORY,
  TIME_EXPORT_READY_CATEGORY,
  type TimeExportDeps,
} from "../src/queues/time.export.js";
import { handleTimeExportDispatch } from "../src/queues/time.export-dispatch.js";
import { handleTimeExportCleanup } from "../src/queues/time.export-cleanup.js";

const KEY = "worker_test_time_chain_key_32_chars_min";
const NOW = new Date("2026-11-20T10:00:00Z");
const clock = { now: () => NOW };

// TIM-006 (issue #38): the background export against a production-like
// database (worker = librehr_owner, RLS forced; API = librehr_app).
describe("time.export (TIM-006, issue #38)", () => {
  let base: TestDatabase;
  let db: RoleSeparatedDatabase;
  let owner: Sql;
  const repo = new TimeExportRepository();
  const logger = { info: vi.fn(), error: vi.fn() };

  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database) throw new Error("Docker is required for time.export");
    base = database;
    db = await createRoleSeparatedDatabase(base);
    await runMigrations(db.ownerConnectionString);
    owner = createDatabaseClient(db.ownerConnectionString, { max: 3 });
  }, 120000);

  afterAll(async () => {
    if (owner) await owner.end();
    if (db) await db.close();
    if (base) await base.close();
  });

  const deps = (over: Partial<TimeExportDeps> = {}): TimeExportDeps => ({
    sql: owner,
    timeChainKey: KEY,
    clock,
    fileTtlHours: 168,
    maxFileBytes: 10 * 1024 * 1024,
    logger,
    ...over,
  });

  async function newOrg() {
    const orgId = randomUUID();
    await db.adminSql`
      INSERT INTO organizations (id, name, slug, timezone)
      VALUES (${orgId}, 'Exports', ${`exp-${orgId.slice(0, 8)}`}, 'Europe/Madrid')`;
    for (const name of ["Ada", "Bruno"]) {
      await db.adminSql`
        INSERT INTO employees (organization_id, first_name, last_name, email)
        VALUES (${orgId}, ${name}, 'Worker', ${`${randomUUID()}@example.invalid`})`;
    }
    return orgId;
  }

  async function member(
    orgId: string,
    role: string,
    accessExpiresAt: Date | null = null,
  ) {
    const [user] = await db.adminSql<{ id: string }[]>`
      INSERT INTO users (email, name)
      VALUES (${`${randomUUID()}@example.invalid`}, 'Requester')
      RETURNING id`;
    await db.adminSql`
      INSERT INTO memberships (organization_id, user_id, role, access_expires_at)
      VALUES (${orgId}, ${user!.id}, ${role}, ${accessExpiresAt})`;
    return user!.id;
  }

  // As the API will queue it: the runtime role, under RLS.
  const request = (orgId: string, userId: string, format: "csv" | "pdf") =>
    withTenant(db.appSql, { organizationId: orgId, userId }, (tx) =>
      repo.create(tx, {
        requestedBy: userId,
        format,
        locale: "es",
        periodStart: "2026-11-02",
        periodEnd: "2026-11-04",
        employeeDays: 6,
      }),
    ).then((row) => row!);

  const run = (orgId: string, exportId: string, over = {}) =>
    handleTimeExport(
      { id: `job-${exportId}`, data: { organizationId: orgId, exportId } },
      deps(over),
    );

  const rowOf = (orgId: string, id: string) =>
    withTenant(owner, { organizationId: orgId }, (tx) => repo.findById(tx, id));
  const auditOf = (id: string) =>
    db.adminSql<{ actorId: string; metadata: Record<string, unknown> }[]>`
      SELECT actor_id AS "actorId", metadata FROM audit_log
      WHERE action = 'time.export' AND resource_id = ${id}`;
  const notificationsOf = (userId: string) =>
    db.adminSql<{ category: string; link: string; body: string }[]>`
      SELECT category, link, body FROM notifications WHERE user_id = ${userId}
      ORDER BY created_at, id`;
  // The stored bytes (time_export_files), read as the owner under RLS.
  const storedFiles = (orgId: string) =>
    withTenant(
      owner,
      { organizationId: orgId },
      (tx) => tx<{ exportId: string; content: Buffer }[]>`
        SELECT export_id AS "exportId", content FROM time_export_files`,
    );
  const fileOf = async (orgId: string, id: string) => {
    const file = (await storedFiles(orgId)).find((f) => f.exportId === id);
    if (!file) throw new Error("no stored file");
    return file.content;
  };

  it("dispatches queued exports of every organization, ids only", async () => {
    const orgA = await newOrg();
    const orgB = await newOrg();
    const a = await request(orgA, await member(orgA, "admin"), "csv");
    const b = await request(orgB, await member(orgB, "admin"), "csv");
    const sent: object[] = [];
    const report = await handleTimeExportDispatch(
      { id: "sweep", data: {} },
      {
        sql: owner,
        send: async (p) => (sent.push(p), "job"),
        logger,
      },
    );
    expect(sent).toEqual(
      expect.arrayContaining([
        { organizationId: orgA, exportId: a.id },
        { organizationId: orgB, exportId: b.id },
      ]),
    );
    expect(report.enqueued).toBe(report.queued);
  });

  it("stores the same document the synchronous builder produces, audits and notifies once", async () => {
    const orgId = await newOrg();
    const admin = await member(orgId, "admin");
    const queued = await request(orgId, admin, "csv");

    expect(await run(orgId, queued.id)).toEqual({
      exportId: queued.id,
      outcome: "ready",
    });
    const row = (await rowOf(orgId, queued.id))!;
    expect(row).toMatchObject({
      status: "ready",
      attempts: 1,
      employeeCount: 2,
      expiresAt: new Date(NOW.getTime() + 168 * 3_600_000),
    });
    const bytes = await fileOf(orgId, queued.id);
    expect(bytes.byteLength).toBe(row.byteSize);
    expect(bytes[0]).not.toBe(0xef); // no BOM: the download adds it

    // Hash and bytes equal a build of the same period at the same instant.
    const sync = await withTenant(
      owner,
      { organizationId: orgId },
      async (tx) => {
        const period = { startDate: "2026-11-02", endDate: "2026-11-04" };
        const { subjects } = await organizationExportSubjects(tx, period);
        return buildOfficialExport(tx, {
          exportId: queued.id,
          generatedAt: NOW.toISOString(),
          generatedBy: { name: "Requester", role: "admin" },
          organizationName: "Exports",
          scope: "organization",
          format: "csv",
          locale: "es",
          period,
          subjects,
          timeChainKey: KEY,
        });
      },
    );
    if (!sync.ok) throw new Error("build refused");
    expect(row.contentHash).toBe(sync.result.contentHash);
    expect(bytes.toString("utf8")).toBe(sync.result.csv);

    const audit = await auditOf(queued.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]!.actorId).toBe(admin);
    expect(audit[0]!.metadata).toEqual({
      scope: "organization",
      format: "csv",
      locale: "es",
      periodStart: "2026-11-02",
      periodEnd: "2026-11-04",
      employeeCount: 2,
      contentHash: sync.result.contentHash,
      delivery: "async",
    });
    const notes = await notificationsOf(admin);
    expect(notes).toEqual([
      {
        category: TIME_EXPORT_READY_CATEGORY,
        link: `/time/export?job=${queued.id}`,
        body: expect.stringContaining("hasta el 2026-11-27"),
      },
    ]);
    expect(JSON.stringify(notes)).not.toContain("Ada");

    // Redelivered job: nothing new.
    expect((await run(orgId, queued.id)).outcome).toBe("skipped");
    expect(await auditOf(queued.id)).toHaveLength(1);
    expect(await notificationsOf(admin)).toHaveLength(1);
    expect(await storedFiles(orgId)).toHaveLength(1);
  });

  it("renders a PDF export", async () => {
    const orgId = await newOrg();
    const queued = await request(
      orgId,
      await member(orgId, "auditor", new Date("2027-01-01")),
      "pdf",
    );
    expect((await run(orgId, queued.id)).outcome).toBe("ready");
    const bytes = await fileOf(orgId, queued.id);
    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("fails with FORBIDDEN when the requester lost organization-wide access", async () => {
    const orgId = await newOrg();
    const auditor = await member(orgId, "auditor", new Date("2027-01-01"));
    const queued = await request(orgId, auditor, "csv");
    // The TIM-008 window closes before the job runs.
    await db.adminSql`
      UPDATE memberships SET access_expires_at = now() - interval '1 minute'
      WHERE user_id = ${auditor}`;

    expect(await run(orgId, queued.id)).toEqual({
      exportId: queued.id,
      outcome: "failed",
      errorCode: "FORBIDDEN",
    });
    expect(await rowOf(orgId, queued.id)).toMatchObject({
      status: "failed",
      errorCode: "FORBIDDEN",
      byteSize: null,
    });
    expect(await auditOf(queued.id)).toEqual([]);
    expect(await storedFiles(orgId)).toEqual([]);
    expect((await notificationsOf(auditor))[0]?.category).toBe(
      TIME_EXPORT_FAILED_CATEGORY,
    );
  });

  it("refuses a file above the size cap without storing it", async () => {
    const orgId = await newOrg();
    const queued = await request(orgId, await member(orgId, "admin"), "csv");
    expect(await run(orgId, queued.id, { maxFileBytes: 10 })).toMatchObject({
      outcome: "failed",
      errorCode: "EXPORT_TOO_LARGE",
    });
    expect(await storedFiles(orgId)).toEqual([]);
  });

  it("retries a failing run and gives up on the last attempt", async () => {
    const orgId = await newOrg();
    const admin = await member(orgId, "admin");
    const queued = await request(orgId, admin, "csv");
    // Any error inside the run's transaction (here the clock) rolls it back.
    const broken = {
      clock: {
        now: (): Date => {
          throw new Error("clock unavailable");
        },
      },
    };
    await expect(run(orgId, queued.id, broken)).rejects.toThrow();
    await expect(run(orgId, queued.id, broken)).rejects.toThrow();
    expect(await run(orgId, queued.id, broken)).toMatchObject({
      outcome: "failed",
      errorCode: "EXPORT_FAILED",
    });
    expect(await rowOf(orgId, queued.id)).toMatchObject({
      status: "failed",
      attempts: 3,
    });
    expect(await auditOf(queued.id)).toEqual([]);
    expect(await storedFiles(orgId)).toEqual([]);
  });

  it("does nothing for an export id of another organization", async () => {
    const orgA = await newOrg();
    const orgB = await newOrg();
    const queued = await request(orgA, await member(orgA, "admin"), "csv");
    expect((await run(orgB, queued.id)).outcome).toBe("skipped");
    expect(await rowOf(orgA, queued.id)).toMatchObject({
      status: "queued",
      attempts: 0,
    });
  });

  it("deletes expired files, keeps the record and fails and notifies stalled runs", async () => {
    const orgId = await newOrg();
    const done = await request(orgId, await member(orgId, "admin"), "csv");
    expect((await run(orgId, done.id)).outcome).toBe("ready");
    const stuckBy = await member(orgId, "admin");
    const stuck = await request(orgId, stuckBy, "csv");
    await withTenant(owner, { organizationId: orgId }, (tx) =>
      repo.claim(tx, stuck.id),
    );
    // Claimed at the fake NOW, not the database clock.
    await db.adminSql`
      UPDATE time_exports SET started_at = ${NOW} WHERE id = ${stuck.id}`;

    // Before expiry nothing changes.
    await handleTimeExportCleanup(
      { id: "cleanup-1", data: {} },
      { sql: owner, clock, logger },
    );
    expect((await rowOf(orgId, done.id))!.status).toBe("ready");
    expect(await storedFiles(orgId)).toHaveLength(1);
    expect(await notificationsOf(stuckBy)).toEqual([]);

    const later = { now: () => new Date(NOW.getTime() + 169 * 3_600_000) };
    const report = await handleTimeExportCleanup(
      { id: "cleanup-2", data: {} },
      { sql: owner, clock: later, logger },
    );
    expect(report.failed).toBe(0);
    expect(report.expired).toBeGreaterThanOrEqual(1);
    expect(await rowOf(orgId, done.id)).toMatchObject({
      status: "expired",
      byteSize: expect.any(Number),
      contentHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(await storedFiles(orgId)).toEqual([]);
    expect(await auditOf(done.id)).toHaveLength(1);
    expect(await rowOf(orgId, stuck.id)).toMatchObject({
      status: "failed",
      errorCode: "EXPORT_STALLED",
    });
    // The requester of the stalled export is told, in the export's locale.
    expect(await notificationsOf(stuckBy)).toEqual([
      {
        category: TIME_EXPORT_FAILED_CATEGORY,
        link: `/time/export?job=${stuck.id}`,
        body: expect.stringContaining("2026-11-02"),
      },
    ]);
    // A second sweep does not notify again.
    await handleTimeExportCleanup(
      { id: "cleanup-3", data: {} },
      { sql: owner, clock: later, logger },
    );
    expect(await notificationsOf(stuckBy)).toHaveLength(1);
  });

  it("cannot leave stored bytes behind their export row", async () => {
    const orgId = await newOrg();
    const queued = await request(orgId, await member(orgId, "admin"), "csv");
    expect((await run(orgId, queued.id)).outcome).toBe("ready");
    expect(await storedFiles(orgId)).toHaveLength(1);
    // Removing the export row (or its organization, which cascades to it)
    // removes the bytes: no file can exist without the row that tracks it.
    await db.adminSql`DELETE FROM time_exports WHERE id = ${queued.id}`;
    expect(await storedFiles(orgId)).toEqual([]);
  });
});
