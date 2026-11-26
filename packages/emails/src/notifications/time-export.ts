import {
  notificationLocale,
  notificationMessage,
  type NotificationText,
} from "./missing-clock-out.js";

/** Local calendar dates (`YYYY-MM-DD`) of a background export's period. */
export interface TimeExportPeriodText {
  periodStart: string;
  periodEnd: string;
}

function fill(template: string, values: Record<string, string>): string {
  // Plain substitution, not ICU (see missingClockOutNotification).
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.hasOwn(values, name) ? values[name]! : match,
  );
}

/**
 * TIM-006: a background time export is ready to download until
 * `availableUntil` (a local date). Period and dates only: no names, since
 * the requester already knows what they asked for.
 *
 * @example
 * timeExportReadyNotification("en", {
 *   periodStart: "2026-01-01", periodEnd: "2026-12-31",
 *   availableUntil: "2027-01-08",
 * }).title; // => "Time record export ready"
 */
export function timeExportReadyNotification(
  locale: string | null | undefined,
  data: TimeExportPeriodText & { availableUntil: string },
): NotificationText {
  const loc = notificationLocale(locale);
  return {
    title: notificationMessage(loc, "notifications.timeExportReady.title"),
    body: fill(notificationMessage(loc, "notifications.timeExportReady.body"), {
      start: data.periodStart,
      end: data.periodEnd,
      until: data.availableUntil,
    }),
  };
}

/** TIM-006: a background time export could not be generated. */
export function timeExportFailedNotification(
  locale: string | null | undefined,
  data: TimeExportPeriodText,
): NotificationText {
  const loc = notificationLocale(locale);
  return {
    title: notificationMessage(loc, "notifications.timeExportFailed.title"),
    body: fill(
      notificationMessage(loc, "notifications.timeExportFailed.body"),
      {
        start: data.periodStart,
        end: data.periodEnd,
      },
    ),
  };
}
