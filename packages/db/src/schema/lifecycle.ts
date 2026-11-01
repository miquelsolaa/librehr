import {
  pgTable,
  text,
  uuid,
  timestamp,
  index,
  integer,
  boolean,
  date,
} from "drizzle-orm/pg-core";
import { primaryId, organizationIdCol } from "./common.js";
import { organizations } from "./platform.js";
import { employees } from "./people.js";

// ONB-001: Checklist templates (e.g. Standard Onboarding, Engineering Onboarding, Offboarding)
export const checklistTemplates = pgTable(
  "checklist_templates",
  {
    id: primaryId(),
    organizationId: organizationIdCol().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    type: text("type").notNull(), // onboarding, offboarding
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("checklist_templates_org_idx").on(table.organizationId)],
);

// ONB-001: Task definitions belonging to a template
export const checklistTemplateTasks = pgTable(
  "checklist_template_tasks",
  {
    id: primaryId(),
    organizationId: organizationIdCol().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    templateId: uuid("template_id")
      .notNull()
      .references(() => checklistTemplates.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    assignedRole: text("assigned_role").notNull().default("employee"), // employee, manager, admin
    dueOffsetDays: integer("due_offset_days").notNull().default(0), // relative to hire / termination date
    orderIndex: integer("order_index").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("checklist_tasks_template_idx").on(table.templateId)],
);

// ONB-002: Instantiated checklist runs for specific employees
export const checklistInstances = pgTable(
  "checklist_instances",
  {
    id: primaryId(),
    organizationId: organizationIdCol().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    templateId: uuid("template_id").references(() => checklistTemplates.id, {
      onDelete: "set null",
    }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // onboarding, offboarding
    title: text("title").notNull(),
    baseDate: date("base_date").notNull(), // Start date or termination date
    status: text("status").notNull().default("in_progress"), // in_progress, completed, cancelled
    completedAt: timestamp("completed_at", {
      withTimezone: true,
      mode: "date",
    }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("checklist_instances_org_idx").on(table.organizationId),
    index("checklist_instances_employee_idx").on(table.employeeId),
  ],
);

// ONB-002: Individual tasks in an active checklist run
export const checklistTasks = pgTable(
  "checklist_tasks",
  {
    id: primaryId(),
    organizationId: organizationIdCol().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    instanceId: uuid("instance_id")
      .notNull()
      .references(() => checklistInstances.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    assignedRole: text("assigned_role").notNull().default("employee"),
    assigneeEmployeeId: uuid("assignee_employee_id").references(
      () => employees.id,
      { onDelete: "set null" },
    ),
    dueDate: date("due_date").notNull(),
    isCompleted: boolean("is_completed").notNull().default(false),
    completedAt: timestamp("completed_at", {
      withTimezone: true,
      mode: "date",
    }),
    completedById: uuid("completed_by_id"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("checklist_run_tasks_instance_idx").on(table.instanceId),
    index("checklist_run_tasks_assignee_idx").on(table.assigneeEmployeeId),
  ],
);
