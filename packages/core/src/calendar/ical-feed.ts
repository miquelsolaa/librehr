import { addDays } from "./business-date.js";

export interface ICalEvent {
  uid: string;
  summary: string;
  description?: string | undefined;
  startDateStr: string; // YYYY-MM-DD
  endDateStr: string; // YYYY-MM-DD
  url?: string | undefined;
}

/**
 * Formats calendar events into RFC 5545 iCalendar (.ics) format (LEA-009).
 */
export function generateIcsCalendar(
  calendarName: string,
  events: ICalEvent[],
): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//LibreHR//HRIS Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${calendarName}`,
  ];

  const nowIso = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");

  for (const event of events) {
    const dtStart = event.startDateStr.replace(/-/g, "");
    // In iCal, end date for full day events is non-inclusive (the day after)
    const dtEnd = addDays(event.endDateStr, 1).replace(/-/g, "");

    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${event.uid}`);
    lines.push(`DTSTAMP:${nowIso}`);
    lines.push(`DTSTART;VALUE=DATE:${dtStart}`);
    lines.push(`DTEND;VALUE=DATE:${dtEnd}`);
    lines.push(`SUMMARY:${escapeIcal(event.summary)}`);
    if (event.description) {
      lines.push(`DESCRIPTION:${escapeIcal(event.description)}`);
    }
    if (event.url) {
      lines.push(`URL:${event.url}`);
    }
    lines.push("STATUS:CONFIRMED");
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");

  return lines.join("\r\n") + "\r\n";
}

function escapeIcal(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}
