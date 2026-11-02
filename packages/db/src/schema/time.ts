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
import { primaryId, organizationIdCol, timestamps } from "./common.js";
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

// TIM-012: Time bank / compensatory rest records (bolsa de horas)
export const timeBankRecords = pgTable(
  "time_bank_records",
  {
    id: primaryId(),
    organizationId: organizationIdCol().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // overtime_accrual, compensatory_rest_taken, manual_adjustment, expired
    minutes: integer("minutes").notNull(),
    referenceDate: date("reference_date").notNull(),
    notes: text("notes"),
    actorId: uuid("actor_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("time_bank_records_org_idx").on(table.organizationId),
    index("time_bank_records_emp_idx").on(
      table.organizationId,
      table.employeeId,
    ),
  ],
);

// TIM-004 & TIM-005: Shift rotation templates
export const shiftTemplates = pgTable(
  "shift_templates",
  {
    id: primaryId(),
    organizationId: organizationIdCol().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    code: text("code").notNull(), // e.g. M, T, N, OFF
    type: text("type").notNull().default("morning"), // morning, afternoon, night, rest
    startTime: text("start_time").notNull(), // "06:00"
    endTime: text("end_time").notNull(), // "14:00"
    color: text("color").notNull().default("#3b82f6"),
    breakMinutes: integer("break_minutes").notNull().default(30),
    ...timestamps,
  },
  (table) => [
    index("shift_templates_org_idx").on(table.organizationId),
    index("shift_templates_code_idx").on(table.organizationId, table.code),
  ],
);

// TIM-004 & TIM-005: Continuous rotational patterns (e.g. 6x2, 4x2)
export const shiftPatterns = pgTable(
  "shift_patterns",
  {
    id: primaryId(),
    organizationId: organizationIdCol().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    cycleDays: integer("cycle_days").notNull().default(8),
    description: text("description"),
    ...timestamps,
  },
  (table) => [index("shift_patterns_org_idx").on(table.organizationId)],
);

// TIM-004 & TIM-005: Rotational pattern steps (step 0 to cycleDays - 1)
export const shiftPatternSteps = pgTable(
  "shift_pattern_steps",
  {
    id: primaryId(),
    organizationId: organizationIdCol().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    patternId: uuid("pattern_id")
      .notNull()
      .references(() => shiftPatterns.id, { onDelete: "cascade" }),
    stepOrder: integer("step_order").notNull(),
    shiftTemplateId: uuid("shift_template_id").references(
      () => shiftTemplates.id,
      { onDelete: "set null" },
    ),
    isRest: boolean("is_rest").notNull().default(false),
    ...timestamps,
  },
  (table) => [
    index("shift_pattern_steps_pattern_idx").on(table.patternId),
    index("shift_pattern_steps_org_idx").on(table.organizationId),
  ],
);

// TIM-004 & TIM-005: Scheduled employee shift assignments (roster calendar)
export const shiftAssignments = pgTable(
  "shift_assignments",
  {
    id: primaryId(),
    organizationId: organizationIdCol().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    shiftTemplateId: uuid("shift_template_id").references(
      () => shiftTemplates.id,
      { onDelete: "set null" },
    ),
    status: text("status").notNull().default("scheduled"), // scheduled, confirmed, completed
    notes: text("notes"),
    ...timestamps,
  },
  (table) => [
    index("shift_assignments_org_date_idx").on(
      table.organizationId,
      table.date,
    ),
    index("shift_assignments_emp_date_idx").on(table.employeeId, table.date),
  ],
);

// TIM-004: Colleague shift swap requests workflow
export const shiftSwaps = pgTable(
  "shift_swaps",
  {
    id: primaryId(),
    organizationId: organizationIdCol().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    requesterId: uuid("requester_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    targetEmployeeId: uuid("target_employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    requesterDate: date("requester_date").notNull(),
    targetDate: date("target_date").notNull(),
    status: text("status").notNull().default("pending"), // pending, approved, rejected, cancelled
    reason: text("reason"),
    approverId: uuid("approver_id").references(() => employees.id, {
      onDelete: "set null",
    }),
    decidedAt: timestamp("decided_at", { withTimezone: true, mode: "date" }),
    ...timestamps,
  },
  (table) => [
    index("shift_swaps_org_idx").on(table.organizationId),
    index("shift_swaps_requester_idx").on(table.requesterId),
    index("shift_swaps_target_idx").on(table.targetEmployeeId),
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
