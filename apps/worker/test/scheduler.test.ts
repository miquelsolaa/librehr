import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgBoss } from "pg-boss";
import {
  SCHEDULED_JOBS,
  SCHEDULER_CATCH_UP_DAYS,
  type ScheduledJob,
} from "@librehr/core";
import type { Sql } from "@librehr/db";

// Stand-ins for the database reads; the integration test covers the real ones.
const orgs: Array<{ organizationId: string; timeZone: string }> = [];
const locationZones = new Map<string, string[]>();
const tenantCalls: string[] = [];

vi.mock("@librehr/db", () => ({
  SchedulerRepository: class {
    async listOrganizations() {
      return orgs;
    }
    async listLocationTimeZones(tx: { org: string }) {
      return locationZones.get(tx.org) ?? [];
    }
  },
  withTenant: async (
    _sql: unknown,
    ctx: { organizationId: string },
    fn: (tx: { org: string }) => Promise<unknown>,
  ) => {
    tenantCalls.push(ctx.organizationId);
    return fn({ org: ctx.organizationId });
  },
}));

const { configureSchedule, dispatchDueJobs } =
  await import("../src/lib/scheduler.js");
const { handleSchedulerTick } = await import("../src/queues/scheduler.tick.js");
const { InvalidPayloadError } = await import("../src/lib/job-errors.js");
const { QUEUE_RETENTION } = await import("../src/lib/queue-setup.js");

const ORG_A = "a1150000-0000-4000-8000-00000000000a";
const ORG_B = "b1150000-0000-4000-8000-00000000000b";

/** A pg-boss stand-in that keeps every job and dedupes like `exclusive`. */
function fakeBoss() {
  const jobs: Array<{
    name: string;
    data: object;
    key: string;
    state: string;
  }> = [];
  return {
    jobs,
    send: vi.fn(
      async (name: string, data: object, opts: { singletonKey?: string }) => {
        const key = opts.singletonKey ?? "";
        const live = jobs.some(
          (j) =>
            j.name === name &&
            j.key === key &&
            ["created", "retry", "active"].includes(j.state),
        );
        if (live) return null;
        jobs.push({ name, data, key, state: "created" });
        return `job-${jobs.length}`;
      },
    ),
    findJobs: vi.fn(async (name: string, opts: { key: string }) =>
      jobs.filter((j) => j.name === name && j.key === opts.key),
    ),
  };
}

const logger = { info: vi.fn(), error: vi.fn() };
const sql = {} as Sql;
const clockAt = (iso: string) => ({ now: () => new Date(iso) });

beforeEach(() => {
  orgs.length = 0;
  locationZones.clear();
  tenantCalls.length = 0;
  logger.info.mockClear();
  logger.error.mockClear();
});

describe("dispatchDueJobs", () => {
  it("enqueues each due job per organization with its payload and singleton key", async () => {
    orgs.push({ organizationId: ORG_A, timeZone: "Europe/Madrid" });
    const boss = fakeBoss();
    // 00:45 on 1 November 2026 in Madrid.
    const report = await dispatchDueJobs(
      {
        sql,
        boss,
        logger,
        clock: clockAt("2026-10-31T23:45:00Z"),
        config: { enabled: true, graceMinutes: 30, jobs: SCHEDULED_JOBS },
      },
      "tick-1",
    );
    expect(report).toEqual({
      organizations: 1,
      enqueued: 8,
      alreadyEnqueued: 0,
      failed: 0,
    });
    expect(boss.jobs.map((j) => [j.name, j.key, j.data])).toEqual([
      [
        "time.close-day",
        `${ORG_A}:2026-10-30`,
        { organizationId: ORG_A, closeDate: "2026-10-30" },
      ],
      [
        "audit.verify-chain",
        `${ORG_A}:2026-10-30`,
        { organizationId: ORG_A, runDate: "2026-10-30" },
      ],
      [
        "retention.enforce",
        `${ORG_A}:2026-10-30`,
        { organizationId: ORG_A, runDate: "2026-10-30", dryRun: true },
      ],
      [
        "time.close-day",
        `${ORG_A}:2026-10-31`,
        { organizationId: ORG_A, closeDate: "2026-10-31" },
      ],
      [
        "audit.verify-chain",
        `${ORG_A}:2026-10-31`,
        { organizationId: ORG_A, runDate: "2026-10-31" },
      ],
      [
        "retention.enforce",
        `${ORG_A}:2026-10-31`,
        { organizationId: ORG_A, runDate: "2026-10-31", dryRun: true },
      ],
      [
        "leave.accrue",
        `${ORG_A}:2026-10-31`,
        { organizationId: ORG_A, runDate: "2026-10-31" },
      ],
      // Instance-wide, once per UTC day, after the organizations.
      ["retention.sweep-global", "2026-10-31", { runDate: "2026-10-31" }],
    ]);
    // Location zones are read inside the tenant's own context.
    expect(tenantCalls).toEqual([ORG_A]);
  });

  it("does not enqueue a period again once its job has run or failed", async () => {
    orgs.push({ organizationId: ORG_A, timeZone: "Europe/Madrid" });
    const boss = fakeBoss();
    const deps = {
      sql,
      boss,
      logger,
      clock: clockAt("2026-11-12T08:00:00Z"),
      config: {
        enabled: true,
        graceMinutes: 30,
        jobs: ["time.close-day"] as const,
      },
    };
    await dispatchDueJobs(deps, "tick-1");
    expect(boss.jobs).toHaveLength(2);
    boss.jobs[0]!.state = "completed";
    boss.jobs[1]!.state = "failed";

    const again = await dispatchDueJobs(deps, "tick-2");
    expect(again).toMatchObject({ enqueued: 0, alreadyEnqueued: 2 });
    expect(boss.jobs).toHaveLength(2);

    // An operator-cancelled job is enqueued again.
    boss.jobs[0]!.state = "cancelled";
    const third = await dispatchDueJobs(deps, "tick-3");
    expect(third).toMatchObject({ enqueued: 1, alreadyEnqueued: 1 });
  });

  it("waits for the organization's latest location zone", async () => {
    orgs.push({ organizationId: ORG_A, timeZone: "Europe/Madrid" });
    locationZones.set(ORG_A, ["Atlantic/Canary"]);
    const boss = fakeBoss();
    // 00:45 in Madrid, 23:45 in the Canaries on 11 November.
    await dispatchDueJobs(
      {
        sql,
        boss,
        logger,
        clock: clockAt("2026-11-11T23:45:00Z"),
        config: { enabled: true, graceMinutes: 30, jobs: ["time.close-day"] },
      },
      "tick-1",
    );
    expect(boss.jobs.map((j) => j.key)).toEqual([
      `${ORG_A}:2026-11-09`,
      `${ORG_A}:2026-11-10`,
    ]);
  });

  it("skips an organization with an invalid zone, logging its id only, and runs the rest", async () => {
    orgs.push(
      { organizationId: ORG_A, timeZone: "Not/AZone" },
      { organizationId: ORG_B, timeZone: "Europe/Madrid" },
    );
    const boss = fakeBoss();
    const report = await dispatchDueJobs(
      {
        sql,
        boss,
        logger,
        clock: clockAt("2026-11-12T08:00:00Z"),
        config: { enabled: true, graceMinutes: 30, jobs: ["time.close-day"] },
      },
      "tick-1",
    );
    expect(report).toMatchObject({ organizations: 2, enqueued: 2, failed: 1 });
    expect(logger.error).toHaveBeenCalledWith({
      msg: "scheduler skipped an organization",
      jobId: "tick-1",
      organizationId: ORG_A,
      error: "RangeError",
    });
  });
});

describe("instance retention sweep (ADM-005)", () => {
  const deps = (iso: string, jobs: readonly ScheduledJob[]) => ({
    sql,
    logger,
    clock: clockAt(iso),
    config: { enabled: true, graceMinutes: 30, jobs },
  });

  it("enqueues retention.sweep-global once per UTC day, even with no organization", async () => {
    const boss = fakeBoss();
    const first = await dispatchDueJobs(
      { ...deps("2026-11-12T00:10:00Z", ["retention.enforce"]), boss },
      "tick-1",
    );
    expect(first).toEqual({
      organizations: 0,
      enqueued: 1,
      alreadyEnqueued: 0,
      failed: 0,
    });
    boss.jobs[0]!.state = "completed";
    const sameDay = await dispatchDueJobs(
      { ...deps("2026-11-12T23:50:00Z", ["retention.enforce"]), boss },
      "tick-2",
    );
    expect(sameDay).toMatchObject({ enqueued: 0, alreadyEnqueued: 1 });
    await dispatchDueJobs(
      { ...deps("2026-11-13T00:10:00Z", ["retention.enforce"]), boss },
      "tick-3",
    );
    expect(boss.jobs.map((j) => [j.name, j.key, j.data])).toEqual([
      ["retention.sweep-global", "2026-11-12", { runDate: "2026-11-12" }],
      ["retention.sweep-global", "2026-11-13", { runDate: "2026-11-13" }],
    ]);
  });

  it("does not sweep when retention.enforce is not scheduled", async () => {
    const boss = fakeBoss();
    await dispatchDueJobs(
      { ...deps("2026-11-12T08:00:00Z", ["time.close-day"]), boss },
      "tick-1",
    );
    expect(boss.send).not.toHaveBeenCalled();
  });
});

describe("scheduler invariants", () => {
  it("catches up over fewer days than pg-boss keeps finished jobs", () => {
    // The dispatcher relies on finished jobs to skip periods already enqueued.
    expect(SCHEDULER_CATCH_UP_DAYS * 86_400).toBeLessThan(
      QUEUE_RETENTION.deleteAfterSeconds,
    );
  });

  it("ignores a tick while disabled", async () => {
    orgs.push({ organizationId: ORG_A, timeZone: "Europe/Madrid" });
    const boss = fakeBoss();
    const report = await dispatchDueJobs(
      {
        sql,
        boss,
        logger,
        clock: clockAt("2026-11-12T08:00:00Z"),
        config: { enabled: false, graceMinutes: 30, jobs: SCHEDULED_JOBS },
      },
      "tick-off",
    );
    expect(report).toMatchObject({ disabled: true, enqueued: 0 });
    expect(boss.send).not.toHaveBeenCalled();
  });
});

describe("handleSchedulerTick", () => {
  it("rejects a payload with data", async () => {
    const dispatch = vi.fn();
    await expect(
      handleSchedulerTick(
        { id: "t", data: { organizationId: ORG_A } },
        dispatch,
      ),
    ).rejects.toBeInstanceOf(InvalidPayloadError);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("dispatches with the job id", async () => {
    const dispatch = vi.fn(async (id: string) => id);
    await expect(
      handleSchedulerTick({ id: "t", data: {} }, dispatch),
    ).resolves.toBe("t");
  });
});

describe("configureSchedule", () => {
  const real = new PgBoss({ connectionString: "postgres://unused/db" });
  const admin = () => ({
    schedule: vi.fn(async () => undefined),
    unschedule: vi.fn(async () => undefined),
    // Pure: pg-boss computes occurrences without a connection.
    previewSchedule: (cron: string, opts: { tz: string; count: number }) =>
      real.previewSchedule(cron, {
        ...opts,
        from: new Date("2026-11-01T00:00:00Z"),
      }),
  });

  it.each(["0 3 * * 1", "0 0 1 * *", "0 0 */2 * *"])(
    "rejects a tick cron with gaps over 24 hours (%s)",
    async (cron) => {
      const boss = admin();
      await expect(
        configureSchedule(boss, { enabled: true, tickCron: cron }, logger),
      ).rejects.toThrow(/at least every 24 hours/);
      expect(boss.schedule).not.toHaveBeenCalled();
    },
  );

  it.each(["*/15 * * * *", "0 * * * *", "30 2 * * *"])(
    "accepts a tick cron that runs at least daily (%s)",
    async (cron) => {
      const boss = admin();
      await configureSchedule(boss, { enabled: true, tickCron: cron }, logger);
      expect(boss.schedule).toHaveBeenCalledOnce();
    },
  );

  it("installs the tick in UTC with a constant singleton key and missed-tick catch-up", async () => {
    const boss = admin();
    await configureSchedule(
      boss,
      { enabled: true, tickCron: "*/15 * * * *" },
      logger,
    );
    expect(boss.schedule).toHaveBeenCalledWith(
      "scheduler.tick",
      "*/15 * * * *",
      {},
      { tz: "UTC", singletonKey: "scheduler.tick", missed: "once" },
    );
    expect(boss.unschedule).not.toHaveBeenCalled();
  });

  it("removes a stored schedule when disabled", async () => {
    const boss = admin();
    await configureSchedule(
      boss,
      { enabled: false, tickCron: "*/15 * * * *" },
      logger,
    );
    expect(boss.unschedule).toHaveBeenCalledWith("scheduler.tick");
    expect(boss.schedule).not.toHaveBeenCalled();
  });
});
