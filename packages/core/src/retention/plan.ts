import { Temporal } from "temporal-polyfill";
import {
  RETENTION_CATEGORIES,
  RETENTION_CATEGORY_DEFINITIONS,
  isRetentionCategory,
  type RetentionAction,
  type RetentionBasis,
  type RetentionCategory,
} from "./categories.js";

/** A period an organization configured (a `retention_policies` row). */
export interface ConfiguredRetentionPolicy {
  category: string;
  retentionDays: number;
}

export interface RetentionPlanInput {
  /** Local day the run covers, `YYYY-MM-DD` (the scheduler's runDate). */
  runDate: string;
  /** The organization's IANA time zone. */
  timeZone: string;
  configured?: readonly ConfiguredRetentionPolicy[];
}

export interface RetentionPlanEntry {
  category: RetentionCategory;
  action: RetentionAction;
  basis: RetentionBasis;
  /** Period applied: the configured one, raised to the legal floor if lower. */
  retentionDays: number;
  legalMinimumDays: number | null;
  source: "default" | "configured";
  /** First local day still kept, `YYYY-MM-DD`. Earlier days are eligible. */
  cutoffDate: string;
  /** Start of `cutoffDate` in the time zone. Earlier instants are eligible. */
  cutoffInstant: Date;
}

/**
 * The first local day a period of `retentionDays` still keeps on `runDate`,
 * and the instant that day starts in `timeZone` (DST-aware: on a day that
 * starts at 01:00 the instant is 01:00). A record whose basis falls on local
 * day D is eligible when D + retentionDays <= runDate, i.e. D < cutoffDate.
 *
 * @example
 * retentionCutoff("2026-11-26", 30, "Europe/Madrid");
 * // => { cutoffDate: "2026-10-28",
 * //      cutoffInstant: new Date("2026-10-27T23:00:00Z") }
 */
export function retentionCutoff(
  runDate: string,
  retentionDays: number,
  timeZone: string,
): { cutoffDate: string; cutoffInstant: Date } {
  if (!Number.isInteger(retentionDays) || retentionDays < 1) {
    throw new RangeError("retentionDays must be a positive integer");
  }
  const day = Temporal.PlainDate.from(runDate, { overflow: "reject" }).subtract(
    { days: retentionDays - 1 },
  );
  const start = day.toZonedDateTime({ timeZone });
  return {
    cutoffDate: day.toString(),
    cutoffInstant: new Date(start.epochMilliseconds),
  };
}

/**
 * The retention plan of one organization for one run: every category with
 * its applied period and cutoff. Categories without a configured row use the
 * default. A configured period below a legal floor is raised to the floor
 * (the database CHECK already rejects it; this is defence in depth).
 *
 * @example
 * planRetention({
 *   runDate: "2026-11-26",
 *   timeZone: "Europe/Madrid",
 *   configured: [{ category: "notifications", retentionDays: 180 }],
 * }).find((entry) => entry.category === "notifications");
 * // => { retentionDays: 180, source: "configured", cutoffDate: "2026-05-31", ... }
 */
export function planRetention(input: RetentionPlanInput): RetentionPlanEntry[] {
  const configured = new Map<RetentionCategory, number>();
  for (const policy of input.configured ?? []) {
    if (!isRetentionCategory(policy.category)) {
      throw new RangeError(`unknown retention category: ${policy.category}`);
    }
    configured.set(policy.category, policy.retentionDays);
  }

  return RETENTION_CATEGORIES.map((category) => {
    const definition = RETENTION_CATEGORY_DEFINITIONS[category];
    const own = configured.get(category);
    const retentionDays = Math.max(
      own ?? definition.defaultDays,
      definition.legalMinimumDays ?? 1,
    );
    return {
      category,
      action: definition.action,
      basis: definition.basis,
      retentionDays,
      legalMinimumDays: definition.legalMinimumDays,
      source: own === undefined ? "default" : "configured",
      ...retentionCutoff(input.runDate, retentionDays, input.timeZone),
    };
  });
}
