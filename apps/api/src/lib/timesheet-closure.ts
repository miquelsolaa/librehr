import type {
  TimesheetClosureInfo,
  TimesheetClosureTotals,
} from "@librehr/contracts";
import { localPeriodBounds, monthContaining, monthPeriod } from "@librehr/core";
import { TimesheetClosureRepository, type TenantTx } from "@librehr/db";

const closureRepo = new TimesheetClosureRepository();

/**
 * The four totals of a stored snapshot (a PeriodTimesheetSummary). A
 * missing number reads as 0 rather than failing the whole response.
 */
export function closureTotals(
  snapshot: Record<string, unknown> | null,
): TimesheetClosureTotals {
  const num = (key: string) => {
    const value = snapshot?.[key];
    return typeof value === "number" ? value : 0;
  };
  return {
    totalWorkedMinutes: num("totalWorkedMinutes"),
    totalBreakMinutes: num("totalBreakMinutes"),
    totalExpectedHours: num("totalExpectedHours"),
    totalOvertimeMinutes: num("totalOvertimeMinutes"),
  };
}

/**
 * TIM-004: closure state for a timesheet response. Only a range inside one
 * calendar month is matched against that month's closure (a multi-month
 * range never carries one), and only while its newest row is a close.
 * Post-close changes are the employee's time events recorded after the
 * close that occurred in the month (local days in `timeZone`) or correct an
 * event that did; they are flagged, never blocked.
 */
export async function loadTimesheetClosure(
  tx: TenantTx,
  args: {
    employeeId: string;
    startDate: string;
    endDate: string;
    timeZone: string;
  },
): Promise<TimesheetClosureInfo | undefined> {
  const month = monthContaining(args.startDate, args.endDate);
  if (!month) return undefined;
  const period = monthPeriod(month);
  const latest = await closureRepo.findLatest(
    tx,
    args.employeeId,
    period.startDate,
  );
  if (latest?.action !== "close") return undefined;
  const bounds = localPeriodBounds(
    period.startDate,
    period.endDate,
    args.timeZone,
  );
  const changes = await closureRepo.listEventsAfterClose(
    tx,
    latest.id,
    args.employeeId,
    bounds.start,
    bounds.end,
  );
  return {
    closedAt: latest.createdAt.toISOString(),
    periodStart: latest.periodStart,
    periodEnd: latest.periodEnd,
    totals: closureTotals(latest.totals),
    postCloseChanges: changes.map((change) => ({
      eventId: change.id,
      refEventId: change.refEventId,
      createdAt: change.createdAt.toISOString(),
    })),
  };
}
