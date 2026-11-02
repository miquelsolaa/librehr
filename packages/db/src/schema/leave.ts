import {
  pgTable,
  text,
  uuid,
  date,
  numeric,
  integer,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { primaryId, organizationIdCol, timestamps } from "./common.js";
import { organizations, locations } from "./platform.js";
import { employees } from "./people.js";

export const leaveLedger = pgTable(
  "leave_ledger",
  {
    id: primaryId(),
    organizationId: organizationIdCol().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    entryType: text("entry_type").notNull(), // accrual, usage, adjustment, carryover, expiry, reversal
    amount: numeric("amount", { precision: 5, scale: 2 }).notNull(), // can be negative for usage/expiry
    unit: text("unit").notNull().default("days"), // days, hours
    sourceRef: text("source_ref"), // e.g. request_id, policy_run_id, adjustment_id
    note: text("note"),
    effectiveDate: date("effective_date").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("leave_ledger_org_idx").on(table.organizationId),
    index("leave_ledger_employee_idx").on(table.employeeId),
  ],
);

export const leaveTypes = pgTable(
  "leave_types",
  {
    id: primaryId(),
    organizationId: organizationIdCol().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(), // e.g. Vacaciones, Asuntos Propios, Baja Médica
    code: text("code").notNull(), // vacation, personal_days, sick_leave, parental_leave, unpaid_leave, other
    isPaid: boolean("is_paid").default(true).notNull(),
    requiresApproval: boolean("requires_approval").default(true).notNull(),
    halfDaysAllowed: boolean("half_days_allowed").default(true).notNull(),
    countsWorkingDays: boolean("counts_working_days").default(true).notNull(),
    color: text("color").default("#3b82f6").notNull(),
    ...timestamps,
  },
  (table) => [
    index("leave_types_org_idx").on(table.organizationId),
    index("leave_types_code_idx").on(table.organizationId, table.code),
  ],
);

export const leavePolicies = pgTable(
  "leave_policies",
  {
    id: primaryId(),
    organizationId: organizationIdCol().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    leaveTypeId: uuid("leave_type_id")
      .notNull()
      .references(() => leaveTypes.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    annualAllowanceDays: numeric("annual_allowance_days", {
      precision: 5,
      scale: 2,
    })
      .default("22.00")
      .notNull(),
    accrualMethod: text("accrual_method").default("monthly").notNull(), // upfront, monthly, daily
    carryoverMaxDays: numeric("carryover_max_days", { precision: 5, scale: 2 })
      .default("5.00")
      .notNull(),
    carryoverExpiryMonths: integer("carryover_expiry_months")
      .default(3)
      .notNull(), // default: March 31
    allowNegativeBalance: boolean("allow_negative_balance")
      .default(false)
      .notNull(),
    ...timestamps,
  },
  (table) => [
    index("leave_policies_org_idx").on(table.organizationId),
    index("leave_policies_type_idx").on(table.leaveTypeId),
  ],
);

export const leavePolicyAssignments = pgTable(
  "leave_policy_assignments",
  {
    id: primaryId(),
    organizationId: organizationIdCol().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    leavePolicyId: uuid("leave_policy_id")
      .notNull()
      .references(() => leavePolicies.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    effectiveFrom: date("effective_from").notNull(),
    ...timestamps,
  },
  (table) => [
    index("leave_policy_assignments_org_idx").on(table.organizationId),
    index("leave_policy_assignments_emp_idx").on(table.employeeId),
  ],
);

export const holidayCalendars = pgTable(
  "holiday_calendars",
  {
    id: primaryId(),
    organizationId: organizationIdCol().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    ...timestamps,
  },
  (table) => [
    index("holiday_calendars_org_loc_year_idx").on(
      table.organizationId,
      table.locationId,
      table.year,
    ),
  ],
);

export const holidays = pgTable(
  "holidays",
  {
    id: primaryId(),
    organizationId: organizationIdCol().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    calendarId: uuid("calendar_id")
      .notNull()
      .references(() => holidayCalendars.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    name: text("name").notNull(),
    scope: text("scope").default("national").notNull(), // national, regional, local, company
    ...timestamps,
  },
  (table) => [
    index("holidays_calendar_idx").on(table.calendarId),
    index("holidays_date_idx").on(table.organizationId, table.date),
  ],
);

export const leaveRequests = pgTable(
  "leave_requests",
  {
    id: primaryId(),
    organizationId: organizationIdCol().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    leaveTypeId: uuid("leave_type_id")
      .notNull()
      .references(() => leaveTypes.id, { onDelete: "restrict" }),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    halfDayStart: boolean("half_day_start").default(false).notNull(),
    halfDayEnd: boolean("half_day_end").default(false).notNull(),
    workingDays: numeric("working_days", { precision: 5, scale: 2 }).notNull(),
    status: text("status").default("pending").notNull(), // pending, approved, rejected, cancelled
    notes: text("notes"),
    approverId: uuid("approver_id").references(() => employees.id),
    decidedAt: timestamp("decided_at", { withTimezone: true, mode: "date" }),
    decisionReason: text("decision_reason"),
    reversalLedgerEntryId: uuid("reversal_ledger_entry_id"),
    ...timestamps,
  },
  (table) => [
    index("leave_requests_org_idx").on(table.organizationId),
    index("leave_requests_emp_idx").on(table.employeeId),
    index("leave_requests_dates_idx").on(
      table.organizationId,
      table.startDate,
      table.endDate,
    ),
  ],
);

// LEA-007: Blackout periods during peak business operations
export const blackoutPeriods = pgTable(
  "blackout_periods",
  {
    id: primaryId(),
    organizationId: organizationIdCol().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    departmentId: uuid("department_id"),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    reason: text("reason").notNull(),
    ...timestamps,
  },
  (table) => [
    index("blackout_periods_org_idx").on(table.organizationId),
    index("blackout_periods_dates_idx").on(
      table.organizationId,
      table.startDate,
      table.endDate,
    ),
  ],
);

// LEA-008: Manager absence approval delegation
export const approvalDelegations = pgTable(
  "approval_delegations",
  {
    id: primaryId(),
    organizationId: organizationIdCol().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    managerEmployeeId: uuid("manager_employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    delegateEmployeeId: uuid("delegate_employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    reason: text("reason"),
    ...timestamps,
  },
  (table) => [
    index("approval_delegations_org_idx").on(table.organizationId),
    index("approval_delegations_mgr_idx").on(
      table.organizationId,
      table.managerEmployeeId,
    ),
    index("approval_delegations_delegate_idx").on(
      table.organizationId,
      table.delegateEmployeeId,
    ),
  ],
);
