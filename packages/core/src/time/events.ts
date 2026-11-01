export type TimeEventType =
  "clock_in" | "clock_out" | "break_start" | "break_end" | "correction";

export type TimeEventSource = "web" | "mobile" | "manual" | "import";

export interface TimeEvent {
  id: string;
  organizationId: string;
  employeeId: string;
  eventType: TimeEventType;
  occurredAt: string; // ISO 8601 UTC string (e.g. 2026-11-01T08:00:00.000Z)
  recordedAt: string; // ISO 8601 UTC string
  source: TimeEventSource;
  actorId: string;
  refEventId?: string;
  reason?: string;
  prevHash: string | null;
  hash: string;
}
