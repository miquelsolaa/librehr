import { z } from "zod";
import {
  addDays,
  coveredByOvernightShift,
  localPeriodBounds,
  openAtDayEnd,
  type ScheduledShift,
  type TimeEvent,
} from "@librehr/core";
import {
  withTenant,
  NotificationRepository,
  OrganizationRepository,
  ShiftRepository,
  TimeRepository,
  type OnceNotificationCategory,
  type Sql,
  type TimeEventRow,
} from "@librehr/db";
import { missingClockOutNotification } from "@librehr/emails";
import { isoDate, parsePayload } from "../lib/payload.js";

export const TimeCloseDayPayloadSchema = z.object({
  organizationId: z.guid(),
  closeDate: z.string().regex(isoDate),
});

export type TimeCloseDayPayload = z.input<typeof TimeCloseDayPayloadSchema>;

export const timeCloseDaySingletonKey = (
  p: z.output<typeof TimeCloseDayPayloadSchema>,
) => `${p.organizationId}:${p.closeDate}`;

export const MISSING_CLOCK_OUT_CATEGORY: OnceNotificationCategory =
  "time_missing_clock_out";

export interface TimeCloseDayDeps {
  sql: Sql;
  logger: { info(obj: object): void; error(obj: object): void };
}

export interface TimeCloseDayReport {
  organizationId: string;
  closeDate: string;
  employeesChecked: number;
  /** Employees left clocked in or on a break at the end of the day. */
  open: number;
  /**
   * Employees still clocked in at midnight because their rostered shift for
   * the day runs past it; not reminded and not counted in `open`.
   */
  overnight: number;
  notified: number;
  /** Employees whose events could not be read or folded (logged by id). */
  failed: number;
}

function toTimeEvent(row: TimeEventRow): TimeEvent {
  return {
    id: row.id,
    organizationId: row.organizationId,
    employeeId: row.employeeId,
    eventType: row.eventType as TimeEvent["eventType"],
    occurredAt: row.occurredAt.toISOString(),
    recordedAt: row.recordedAt.toISOString(),
    source: row.source as TimeEvent["source"],
    actorId: row.actorId,
    ...(row.refEventId ? { refEventId: row.refEventId } : {}),
    prevHash: row.prevHash,
    hash: row.hash,
  };
}

/**
 * TIM-003: after a local day ends, reminds every employee whose events left
 * them clocked in or on a break that day, so they can request a correction.
 *
 * The day is the employee's business day (location zone, else organization
 * zone). Events from the day before are read too, so a session opened the
 * day before is known; later events are not needed (`openAtDayEnd`).
 * Employees without a user account have no inbox and are skipped.
 *
 * Night shifts: a session opened on the day and still open at midnight is
 * not reminded when the employee's rostered shift for the day (shift
 * assignment and template) runs past midnight (`coveredByOvernightShift`);
 * the next day's run checks it was closed. Without a roster entry the
 * session is reported, since events alone cannot tell a night shift from a
 * forgotten clock-out.
 *
 * Notifications are stored as rendered text (like the API's), in the
 * organization's default locale (falling back to ca): users have no stored
 * locale. The copy comes from the i18n catalogs via `@librehr/emails`.
 *
 * Never writes `time_events`; the only write is the notification, created at
 * most once per employee and day (a unique index on its category and link,
 * migration 0032), so a re-run is a no-op. Deduplicated at enqueue time by
 * `timeCloseDaySingletonKey`. Logs and output carry ids and counts only.
 */
export async function handleTimeCloseDay(
  job: { id: string; data: unknown },
  deps: TimeCloseDayDeps,
): Promise<TimeCloseDayReport> {
  const data = parsePayload(
    "time.close-day",
    TimeCloseDayPayloadSchema,
    job.data,
  );
  const tenant = { organizationId: data.organizationId };
  const timeRepo = new TimeRepository();
  const notificationRepo = new NotificationRepository();
  const orgRepo = new OrganizationRepository();
  const shiftRepo = new ShiftRepository();

  const { locale, employees, shifts } = await withTenant(
    deps.sql,
    tenant,
    async (tx) => ({
      locale: (await orgRepo.findById(tx, data.organizationId))?.defaultLocale,
      employees: await timeRepo.listUsersWithEventsOnLocalDay(
        tx,
        data.closeDate,
      ),
      shifts: await shiftRepo.listScheduledShiftsOnDate(tx, data.closeDate),
    }),
  );
  const text = missingClockOutNotification(locale, data.closeDate);
  const link = `/time/corrections?date=${data.closeDate}`;
  const shiftOf = new Map<string, ScheduledShift>(
    shifts.map((s) => [
      s.employeeId,
      { type: s.shiftType, startTime: s.startTime, endTime: s.endTime },
    ]),
  );

  let open = 0;
  let overnight = 0;
  let notified = 0;
  let failed = 0;
  for (const employee of employees) {
    try {
      const window = localPeriodBounds(
        addDays(data.closeDate, -1),
        data.closeDate,
        employee.timeZone,
      );
      const outcome = await withTenant(deps.sql, tenant, async (tx) => {
        const rows = await timeRepo.getEventsForPeriod(
          tx,
          employee.employeeId,
          window.start,
          window.end,
        );
        const left = openAtDayEnd(
          rows.map(toTimeEvent),
          data.closeDate,
          employee.timeZone,
        );
        if (!left) return "closed" as const;
        if (
          coveredByOvernightShift(
            left,
            data.closeDate,
            employee.timeZone,
            shiftOf.get(employee.employeeId) ?? null,
          )
        ) {
          return "overnight" as const;
        }
        const created = await notificationRepo.createOnce(tx, {
          userId: employee.userId,
          title: text.title,
          body: text.body,
          category: MISSING_CLOCK_OUT_CATEGORY,
          link,
        });
        return created ? ("notified" as const) : ("open" as const);
      });
      if (outcome === "overnight") overnight++;
      else if (outcome !== "closed") open++;
      if (outcome === "notified") notified++;
    } catch (err) {
      // One malformed chain must not starve the rest of the organization.
      failed++;
      deps.logger.error({
        msg: "time close-day skipped an employee",
        requirement: "TIM-003",
        jobId: job.id,
        organizationId: data.organizationId,
        employeeId: employee.employeeId,
        error: err instanceof Error ? err.name : "unknown",
      });
    }
  }

  const report: TimeCloseDayReport = {
    organizationId: data.organizationId,
    closeDate: data.closeDate,
    employeesChecked: employees.length,
    open,
    overnight,
    notified,
    failed,
  };
  deps.logger.info({
    msg: "time close-day finished",
    requirement: "TIM-003",
    jobId: job.id,
    ...report,
  });
  return report;
}
