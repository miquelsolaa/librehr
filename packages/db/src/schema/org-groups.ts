import {
  pgTable,
  text,
  uuid,
  date,
  numeric,
  timestamp,
  index,
  uniqueIndex,
  foreignKey,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { primaryId, timestamps, organizationIdCol } from "./common.js";
import { organizations } from "./platform.js";
import { departments, employees } from "./people.js";

/**
 * ORG-007 (issue #81, ADR 0008): projects and areas (migration 0046).
 * Archived, never deleted. Foreign keys are composite (organization_id, ...)
 * so a group can never point at another tenant's rows.
 */
export const orgGroups = pgTable(
  "org_groups",
  {
    id: primaryId(),
    organizationId: organizationIdCol().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    kind: text("kind").notNull(), // project, area
    name: text("name").notNull(),
    description: text("description"),
    parentId: uuid("parent_id"), // an area holding projects (one level)
    leadEmployeeId: uuid("lead_employee_id"),
    startsOn: date("starts_on"),
    endsOn: date("ends_on"),
    archivedAt: timestamp("archived_at", { withTimezone: true, mode: "date" }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("org_groups_org_id_uidx").on(table.organizationId, table.id),
    uniqueIndex("org_groups_active_name_uidx")
      .on(table.organizationId, table.kind, sql`lower(${table.name})`)
      .where(sql`${table.archivedAt} IS NULL`),
    index("org_groups_parent_idx").on(table.organizationId, table.parentId),
    index("org_groups_lead_idx").on(table.organizationId, table.leadEmployeeId),
    foreignKey({
      name: "org_groups_parent_fk",
      columns: [table.organizationId, table.parentId],
      foreignColumns: [table.organizationId, table.id],
    }),
    // The SQL clears only lead_employee_id: ON DELETE SET NULL (lead_employee_id).
    foreignKey({
      name: "org_groups_lead_fk",
      columns: [table.organizationId, table.leadEmployeeId],
      foreignColumns: [employees.organizationId, employees.id],
    }).onDelete("set null"),
    check("org_groups_kind_check", sql`${table.kind} IN ('project', 'area')`),
    check("org_groups_name_check", sql`length(btrim(${table.name})) > 0`),
    check(
      "org_groups_dates_check",
      sql`${table.endsOn} IS NULL OR ${table.startsOn} IS NULL OR ${table.endsOn} >= ${table.startsOn}`,
    ),
  ],
);

/**
 * ORG-007: secondary links of an employee to exactly one department or group,
 * with validity dates (calendar dates in the organization's time zone). The
 * primary department stays in employees.department_id. Overlaps per
 * (employee, target) are rejected by gist exclusion constraints in 0046.
 */
export const employeeMemberships = pgTable(
  "employee_memberships",
  {
    id: primaryId(),
    organizationId: organizationIdCol().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    employeeId: uuid("employee_id").notNull(),
    departmentId: uuid("department_id"),
    groupId: uuid("group_id"),
    role: text("role"), // free label, never used for authorization
    allocationPercent: numeric("allocation_percent", {
      precision: 5,
      scale: 2,
    }),
    startDate: date("start_date").notNull(),
    endDate: date("end_date"),
    createdBy: uuid("created_by").notNull(),
    endedBy: uuid("ended_by"),
    endReason: text("end_reason"),
    ...timestamps,
  },
  (table) => [
    index("employee_memberships_employee_idx").on(
      table.organizationId,
      table.employeeId,
    ),
    index("employee_memberships_department_idx")
      .on(table.organizationId, table.departmentId)
      .where(sql`${table.departmentId} IS NOT NULL`),
    index("employee_memberships_group_idx")
      .on(table.organizationId, table.groupId)
      .where(sql`${table.groupId} IS NOT NULL`),
    foreignKey({
      name: "employee_memberships_employee_fk",
      columns: [table.organizationId, table.employeeId],
      foreignColumns: [employees.organizationId, employees.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "employee_memberships_department_fk",
      columns: [table.organizationId, table.departmentId],
      foreignColumns: [departments.organizationId, departments.id],
    }),
    foreignKey({
      name: "employee_memberships_group_fk",
      columns: [table.organizationId, table.groupId],
      foreignColumns: [orgGroups.organizationId, orgGroups.id],
    }),
    check(
      "employee_memberships_one_target_check",
      sql`num_nonnulls(${table.departmentId}, ${table.groupId}) = 1`,
    ),
    check(
      "employee_memberships_allocation_check",
      sql`${table.allocationPercent} IS NULL OR (${table.allocationPercent} > 0 AND ${table.allocationPercent} <= 100)`,
    ),
    check(
      "employee_memberships_dates_check",
      sql`${table.endDate} IS NULL OR ${table.endDate} >= ${table.startDate}`,
    ),
  ],
);
