import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { Temporal } from "temporal-polyfill";
import {
  SCHEDULED_JOBS,
  SCHEDULER_CATCH_UP_DAYS,
  dueScheduledJobs,
  lastClosedLocalDate,
  type DueJob,
  type ScheduledJob,
} from "../src/scheduler/due-jobs.js";

const MADRID = ["Europe/Madrid"];
const at = (iso: string) => new Date(iso);
const daily = (job: ScheduledJob, ...dates: string[]): DueJob[] =>
  dates.map((date) => ({ job, date }));

describe("lastClosedLocalDate", () => {
  it("closes a day only once local midnight plus the grace has passed", () => {
    // Madrid is UTC+1 on 3 November 2026: midnight is 23:00 UTC.
    expect(lastClosedLocalDate(at("2026-11-02T23:29:59Z"), MADRID, 30)).toBe(
      "2026-11-01",
    );
    expect(lastClosedLocalDate(at("2026-11-02T23:30:00Z"), MADRID, 30)).toBe(
      "2026-11-02",
    );
    expect(lastClosedLocalDate(at("2026-11-02T23:00:00Z"), MADRID, 0)).toBe(
      "2026-11-02",
    );
  });

  it("follows the spring-forward day (23 hours) in Madrid", () => {
    // 29 March 2026 starts at 23:00 UTC on the 28th (CET) and ends at 22:00
    // UTC on the 29th (CEST).
    expect(lastClosedLocalDate(at("2026-03-28T23:29:00Z"), MADRID, 30)).toBe(
      "2026-03-27",
    );
    expect(lastClosedLocalDate(at("2026-03-28T23:30:00Z"), MADRID, 30)).toBe(
      "2026-03-28",
    );
    expect(lastClosedLocalDate(at("2026-03-29T22:29:00Z"), MADRID, 30)).toBe(
      "2026-03-28",
    );
    expect(lastClosedLocalDate(at("2026-03-29T22:30:00Z"), MADRID, 30)).toBe(
      "2026-03-29",
    );
  });

  it("follows the fall-back day (25 hours) in Madrid", () => {
    // 25 October 2026 starts at 22:00 UTC on the 24th (CEST) and ends at
    // 23:00 UTC on the 25th (CET).
    expect(lastClosedLocalDate(at("2026-10-24T22:30:00Z"), MADRID, 30)).toBe(
      "2026-10-24",
    );
    expect(lastClosedLocalDate(at("2026-10-25T22:30:00Z"), MADRID, 30)).toBe(
      "2026-10-24",
    );
    expect(lastClosedLocalDate(at("2026-10-25T23:29:00Z"), MADRID, 30)).toBe(
      "2026-10-24",
    );
    expect(lastClosedLocalDate(at("2026-10-25T23:30:00Z"), MADRID, 30)).toBe(
      "2026-10-25",
    );
  });

  it("waits for the latest zone of the organization (Canary is an hour behind)", () => {
    const zones = ["Europe/Madrid", "Atlantic/Canary"];
    // 00:45 in Madrid is 23:45 in the Canaries: 2 November is still running there.
    expect(lastClosedLocalDate(at("2026-11-02T23:45:00Z"), zones, 30)).toBe(
      "2026-11-01",
    );
    expect(lastClosedLocalDate(at("2026-11-03T00:30:00Z"), zones, 30)).toBe(
      "2026-11-02",
    );
    // The order of the zones does not matter.
    expect(
      lastClosedLocalDate(at("2026-11-02T23:45:00Z"), [...zones].reverse(), 30),
    ).toBe("2026-11-01");
  });

  it("rejects an invalid grace, no zones or an unknown zone", () => {
    const now = at("2026-11-02T12:00:00Z");
    expect(() => lastClosedLocalDate(now, MADRID, -1)).toThrow(RangeError);
    expect(() => lastClosedLocalDate(now, MADRID, 1.5)).toThrow(RangeError);
    expect(() => lastClosedLocalDate(now, MADRID, 721)).toThrow(RangeError);
    expect(() => lastClosedLocalDate(now, [], 30)).toThrow(RangeError);
    expect(() => lastClosedLocalDate(now, ["Not/AZone"], 30)).toThrow();
  });
});

describe("dueScheduledJobs", () => {
  it("returns the daily jobs of the last closed days, oldest first", () => {
    const due = dueScheduledJobs({
      instant: at("2026-11-12T08:00:00Z"),
      timeZones: MADRID,
      graceMinutes: 30,
    });
    expect(due).toEqual([
      { job: "time.close-day", date: "2026-11-10" },
      { job: "audit.verify-chain", date: "2026-11-10" },
      { job: "retention.enforce", date: "2026-11-10" },
      { job: "time.close-day", date: "2026-11-11" },
      { job: "audit.verify-chain", date: "2026-11-11" },
      { job: "retention.enforce", date: "2026-11-11" },
    ]);
  });

  it("accrues the just-ended month once its last day has closed", () => {
    const opts = {
      timeZones: MADRID,
      graceMinutes: 30,
      jobs: ["leave.accrue"] as const,
    };
    // 00:15 on 1 November in Madrid: October has not closed yet.
    expect(
      dueScheduledJobs({ ...opts, instant: at("2026-10-31T23:15:00Z") }),
    ).toEqual([]);
    // 00:45 on 1 November.
    expect(
      dueScheduledJobs({ ...opts, instant: at("2026-10-31T23:45:00Z") }),
    ).toEqual(daily("leave.accrue", "2026-10-31"));
    // Still returned on the 2nd (catch-up), gone on the 3rd.
    expect(
      dueScheduledJobs({ ...opts, instant: at("2026-11-02T12:00:00Z") }),
    ).toEqual(daily("leave.accrue", "2026-10-31"));
    expect(
      dueScheduledJobs({ ...opts, instant: at("2026-11-03T12:00:00Z") }),
    ).toEqual([]);
  });

  it("crosses the year boundary in local time, not UTC", () => {
    // 00:45 on 1 January 2027 in Madrid is still 31 December in UTC.
    const due = dueScheduledJobs({
      instant: at("2026-12-31T23:45:00Z"),
      timeZones: MADRID,
      graceMinutes: 30,
      jobs: ["time.close-day", "leave.accrue"],
    });
    expect(due).toEqual([
      { job: "time.close-day", date: "2026-12-30" },
      { job: "time.close-day", date: "2026-12-31" },
      { job: "leave.accrue", date: "2026-12-31" },
    ]);
  });

  it("accrues February up to the leap day in leap years only", () => {
    const opts = {
      timeZones: MADRID,
      graceMinutes: 30,
      jobs: ["leave.accrue"] as const,
    };
    expect(
      dueScheduledJobs({ ...opts, instant: at("2028-03-01T06:00:00Z") }),
    ).toEqual(daily("leave.accrue", "2028-02-29"));
    expect(
      dueScheduledJobs({ ...opts, instant: at("2027-03-01T06:00:00Z") }),
    ).toEqual(daily("leave.accrue", "2027-02-28"));
    // 28 February 2028 is not the end of the month.
    expect(
      dueScheduledJobs({ ...opts, instant: at("2028-02-29T06:00:00Z") }),
    ).toEqual([]);
  });

  it("closes the spring-forward and fall-back days once they have ended", () => {
    const opts = {
      timeZones: MADRID,
      graceMinutes: 30,
      jobs: ["time.close-day"] as const,
    };
    expect(
      dueScheduledJobs({ ...opts, instant: at("2026-03-29T22:30:00Z") }),
    ).toEqual(daily("time.close-day", "2026-03-28", "2026-03-29"));
    expect(
      dueScheduledJobs({ ...opts, instant: at("2026-10-25T23:30:00Z") }),
    ).toEqual(daily("time.close-day", "2026-10-24", "2026-10-25"));
  });

  it("catches up at most the last closed days after a long outage", () => {
    const due = dueScheduledJobs({
      instant: at("2026-11-20T08:00:00Z"),
      timeZones: MADRID,
      graceMinutes: 30,
      jobs: ["time.close-day"],
    });
    expect(due).toHaveLength(SCHEDULER_CATCH_UP_DAYS);
    expect(due.at(-1)).toEqual({ job: "time.close-day", date: "2026-11-19" });
  });

  it("returns nothing when no job is selected", () => {
    expect(
      dueScheduledJobs({
        instant: at("2026-11-12T08:00:00Z"),
        timeZones: MADRID,
        graceMinutes: 30,
        jobs: [],
      }),
    ).toEqual([]);
  });
});

// Independent oracle: the instant a period ending on `date` becomes due is
// the latest local midnight after it, over all zones, plus the grace.
function dueInstantMs(date: string, zones: readonly string[], grace: number) {
  const next = Temporal.PlainDate.from(date).add({ days: 1 });
  let latest = -Infinity;
  for (const zone of zones) {
    latest = Math.max(latest, next.toZonedDateTime(zone).epochMilliseconds);
  }
  return latest + grace * 60_000;
}

/** The last day whose period is due at `t`, found by walking back from UTC. */
function closedThrough(t: number, zones: readonly string[], grace: number) {
  let day = Temporal.Instant.fromEpochMilliseconds(t)
    .toZonedDateTimeISO("UTC")
    .toPlainDate()
    .add({ days: 2 });
  while (dueInstantMs(day.toString(), zones, grace) > t) {
    day = day.subtract({ days: 1 });
  }
  return day;
}

const ZONE_SETS = [
  ["Europe/Madrid"],
  ["Atlantic/Canary"],
  ["Europe/Madrid", "Atlantic/Canary"],
  ["UTC"],
  ["America/New_York", "Europe/Madrid"],
  ["Pacific/Auckland"],
  ["Australia/Lord_Howe"],
] as const;

describe("dueScheduledJobs properties", () => {
  it("enqueues each (job, period) exactly once, never early, for any tick spacing", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ZONE_SETS),
        fc.integer({ min: 0, max: 180 }),
        // Any start between 2026 and 2029 (covers a leap year and DST changes).
        fc.integer({
          min: Date.UTC(2026, 0, 1),
          max: Date.UTC(2029, 0, 1),
        }),
        // Gaps from one minute to 36 hours: ticks at any granularity, and a
        // worker that is down for a day and a half.
        fc.array(fc.integer({ min: 1, max: 36 * 60 }), {
          minLength: 1,
          maxLength: 120,
        }),
        fc.subarray([...SCHEDULED_JOBS], { minLength: 1 }),
        (zones, grace, start, gaps, jobs) => {
          // What the dispatcher dedupes on: the job's singleton key.
          const sent = new Map<string, number>();
          let t = start;
          const ticks = [t];
          for (const gap of gaps) ticks.push((t += gap * 60_000));

          for (const tick of ticks) {
            for (const d of dueScheduledJobs({
              instant: new Date(tick),
              timeZones: zones,
              graceMinutes: grace,
              jobs,
            })) {
              // Never before the period has ended everywhere, plus grace.
              expect(dueInstantMs(d.date, zones, grace)).toBeLessThanOrEqual(
                tick,
              );
              const key = `${d.job}:${d.date}`;
              if (!sent.has(key)) sent.set(key, tick);
            }
          }

          // Expected: every period due between the first tick's catch-up
          // window and the last tick, computed without the scheduler.
          const first = closedThrough(ticks[0]!, zones, grace).subtract({
            days: SCHEDULER_CATCH_UP_DAYS - 1,
          });
          const last = closedThrough(ticks.at(-1)!, zones, grace);
          const expected = new Set<string>();
          for (
            let day = first;
            Temporal.PlainDate.compare(day, last) <= 0;
            day = day.add({ days: 1 })
          ) {
            for (const job of jobs) {
              if (job === "leave.accrue" && day.day !== day.daysInMonth) {
                continue;
              }
              expected.add(`${job}:${day.toString()}`);
            }
          }
          expect(new Set(sent.keys())).toEqual(expected);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("is idempotent: the same instant always yields the same jobs", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ZONE_SETS),
        fc.integer({ min: Date.UTC(2026, 0, 1), max: Date.UTC(2029, 0, 1) }),
        (zones, t) => {
          const input = {
            instant: new Date(t),
            timeZones: zones,
            graceMinutes: 30,
          };
          expect(dueScheduledJobs(input)).toEqual(dueScheduledJobs(input));
        },
      ),
    );
  });
});
