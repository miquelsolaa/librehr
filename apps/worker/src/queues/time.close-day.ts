import { z } from "zod";
import {
  addDays,
  localPeriodBounds,
  openAtDayEnd,
  type TimeEvent,
} from "@librehr/core";
import {
  withTenant,
  NotificationRepository,
  OrganizationRepository,
  TimeRepository,
  type Sql,
  type TimeEventRow,
} from "@librehr/db";
import { isoDate, parsePayload } from "../lib/payload.js";

export const TimeCloseDayPayloadSchema = z.object({
  organizationId: z.guid(),
  closeDate: z.string().regex(isoDate),
});

export type TimeCloseDayPayload = z.input<typeof TimeCloseDayPayloadSchema>;

export const timeCloseDaySingletonKey = (
  p: z.output<typeof TimeCloseDayPayloadSchema>,
) => `${p.organizationId}:${p.closeDate}`;

export const MISSING_CLOCK_OUT_CATEGORY = "time_missing_clock_out";

/**
 * Notifications are stored as rendered text (like the API's), so they are
 * written in the organization's default locale; users have no stored locale.
 * The copy lives here because the worker may not import `@librehr/i18n`
 * (dependency rule: worker -> core, db, emails). `{date}` is the ISO date.
 */
const MISSING_CLOCK_OUT_TEXT = {
  ca: {
    title: "Falta el fitxatge de sortida",
    body: "El teu registre de jornada del {date} continua obert. Sol·licita una correcció amb l'hora en què vas acabar.",
  },
  es: {
    title: "Falta el fichaje de salida",
    body: "Tu registro de jornada del {date} sigue abierto. Solicita una corrección con la hora en que terminaste.",
  },
  en: {
    title: "Missing clock-out",
    body: "Your time record for {date} is still open. Request a correction with the time you finished.",
  },
} as const;

function missingClockOutText(locale: string, date: string) {
  const text =
    locale === "es" || locale === "en"
      ? MISSING_CLOCK_OUT_TEXT[locale]
      : MISSING_CLOCK_OUT_TEXT.ca;
  return { title: text.title, body: text.body.replace("{date}", date) };
}

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
 * day before is known; later events are not needed (`openAtDayEnd`). Employees without a user account have no inbox and
 * are skipped.
 *
 * Never writes `time_events`; the only write is the notification, created at
 * most once per employee and day (keyed by its category and link), so a
 * re-run is a no-op. Deduplicated at enqueue time by
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

  const { locale, employees } = await withTenant(
    deps.sql,
    tenant,
    async (tx) => ({
      locale:
        (await orgRepo.findById(tx, data.organizationId))?.defaultLocale ??
        "ca",
      employees: await timeRepo.listUsersWithEventsOnLocalDay(
        tx,
        data.closeDate,
      ),
    }),
  );
  const text = missingClockOutText(locale, data.closeDate);
  const link = `/time/corrections?date=${data.closeDate}`;

  let open = 0;
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
        const created = await notificationRepo.createOnce(tx, {
          userId: employee.userId,
          title: text.title,
          body: text.body,
          category: MISSING_CLOCK_OUT_CATEGORY,
          link,
        });
        return created ? ("notified" as const) : ("open" as const);
      });
      if (outcome !== "closed") open++;
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
