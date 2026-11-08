import { Temporal } from "temporal-polyfill";
import type { BreakInterval, WorkSession } from "./fold-sessions.js";

/**
 * Allocate closed work sessions to local calendar days. Open sessions remain
 * anomalies without inventing elapsed time.
 * @example
 * splitSessionsByLocalDay([], "2026-01-01", "2026-01-01", "Europe/Madrid");
 */
export function splitSessionsByLocalDay(
  sessions: readonly WorkSession[],
  startDate: string,
  endDate: string,
  timeZone: string,
): Map<string, WorkSession[]> {
  const result = new Map<string, WorkSession[]>();
  const last = Temporal.PlainDate.from(endDate);
  for (
    let day = Temporal.PlainDate.from(startDate);
    Temporal.PlainDate.compare(day, last) <= 0;
    day = day.add({ days: 1 })
  ) {
    const start = day.toZonedDateTime(timeZone).epochMilliseconds;
    const end = day
      .add({ days: 1 })
      .toZonedDateTime(timeZone).epochMilliseconds;
    const parts: WorkSession[] = [];
    for (const session of sessions) {
      const from = Temporal.Instant.from(session.clockIn).epochMilliseconds;
      if (!session.clockOut) {
        if (session.isOpen && from < end) parts.push(session);
        continue;
      }
      const to = Temporal.Instant.from(session.clockOut).epochMilliseconds;
      const partStart = Math.max(start, from);
      const partEnd = Math.min(end, to);
      if (partStart >= partEnd) continue;
      const breaks: BreakInterval[] = [];
      for (const interval of session.breaks) {
        if (!interval.breakEnd) continue;
        const bStart = Math.max(
          partStart,
          Temporal.Instant.from(interval.breakStart).epochMilliseconds,
        );
        const bEnd = Math.min(
          partEnd,
          Temporal.Instant.from(interval.breakEnd).epochMilliseconds,
        );
        if (bStart < bEnd)
          breaks.push({
            breakStart:
              Temporal.Instant.fromEpochMilliseconds(bStart).toString(),
            breakEnd: Temporal.Instant.fromEpochMilliseconds(bEnd).toString(),
            durationMinutes: Math.round((bEnd - bStart) / 60000),
          });
      }
      const gross = Math.round((partEnd - partStart) / 60000);
      const breakMinutes = breaks.reduce(
        (sum, value) => sum + value.durationMinutes,
        0,
      );
      parts.push({
        clockIn: Temporal.Instant.fromEpochMilliseconds(partStart).toString(),
        clockOut: Temporal.Instant.fromEpochMilliseconds(partEnd).toString(),
        isOpen: false,
        breaks,
        grossDurationMinutes: gross,
        totalBreakMinutes: breakMinutes,
        netWorkedDurationMinutes: Math.max(0, gross - breakMinutes),
      });
    }
    result.set(day.toString(), parts);
  }
  return result;
}
