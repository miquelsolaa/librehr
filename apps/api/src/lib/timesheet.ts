import type { Context } from "hono";
import type { TenantTx } from "@librehr/db";
import {
  buildTimesheet as buildTimesheetInTx,
  type LoadedTimesheet,
  type TimesheetArgs,
} from "@librehr/time-export";
import { businessZoneResolver } from "./business-date.js";

/**
 * TIM-004/TIM-005 timesheet of one employee for a request: the shared
 * builder with the request's cached business time zones.
 */
export function buildTimesheet(
  c: Context,
  tx: TenantTx,
  args: TimesheetArgs,
): Promise<LoadedTimesheet> {
  return buildTimesheetInTx(tx, args, businessZoneResolver(c, tx));
}
