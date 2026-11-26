import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createRoleSeparatedDatabase,
  getTestDatabase,
  type RoleSeparatedDatabase,
  type TestDatabase,
} from "@librehr/testing";
import { runMigrations } from "@librehr/db/migrate";
import { createDatabaseClient, withTenant, type Sql } from "@librehr/db";
import { handleRetentionEnforce } from "../src/queues/retention.enforce.js";
import { handleRetentionSweepGlobal } from "../src/queues/retention.sweep-global.js";

// ADM-005 (issue #32): the dry-run report against a production-like database
// (the worker's owner role, RLS forced). Nothing may be deleted.
describe("retention.enforce dry-run report (ADM-005)", () => {
  let base: TestDatabase;
  let db: RoleSeparatedDatabase;
  let owner: Sql;
  const orgA = randomUUID();
  const orgB = randomUUID();
  const userId = randomUUID();
  const RUN_DATE = "2026-11-26";
  const TITLE = "Confidential payroll title";

  async function seed(org: string): Promise<void> {
    await db.adminSql`INSERT INTO organizations (id, name, slug, timezone)
      VALUES (${org}, ${org}, ${org}, 'Europe/Madrid')`;
    await withTenant(db.adminSql, { organizationId: org }, async (tx) => {
      const doc = (
        category: string,
        createdAt: string,
        deletedAt: string | null,
      ) =>
        tx`INSERT INTO documents (title, category, created_by_id, created_at, deleted_at)
          VALUES (${TITLE}, ${category}, ${userId}, ${createdAt}, ${deletedAt})`;
      // Past the 30-day grace (cutoff 2026-10-28 in Madrid).
      await doc("other", "2026-01-01T00:00:00Z", "2026-10-01T00:00:00Z");
      // Statutory and older than 4 years: eligible.
      await doc("contracts", "2020-01-01T00:00:00Z", "2026-10-01T00:00:00Z");
      // Statutory but younger than 4 years: held back.
      await doc("payslips", "2025-01-01T00:00:00Z", "2026-10-01T00:00:00Z");
      // Still in grace, and live.
      await doc("other", "2026-01-01T00:00:00Z", "2026-11-20T00:00:00Z");
      await doc("other", "2026-01-01T00:00:00Z", null);
      await tx`INSERT INTO audit_log (action, resource_type, created_at)
        VALUES ('test.old', 'organization', '2020-06-01T00:00:00Z')`;
    });
  }

  const run = (organizationId: string, dryRun?: boolean) => {
    const logger = { info: vi.fn() };
    const data =
      dryRun === undefined
        ? { organizationId, runDate: RUN_DATE }
        : { organizationId, runDate: RUN_DATE, dryRun };
    return {
      logger,
      result: handleRetentionEnforce(
        { id: "job-r", data },
        { sql: owner, logger },
      ),
    };
  };

  const countAll = async () => {
    const rows = await db.adminSql<{ docs: number; audit: number }[]>`
      SELECT (SELECT count(*) FROM documents)::int AS docs,
             (SELECT count(*) FROM audit_log WHERE action = 'test.old')::int AS audit`;
    return rows[0];
  };

  const runEntries = (org: string) =>
    db.adminSql<{ resourceId: string; metadata: Record<string, unknown> }[]>`
      SELECT resource_id AS "resourceId", metadata FROM audit_log
      WHERE organization_id = ${org} AND action = 'retention.run'
      ORDER BY created_at, id`;

  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database) throw new Error("Docker is required for retention tests");
    base = database;
    db = await createRoleSeparatedDatabase(base);
    await runMigrations(db.ownerConnectionString);
    owner = createDatabaseClient(db.ownerConnectionString, { max: 2 });
    await db.adminSql`INSERT INTO users (id, email, name)
      VALUES (${userId}, 'retention-worker@example.invalid', 'Retention')`;
    await seed(orgA);
    await seed(orgB);
  }, 120000);

  afterAll(async () => {
    if (owner) await owner.end();
    if (db) await db.close();
    if (base) await base.close();
  });

  it("reports eligible counts per category, deletes nothing and audits the run with counts only", async () => {
    const before = await countAll();
    const { result, logger } = run(orgA);
    const report = await result;

    expect(report).toMatchObject({
      organizationId: orgA,
      runDate: RUN_DATE,
      dryRun: true,
    });
    expect(report.categories.deleted_documents).toEqual({
      action: "report_only",
      retentionDays: 30,
      source: "default",
      cutoffDate: "2026-10-28",
      eligible: 2,
    });
    expect(report.categories.statutory_documents.eligible).toBe(1);
    expect(report.categories.audit_log.eligible).toBe(1);
    expect(report.categories.time_records).toMatchObject({
      retentionDays: 1461,
      eligible: 0,
    });
    for (const category of Object.values(report.categories)) {
      expect(category.action).toBe("report_only");
    }

    expect(await countAll()).toEqual(before);

    const entries = await runEntries(orgA);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      resourceId: orgA,
      metadata: {
        runDate: RUN_DATE,
        dryRun: true,
        enforced: false,
        categories: { deleted_documents: { eligible: 2 } },
      },
    });
    const written = JSON.stringify([entries, logger.info.mock.calls]);
    expect(written).not.toContain(TITLE);
    expect(written).not.toContain("example.invalid");
  });

  it("never counts or audits another organization's rows", async () => {
    // orgB holds identical data; orgA's counts stay its own.
    const report = await run(orgA).result;
    expect(report.categories.deleted_documents.eligible).toBe(2);
    expect(report.categories.audit_log.eligible).toBe(1);
    expect(await runEntries(orgB)).toHaveLength(0);
  });

  it("treats dryRun: false as a dry run and is safe to re-run", async () => {
    const before = await countAll();
    const first = await run(orgB, false).result;
    const second = await run(orgB, false).result;
    expect(first.dryRun).toBe(true);
    expect(second).toEqual(first);
    expect(await countAll()).toEqual(before);
    expect(await runEntries(orgB)).toHaveLength(2);
  });

  it("applies the organization's configured period and its time zone", async () => {
    const org = randomUUID();
    await db.adminSql`INSERT INTO organizations (id, name, slug, timezone)
      VALUES (${org}, ${org}, ${org}, 'Atlantic/Canary')`;
    await withTenant(db.adminSql, { organizationId: org }, async (tx) => {
      await tx`INSERT INTO retention_policies (category, retention_days)
        VALUES ('deleted_documents', 60)`;
      await tx`INSERT INTO documents (title, category, created_by_id, deleted_at)
        VALUES ('Doc', 'other', ${userId}, '2026-09-27T22:30:00Z'),
               ('Doc', 'other', ${userId}, '2026-09-27T23:30:00Z')`;
    });
    const report = await run(org).result;
    // Cutoff 2026-09-28 starts at 2026-09-27T23:00Z in the Canaries, so only
    // the first delete (22:30Z, still 27 September there) is eligible.
    expect(report.categories.deleted_documents).toMatchObject({
      retentionDays: 60,
      source: "configured",
      cutoffDate: "2026-09-28",
      eligible: 1,
    });
  });

  it("rejects an unknown organization id format without writing anything", async () => {
    await expect(run("not-a-uuid").result).rejects.toThrow(
      /invalid retention.enforce payload/,
    );
  });
});

describe("retention.sweep-global (ADM-005)", () => {
  let base: TestDatabase;
  let db: RoleSeparatedDatabase;
  let owner: Sql;
  const userId = randomUUID();

  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database) throw new Error("Docker is required for retention tests");
    base = database;
    db = await createRoleSeparatedDatabase(base);
    await runMigrations(db.ownerConnectionString);
    owner = createDatabaseClient(db.ownerConnectionString, { max: 1 });
    await db.adminSql`INSERT INTO users (id, email, name)
      VALUES (${userId}, 'sweep@example.invalid', 'Sweep')`;
  }, 120000);

  afterAll(async () => {
    if (owner) await owner.end();
    if (db) await db.close();
    if (base) await base.close();
  });

  it("deletes password reset links older than 30 days and keeps newer ones", async () => {
    await db.adminSql`INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, created_at)
      VALUES (${userId}, ${randomUUID()}, now() - interval '31 days', now() - interval '31 days'),
             (${userId}, ${randomUUID()}, now() - interval '1 day', now() - interval '29 days')`;
    const logger = { info: vi.fn() };
    const report = await handleRetentionSweepGlobal(
      { id: "job-s", data: { runDate: "2026-11-26" } },
      { sql: owner, logger },
    );
    expect(report).toEqual({
      runDate: "2026-11-26",
      passwordResetTokensDeleted: 1,
    });
    const left = await db.adminSql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM password_reset_tokens`;
    expect(left[0]?.n).toBe(1);
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain(
      "example.invalid",
    );
  });
});
