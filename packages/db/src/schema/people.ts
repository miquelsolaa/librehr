import {
  pgTable,
  text,
  uuid,
  date,
  boolean,
  index,
  integer,
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
    minPresencePercent: integer("min_presence_percent"),
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
    pinHash: text("pin_hash"), // TIM-010: Salted hash for tablet kiosk clocking
    pinSalt: text("pin_salt"),
    badgeId: text("badge_id"), // TIM-010: Optional RFID / NFC / QR badge identifier
    ...timestamps,
  },
  (table) => [
    index("employees_org_idx").on(table.organizationId),
    index("employees_user_idx").on(table.userId),
    index("employees_dept_idx").on(table.departmentId),
    index("employees_manager_idx").on(table.managerId),
    index("employees_status_idx").on(table.organizationId, table.status),
    index("employees_badge_idx").on(table.organizationId, table.badgeId),
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

// Teams and team reporting relationships (ORG-003)
export const teams = pgTable(
  "teams",
  {
    id: primaryId(),
    organizationId: organizationIdCol().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    departmentId: uuid("department_id").references(() => departments.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    leadEmployeeId: uuid("lead_employee_id").references(
      (): AnyPgColumn => employees.id,
      {
        onDelete: "set null",
      },
    ),
    ...timestamps,
  },
  (table) => [
    index("teams_org_idx").on(table.organizationId),
    index("teams_dept_idx").on(table.departmentId),
  ],
);

// Custom fields definition table (ORG-005)
export const customFieldDefinitions = pgTable(
  "custom_field_definitions",
  {
    id: primaryId(),
    organizationId: organizationIdCol().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    code: text("code").notNull(),
    fieldType: text("field_type").notNull(), // text, number, date, select
    options: text("options"), // JSON stringified array of string options for 'select'
    required: boolean("required").notNull().default(false),
    visibility: text("visibility").notNull().default("employee"), // admin, hr, manager, employee, public
    ...timestamps,
  },
  (table) => [
    index("cfd_org_idx").on(table.organizationId),
    index("cfd_org_code_idx").on(table.organizationId, table.code),
  ],
);

// Custom field values per employee (ORG-005)
export const customFieldValues = pgTable(
  "custom_field_values",
  {
    id: primaryId(),
    organizationId: organizationIdCol().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    fieldDefinitionId: uuid("field_definition_id")
      .notNull()
      .references(() => customFieldDefinitions.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    value: text("value"),
    ...timestamps,
  },
  (table) => [
    index("cfv_org_idx").on(table.organizationId),
    index("cfv_employee_idx").on(table.employeeId),
    index("cfv_field_idx").on(table.fieldDefinitionId),
  ],
);

// Emergency contacts table (EMP-002)
export const emergencyContacts = pgTable(
  "emergency_contacts",
  {
    id: primaryId(),
    organizationId: organizationIdCol().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    fullName: text("full_name").notNull(),
    relationship: text("relationship").notNull(), // spouse, partner, parent, child, sibling, other
    phonePrimary: text("phone_primary").notNull(),
    phoneSecondary: text("phone_secondary"),
    isPrimary: boolean("is_primary").notNull().default(false),
    ...timestamps,
  },
  (table) => [
    index("emergency_contacts_org_idx").on(table.organizationId),
    index("emergency_contacts_emp_idx").on(table.employeeId),
  ],
);
