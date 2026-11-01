import type { TimeEvent } from "./events.js";

export interface BreakInterval {
  breakStart: string; // ISO string
  breakEnd?: string; // ISO string
  durationMinutes: number;
}

export interface WorkSession {
  clockIn: string;
  clockOut?: string;
  isOpen: boolean;
  breaks: BreakInterval[];
  grossDurationMinutes: number;
  totalBreakMinutes: number;
  netWorkedDurationMinutes: number;
}

/**
 * Folds a sequence of append-only time events into discrete, non-overlapping work sessions.
 */
export function foldSessions(events: readonly TimeEvent[]): WorkSession[] {
  // Sort chronologically by occurredAt
  const sorted = [...events].sort(
    (a, b) =>
      new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime(),
  );

  const sessions: WorkSession[] = [];
  let currentSession: WorkSession | null = null;
  let activeBreak: { start: string } | null = null;

  for (const event of sorted) {
    switch (event.eventType) {
      case "clock_in": {
        // If an open session already exists, close it implicitly before starting new one
        if (currentSession && currentSession.isOpen) {
          currentSession.isOpen = false;
          sessions.push(currentSession);
        }
        currentSession = {
          clockIn: event.occurredAt,
          isOpen: true,
          breaks: [],
          grossDurationMinutes: 0,
          totalBreakMinutes: 0,
          netWorkedDurationMinutes: 0,
        };
        activeBreak = null;
        break;
      }

      case "break_start": {
        if (currentSession && currentSession.isOpen && !activeBreak) {
          activeBreak = { start: event.occurredAt };
        }
        break;
      }

      case "break_end": {
        if (currentSession && currentSession.isOpen && activeBreak) {
          const startMs = new Date(activeBreak.start).getTime();
          const endMs = new Date(event.occurredAt).getTime();
          const breakMin = Math.max(0, Math.round((endMs - startMs) / 60000));

          currentSession.breaks.push({
            breakStart: activeBreak.start,
            breakEnd: event.occurredAt,
            durationMinutes: breakMin,
          });
          currentSession.totalBreakMinutes += breakMin;
          activeBreak = null;
        }
        break;
      }

      case "clock_out": {
        if (currentSession && currentSession.isOpen) {
          // If a break was still open, close it at clock-out
          if (activeBreak) {
            const startMs = new Date(activeBreak.start).getTime();
            const endMs = new Date(event.occurredAt).getTime();
            const breakMin = Math.max(0, Math.round((endMs - startMs) / 60000));
            currentSession.breaks.push({
              breakStart: activeBreak.start,
              breakEnd: event.occurredAt,
              durationMinutes: breakMin,
            });
            currentSession.totalBreakMinutes += breakMin;
            activeBreak = null;
          }

          currentSession.clockOut = event.occurredAt;
          currentSession.isOpen = false;

          const inMs = new Date(currentSession.clockIn).getTime();
          const outMs = new Date(event.occurredAt).getTime();
          const grossMin = Math.max(0, Math.round((outMs - inMs) / 60000));

          currentSession.grossDurationMinutes = grossMin;
          currentSession.netWorkedDurationMinutes = Math.max(
            0,
            grossMin - currentSession.totalBreakMinutes,
          );

          sessions.push(currentSession);
          currentSession = null;
        }
        break;
      }

      case "correction":
        // Corrections reference original events; folding applies to effective recorded intervals
        break;
    }
  }

  // Push unclosed in-progress session if any
  if (currentSession && currentSession.isOpen) {
    sessions.push(currentSession);
  }

  return sessions;
}
