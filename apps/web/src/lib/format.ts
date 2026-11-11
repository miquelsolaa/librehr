export function formatDate(
  date: string | Date,
  locale = "ca",
  options?: Intl.DateTimeFormatOptions,
): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    ...options,
  }).format(d);
}

export function formatDateTime(
  date: string | Date,
  locale = "ca",
  options?: Intl.DateTimeFormatOptions,
): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    ...options,
  }).format(d);
}

export function formatNumber(
  value: number,
  locale = "ca",
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(locale, options).format(value);
}

export function formatHours(hours: number, _locale = "ca"): string {
  const h = Math.floor(hours);

  const m = Math.round((hours - h) * 60);
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

/**
 * Formats a calendar date (`YYYY-MM-DD`: leave days, holidays) without
 * shifting it through the viewer's time zone. Anything else is returned as is.
 */
export function formatCalendarDate(
  isoDate: string,
  locale = "ca",
  options?: Intl.DateTimeFormatOptions,
): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return isoDate;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    ...options,
    timeZone: "UTC",
  }).format(new Date(`${isoDate}T00:00:00Z`));
}

/**
 * The viewer's local calendar day as `YYYY-MM-DD`. `toISOString()` would
 * give the UTC day, which is yesterday just after midnight east of Greenwich.
 */
export function localIsoDate(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
