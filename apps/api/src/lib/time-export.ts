import type { Context } from "hono";
import { dateInZone, type InspectionExportEmployee } from "@librehr/core";
import type { TenantTx, TimeEventRow } from "@librehr/db";
import { resolveBusinessTimeZone } from "./business-date.js";
import { verifyEmployeeChain } from "./time-export-chain.js";
import { buildTimesheet } from "./timesheet.js";

/**
 * Local dates within the period touched by a TIM-003 correction: the day of
 * the corrected time and the day of the record it replaces, both in
 * `timeZone` (the employee's).
 */
export function correctedDates(
  events: readonly TimeEventRow[],
  timeZone: string,
  startDate: string,
  endDate: string,
): string[] {
  const byId = new Map(events.map((e) => [e.id, e]));
  const dates = new Set<string>();
  for (const event of events) {
    if (!event.refEventId) continue;
    const touched = [event, byId.get(event.refEventId)];
    for (const item of touched) {
      if (!item) continue;
      const date = dateInZone(item.occurredAt, timeZone);
      if (date >= startDate && date <= endDate) dates.add(date);
    }
  }
  return [...dates].sort();
}

export interface ExportSubject {
  id: string;
  locationId: string | null;
  firstName: string;
  lastName: string;
}

export interface CollectedEmployee {
  input: InspectionExportEmployee;
  totalWorkedMinutes: number | null;
  totalOvertimeMinutes: number | null;
}

/**
 * Everything the export needs about one employee, in that employee's
 * business zone (location, else organization) whatever the export scope:
 * the period timesheet (`days: null` without a configured schedule), the
 * corrected dates and the chain status.
 *
 * Cost per employee: one bounded events query (the period plus a day on each
 * side, and the corrections linked to those events), one schedules query,
 * and one paged pass over the chain that verifies every stored row once.
 */
export async function collectExportEmployee(
  c: Context,
  tx: TenantTx,
  subject: ExportSubject,
  period: { startDate: string; endDate: string },
  timeChainKey: string,
): Promise<CollectedEmployee> {
  const timeZone = await resolveBusinessTimeZone(c, tx, subject.locationId);
  const chainStatus = await verifyEmployeeChain(tx, timeChainKey, subject.id);
  const { timesheet, events } = await buildTimesheet(c, tx, {
    employeeId: subject.id,
    locationId: subject.locationId,
    startDate: period.startDate,
    endDate: period.endDate,
    timeZone,
  });
  return {
    input: {
      employeeId: subject.id,
      name: `${subject.firstName} ${subject.lastName}`,
      timeZone,
      days: timesheet.ok ? timesheet.days : null,
      correctedDates: correctedDates(
        events,
        timeZone,
        period.startDate,
        period.endDate,
      ),
      chainStatus,
    },
    totalWorkedMinutes: timesheet.ok
      ? timesheet.summary.totalWorkedMinutes
      : null,
    totalOvertimeMinutes: timesheet.ok
      ? timesheet.summary.totalOvertimeMinutes
      : null,
  };
}
