import {
  pgTable,
  text,
  uuid,
  date,
  index,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { primaryId, timestamps, organizationIdCol } from "./common.js";
import { organizations, locations } from "./platform.js";
import { users } from "./identity.js";

export const departments = pgTable(
  "departments",
  {
    id: primaryId(),
    organizationId: organizationIdCol().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    parentId: uuid("parent_id").references((): AnyPgColumn => departments.id, {
      onDelete: "set null",
    }),
    leadEmployeeId: uuid("lead_employee_id"),
    ...timestamps,
  },
  (table) => [
    index("departments_org_idx").on(table.organizationId),
    index("departments_parent_idx").on(table.parentId),
  ],
);

export const employees = pgTable(
  "employees",
  {
    id: primaryId(),
    organizationId: organizationIdCol().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    userId: uuid("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    departmentId: uuid("department_id").references(() => departments.id, {
      onDelete: "set null",
    }),
    managerId: uuid("manager_id").references((): AnyPgColumn => employees.id, {
      onDelete: "set null",
    }),

    locationId: uuid("location_id").references(() => locations.id, {
      onDelete: "set null",
    }),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    preferredName: text("preferred_name"),
    email: text("email").notNull(),
    birthDate: date("birth_date"),
    phone: text("phone"),
    address: text("address"),
    status: text("status").notNull().default("active"), // active, on_leave, terminated
    terminationDate: date("termination_date"),
    terminationReason: text("termination_reason"), // resignation, mutual_agreement, contract_end, dismissal_objective, dismissal_disciplinary, retirement, probation_failed
    nationalIdEncrypted: text("national_id_encrypted"), // DNI/NIE (AES-256-GCM)
    ibanEncrypted: text("iban_encrypted"), // IBAN (AES-256-GCM)
    ...timestamps,
  },
  (table) => [
    index("employees_org_idx").on(table.organizationId),
    index("employees_user_idx").on(table.userId),
    index("employees_dept_idx").on(table.departmentId),
    index("employees_manager_idx").on(table.managerId),
    index("employees_status_idx").on(table.organizationId, table.status),
  ],
);

export const employments = pgTable(
  "employments",
  {
    id: primaryId(),
    organizationId: organizationIdCol().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    jobTitle: text("job_title").notNull(),
    employmentType: text("employment_type").notNull().default("indefinido"), // indefinido, temporal, practicas, formacion
    workingHoursPerWeek: text("working_hours_per_week")
      .notNull()
      .default("40.0"),
    salaryEncrypted: text("salary_encrypted"), // AES-256-GCM
    startDate: date("start_date").notNull(),
    endDate: date("end_date"),
    ...timestamps,
  },
  (table) => [
    index("employments_org_idx").on(table.organizationId),
    index("employments_employee_idx").on(table.employeeId),
  ],
);

// TODO(ORG-003): Teams and team reporting relationships
export const teamsStub = { table: "teams", requirementId: "ORG-003" };

// TODO(ORG-005): Custom fields definition table
export const customFieldDefsStub = {
  table: "custom_field_defs",
  requirementId: "ORG-005",
};

// TODO(ORG-005): Custom field values per employee
export const customFieldValuesStub = {
  table: "custom_field_values",
  requirementId: "ORG-005",
};

// TODO(EMP-002): Emergency contacts table
export const emergencyContactsStub = {
  table: "emergency_contacts",
  requirementId: "EMP-002",
};
