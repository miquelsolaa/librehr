import { beforeEach, describe, expect, it, vi } from "vitest";
import { SCHEDULED_JOBS } from "@librehr/core";
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
        config: { graceMinutes: 30, jobs: SCHEDULED_JOBS },
      },
      "tick-1",
    );
    expect(report).toEqual({
      organizations: 1,
      enqueued: 7,
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
        { organizationId: ORG_A, runDate: "2026-10-30" },
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
        { organizationId: ORG_A, runDate: "2026-10-31" },
      ],
      [
        "leave.accrue",
        `${ORG_A}:2026-10-31`,
        { organizationId: ORG_A, runDate: "2026-10-31" },
      ],
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
      config: { graceMinutes: 30, jobs: ["time.close-day"] as const },
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
        config: { graceMinutes: 30, jobs: ["time.close-day"] },
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
        config: { graceMinutes: 30, jobs: ["time.close-day"] },
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
  const admin = () => ({
    schedule: vi.fn(async () => undefined),
    unschedule: vi.fn(async () => undefined),
  });

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
