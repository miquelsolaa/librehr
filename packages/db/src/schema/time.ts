import {
  pgTable,
  text,
  uuid,
  timestamp,
  index,
  integer,
  numeric,
  boolean,
  date,
} from "drizzle-orm/pg-core";
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

// TIM-005: Working-time schedules configuration table
export const schedules = pgTable(
  "schedules",
  {
    id: primaryId(),
    organizationId: organizationIdCol().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    type: text("type").notNull().default("fixed"), // fixed, flexible, shift
    weeklyHours: numeric("weekly_hours", { precision: 5, scale: 2 })
      .notNull()
      .default("40.00"),
    minimumDailyRestHours: numeric("minimum_daily_rest_hours", {
      precision: 4,
      scale: 1,
    })
      .notNull()
      .default("12.0"),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("schedules_org_idx").on(table.organizationId)],
);

// TIM-005: Daily schedule rules
export const scheduleRules = pgTable(
  "schedule_rules",
  {
    id: primaryId(),
    organizationId: organizationIdCol().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    scheduleId: uuid("schedule_id")
      .notNull()
      .references(() => schedules.id, { onDelete: "cascade" }),
    dayOfWeek: integer("day_of_week").notNull(), // 1 (Mon) - 7 (Sun)
    expectedHours: numeric("expected_hours", { precision: 4, scale: 2 })
      .notNull()
      .default("8.00"),
    coreStartMinutes: integer("core_start_minutes"),
    coreEndMinutes: integer("core_end_minutes"),
    breakMinutes: integer("break_minutes").default(60),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("schedule_rules_schedule_idx").on(table.scheduleId)],
);

// TIM-005: Employee schedule assignment
export const employeeSchedules = pgTable(
  "employee_schedules",
  {
    id: primaryId(),
    organizationId: organizationIdCol().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    scheduleId: uuid("schedule_id")
      .notNull()
      .references(() => schedules.id, { onDelete: "cascade" }),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("employee_schedules_employee_idx").on(table.employeeId),
    index("employee_schedules_schedule_idx").on(table.scheduleId),
  ],
);

// TIM-003: Forgotten clock-out & correction requests workflow
export const timeCorrections = pgTable(
  "time_corrections",
  {
    id: primaryId(),
    organizationId: organizationIdCol().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    refEventId: uuid("ref_event_id").references(() => timeEvents.id, {
      onDelete: "set null",
    }),
    proposedEventType: text("proposed_event_type").notNull(),
    proposedOccurredAt: timestamp("proposed_occurred_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    reason: text("reason").notNull(),
    status: text("status").notNull().default("pending"), // pending, approved, rejected
    approverId: uuid("approver_id").references(() => employees.id, {
      onDelete: "set null",
    }),
    decidedAt: timestamp("decided_at", { withTimezone: true, mode: "date" }),
    decisionReason: text("decision_reason"),
    createdEventId: uuid("created_event_id").references(() => timeEvents.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("time_corrections_org_idx").on(table.organizationId),
    index("time_corrections_employee_idx").on(table.employeeId),
  ],
);

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
