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
 * Notifications are stored as text, so they are written in the
 * organization's default locale. `{date}` is the ISO close date.
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
  logger: { info(obj: object): void };
}

export interface TimeCloseDayReport {
  organizationId: string;
  closeDate: string;
  employeesChecked: number;
  /** Employees left clocked in or on a break at the end of the day. */
  open: number;
  notified: number;
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
 * zone). Events from the day before to the day after are read, so a session
 * opened the day before or a night shift closed after midnight is folded
 * whole (`openAtDayEnd`). Employees without a user account have no inbox and
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
  for (const employee of employees) {
    const window = localPeriodBounds(
      addDays(data.closeDate, -1),
      addDays(data.closeDate, 1),
      employee.timeZone,
    );
    const created = await withTenant(deps.sql, tenant, async (tx) => {
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
      if (!left) return null;
      open++;
      return notificationRepo.createOnce(tx, {
        userId: employee.userId,
        title: text.title,
        body: text.body,
        category: MISSING_CLOCK_OUT_CATEGORY,
        link,
      });
    });
    if (created) notified++;
  }

  const report: TimeCloseDayReport = {
    organizationId: data.organizationId,
    closeDate: data.closeDate,
    employeesChecked: employees.length,
    open,
    notified,
  };
  deps.logger.info({
    msg: "time close-day finished",
    requirement: "TIM-003",
    jobId: job.id,
    ...report,
  });
  return report;
}
