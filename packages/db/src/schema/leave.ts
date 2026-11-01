import {
  pgTable,
  text,
  uuid,
  date,
  numeric,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { primaryId, organizationIdCol } from "./common.js";
import { organizations } from "./platform.js";
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
    entryType: text("entry_type").notNull(), // accrual, usage, adjustment, carryover, expiry
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

// TODO(LEA-001): Leave types configuration table
export const leaveTypesStub = {
  table: "leave_types",
  requirementId: "LEA-001",
};

// TODO(LEA-002): Leave policies configuration table
export const leavePoliciesStub = {
  table: "leave_policies",
  requirementId: "LEA-002",
};

// TODO(LEA-002): Leave policy employee assignments
export const leavePolicyAssignmentsStub = {
  table: "leave_policy_assignments",
  requirementId: "LEA-002",
};

// TODO(LEA-003): Holiday calendars per location/region
export const holidayCalendarsStub = {
  table: "holiday_calendars",
  requirementId: "LEA-003",
};

// TODO(LEA-003): Holiday calendar dates table
export const holidaysStub = { table: "holidays", requirementId: "LEA-003" };

// TODO(LEA-004): Leave requests status workflow table
export const leaveRequestsStub = {
  table: "leave_requests",
  requirementId: "LEA-004",
};

// TODO(LEA-004): Materialized per-day leave request rows
export const leaveRequestDaysStub = {
  table: "leave_request_days",
  requirementId: "LEA-004",
};
