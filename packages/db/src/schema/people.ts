import { pgTable, text, uuid, date, index } from "drizzle-orm/pg-core";
import { primaryId, timestamps, organizationIdCol } from "./common.js";
import { organizations } from "./platform.js";
import { users } from "./identity.js";

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
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    preferredName: text("preferred_name"),
    email: text("email").notNull(),
    status: text("status").notNull().default("active"), // active, on_leave, terminated
    nationalIdEncrypted: text("national_id_encrypted"), // DNI/NIE (AES-256-GCM)
    ibanEncrypted: text("iban_encrypted"), // IBAN (AES-256-GCM)
    ...timestamps,
  },
  (table) => [
    index("employees_org_idx").on(table.organizationId),
    index("employees_user_idx").on(table.userId),
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
    employmentType: text("employment_type").notNull().default("indefinido"), // indefinido, temporal, practicas
    startDate: date("start_date").notNull(),
    endDate: date("end_date"),
    ...timestamps,
  },
  (table) => [
    index("employments_org_idx").on(table.organizationId),
    index("employments_employee_idx").on(table.employeeId),
  ],
);

// TODO(ORG-003): Departments hierarchy table
export const departmentsStub = {
  table: "departments",
  requirementId: "ORG-003",
};

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
