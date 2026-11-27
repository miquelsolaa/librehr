import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PgBoss } from "pg-boss";
import {
  createRoleSeparatedDatabase,
  getTestDatabase,
  type RoleSeparatedDatabase,
  type TestDatabase,
} from "@librehr/testing";
import { runMigrations } from "@librehr/db/migrate";
import { createDatabaseClient, withTenant, type Sql } from "@librehr/db";
import { SCHEDULED_JOBS } from "@librehr/core";
import { ensureQueues } from "../src/lib/queue-setup.js";
import { configureSchedule, dispatchDueJobs } from "../src/lib/scheduler.js";

// Issue #115: the dispatcher against a production-like database (owner role,
// RLS forced) and a real pg-boss, as the worker runs it.
describe("scheduler dispatcher (issue #115)", () => {
  let base: TestDatabase;
  let db: RoleSeparatedDatabase;
  let owner: Sql;
  let boss: PgBoss;
  const orgA = "a1150000-0000-4000-8000-0000000000a1";
  const orgB = "b1150000-0000-4000-8000-0000000000b1";
  const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };

  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database) throw new Error("Docker is required for the scheduler");
    base = database;
    db = await createRoleSeparatedDatabase(base);
    await runMigrations(db.ownerConnectionString);
    // The worker's role: librehr_owner, which also owns the pg-boss schema.
    owner = createDatabaseClient(db.ownerConnectionString, { max: 3 });
    boss = new PgBoss({
      connectionString: db.ownerConnectionString,
      schema: "pgboss",
    });
    boss.on("error", () => {});
    await boss.start();
    await ensureQueues(boss, logger);

    await db.adminSql`INSERT INTO organizations (id, name, slug, timezone) VALUES
      (${orgA}, 'Tick A', 'tick-a', 'Europe/Madrid'),
      (${orgB}, 'Tick B', 'tick-b', 'Europe/Madrid')`;
    // orgB has a location in the Canaries, an hour behind Madrid.
    await withTenant(db.adminSql, { organizationId: orgB }, async (tx) => {
      await tx`INSERT INTO locations (organization_id, name, city, timezone)
        VALUES (${orgB}, 'Las Palmas', 'Las Palmas', 'Atlantic/Canary')`;
    });
  }, 120000);

  afterAll(async () => {
    if (boss) await boss.stop({ graceful: false });
    if (owner) await owner.end();
    if (db) await db.close();
    if (base) await base.close();
  });

  const jobsIn = async () =>
    db.adminSql<{ name: string; key: string; state: string; data: object }[]>`
      SELECT name, singleton_key AS key, state::text AS state, data
      FROM pgboss.job
      WHERE name = ANY(${[...SCHEDULED_JOBS]})
      ORDER BY name, singleton_key`;

  const tick = (iso: string, jobId = "tick") =>
    dispatchDueJobs(
      {
        sql: owner,
        boss,
        logger,
        clock: { now: () => new Date(iso) },
        config: { enabled: true, graceMinutes: 30, jobs: SCHEDULED_JOBS },
      },
      jobId,
    );

  it("enqueues each organization's due jobs once in its local time, across repeated and late ticks", async () => {
    // 00:45 on 1 November in Madrid; 23:45 on 31 October in the Canaries.
    const first = await tick("2026-10-31T23:45:00Z", "tick-1");
    expect(first).toEqual({
      organizations: 2,
      // orgA: 30 and 31 October x 3 daily jobs + October's accrual. orgB:
      // 31 October has not closed in the Canaries yet, so its window is
      // 29 and 30 October and October is not accrued yet. Plus the
      // instance retention sweep of UTC day 31 October.
      enqueued: 7 + 6 + 1,
      alreadyEnqueued: 0,
      failed: 0,
    });

    // The same tick again, and a later one in the same window: nothing new
    // for orgA; orgB's 31 October has now closed in the Canaries too.
    const again = await tick("2026-10-31T23:45:00Z", "tick-2");
    expect(again).toMatchObject({ enqueued: 0, alreadyEnqueued: 14 });
    // tick-3 falls on a new UTC day, so the sweep runs again.
    const later = await tick("2026-11-01T00:45:00Z", "tick-3");
    expect(later).toMatchObject({ enqueued: 4 + 1, failed: 0 });
    const sweeps = await db.adminSql<{ key: string; data: object }[]>`
      SELECT singleton_key AS key, data FROM pgboss.job
      WHERE name = 'retention.sweep-global' ORDER BY singleton_key`;
    expect(sweeps).toEqual([
      { key: "2026-10-31", data: { runDate: "2026-10-31" } },
      { key: "2026-11-01", data: { runDate: "2026-11-01" } },
    ]);

    const jobs = await jobsIn();
    const keys = jobs.map((j) => `${j.name} ${j.key}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const name of [
      "time.close-day",
      "audit.verify-chain",
      "retention.enforce",
    ]) {
      expect(keys).toContain(`${name} ${orgB}:2026-10-29`);
    }
    for (const org of [orgA, orgB]) {
      for (const name of [
        "time.close-day",
        "audit.verify-chain",
        "retention.enforce",
      ]) {
        expect(keys).toContain(`${name} ${org}:2026-10-30`);
        expect(keys).toContain(`${name} ${org}:2026-10-31`);
      }
      expect(keys).toContain(`leave.accrue ${org}:2026-10-31`);
    }
    expect(jobs).toHaveLength(17);
    expect(
      jobs.find(
        (j) => j.name === "time.close-day" && j.key === `${orgB}:2026-10-31`,
      )?.data,
    ).toEqual({ organizationId: orgB, closeDate: "2026-10-31" });
  });

  it("does not enqueue a period again after its job completed", async () => {
    const [job] = await boss.fetch("leave.accrue");
    expect(job).toBeDefined();
    await boss.complete("leave.accrue", job!.id);

    const after = await tick("2026-11-01T06:00:00Z", "tick-4");
    expect(after.enqueued).toBe(0);
    expect(await jobsIn()).toHaveLength(17);
  });

  it("installs the tick schedule in pg-boss and removes it when disabled", async () => {
    await configureSchedule(
      boss,
      { enabled: true, tickCron: "*/15 * * * *" },
      logger,
    );
    const schedules = await boss.getSchedules("scheduler.tick");
    expect(schedules).toHaveLength(1);
    expect(schedules[0]).toMatchObject({
      name: "scheduler.tick",
      cron: "*/15 * * * *",
    });

    await configureSchedule(
      boss,
      { enabled: false, tickCron: "*/15 * * * *" },
      logger,
    );
    expect(await boss.getSchedules("scheduler.tick")).toEqual([]);
  });
});
