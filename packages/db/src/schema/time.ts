import { pgTable, text, uuid, timestamp, index } from "drizzle-orm/pg-core";
import { primaryId, organizationIdCol } from "./common.js";
import { organizations } from "./platform.js";
import { employees } from "./people.js";

export const timeEvents = pgTable(
  "time_events",
  {
    id: primaryId(),
    organizationId: organizationIdCol().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(), // clock_in, clock_out, break_start, break_end, correction
    occurredAt: timestamp("occurred_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    source: text("source").notNull().default("web"), // web, mobile, manual, import
    actorId: uuid("actor_id").notNull(),
    refEventId: uuid("ref_event_id"), // For corrections, references the original event
    reason: text("reason"), // Required for corrections
    prevHash: text("prev_hash"), // SHA-256 hash of previous event in chain
    hash: text("hash").notNull(), // SHA-256(prev_hash || canonical_json(event))
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("time_events_org_idx").on(table.organizationId),
    index("time_events_employee_idx").on(table.employeeId),
    index("time_events_occurred_idx").on(table.occurredAt),
  ],
);

// TODO(TIM-005): Working-time schedules configuration table
export const schedulesStub = { table: "schedules", requirementId: "TIM-005" };

// TODO(TIM-005): Working-time schedule daily rules table
export const scheduleRulesStub = {
  table: "schedule_rules",
  requirementId: "TIM-005",
};

// TODO(TIM-003): Forgotten clock-out correction requests workflow
export const timeCorrectionRequestsStub = {
  table: "time_correction_requests",
  requirementId: "TIM-003",
};

// TODO(TIM-006): Time export reports for Labour Inspectorate
export const timeExportsStub = {
  table: "time_exports",
  requirementId: "TIM-006",
};

// TODO(TIM-004): Closed period monthly timesheet snapshots
export const timesheetClosuresStub = {
  table: "timesheet_closures",
  requirementId: "TIM-004",
};
