import { z } from "zod";

export const ChecklistTemplateTaskSchema = z.object({
  id: z.guid().optional(),
  title: z.string().min(1, "Title is required"),
  description: z.string().nullable().optional(),
  assignedRole: z.enum(["employee", "manager", "admin"]),
  dueOffsetDays: z.number().int(),
  orderIndex: z.number().int().optional(),
});
export type ChecklistTemplateTask = z.infer<typeof ChecklistTemplateTaskSchema>;

export const ChecklistTemplateSchema = z.object({
  id: z.guid(),
  name: z.string().min(1, "Name is required"),
  type: z.enum(["onboarding", "offboarding"]),
  description: z.string().nullable().optional(),
  tasksCount: z.number().int().optional(),
  tasks: z.array(ChecklistTemplateTaskSchema).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ChecklistTemplate = z.infer<typeof ChecklistTemplateSchema>;

export const CreateChecklistTemplateSchema = z.object({
  name: z.string().min(1, "Name is required"),
  type: z.enum(["onboarding", "offboarding"]),
  description: z.string().optional(),
  tasks: z.array(
    z.object({
      title: z.string().min(1, "Task title is required"),
      description: z.string().optional(),
      assignedRole: z.enum(["employee", "manager", "admin"]),
      dueOffsetDays: z.number().int().default(0),
    }),
  ),
});
export type CreateChecklistTemplate = z.infer<
  typeof CreateChecklistTemplateSchema
>;

export const ChecklistTaskSchema = z.object({
  id: z.guid(),
  instanceId: z.guid(),
  title: z.string(),
  description: z.string().nullable().optional(),
  assignedRole: z.enum(["employee", "manager", "admin"]),
  assigneeEmployeeId: z.guid().nullable().optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  isCompleted: z.boolean(),
  completedAt: z.string().datetime().nullable().optional(),
  completedById: z.guid().nullable().optional(),
});
export type ChecklistTask = z.infer<typeof ChecklistTaskSchema>;

export const ChecklistInstanceSchema = z.object({
  id: z.guid(),
  templateId: z.guid().nullable().optional(),
  employeeId: z.guid(),
  employeeName: z.string().optional(),
  type: z.enum(["onboarding", "offboarding"]),
  title: z.string(),
  baseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.enum(["in_progress", "completed", "cancelled"]),
  completedAt: z.string().datetime().nullable().optional(),
  totalTasks: z.number().int(),
  completedTasks: z.number().int(),
  tasks: z.array(ChecklistTaskSchema).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ChecklistInstance = z.infer<typeof ChecklistInstanceSchema>;

export const InstantiateChecklistSchema = z.object({
  templateId: z.guid(),
  employeeId: z.guid(),
  baseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  customTitle: z.string().optional(),
});
export type InstantiateChecklist = z.infer<typeof InstantiateChecklistSchema>;

export const ToggleChecklistTaskSchema = z.object({
  isCompleted: z.boolean(),
});
export type ToggleChecklistTask = z.infer<typeof ToggleChecklistTaskSchema>;

export const EmployeeImportRequestSchema = z.object({
  csvContent: z.string().min(1, "csvContent is required"),
  dryRun: z.boolean().optional(),
});
export type EmployeeImportRequest = z.infer<typeof EmployeeImportRequestSchema>;

export const EmployeeImportValidationResponseSchema = z.object({
  valid: z.boolean(),
  totalRows: z.number().int(),
  validRowsCount: z.number().int(),
  errors: z.array(
    z.object({
      row: z.number().int(),
      field: z.string(),
      message: z.string(),
    }),
  ),
  importedCount: z.number().int().optional(),
});
export type EmployeeImportValidationResponse = z.infer<
  typeof EmployeeImportValidationResponseSchema
>;

export const DataSubjectExportResponseSchema = z.object({
  exportedAt: z.string().datetime(),
  employee: z.record(z.string(), z.unknown()),
  leaveSummary: z.record(z.string(), z.unknown()),
  timeRecords: z.array(z.record(z.string(), z.unknown())),
  documents: z.array(z.record(z.string(), z.unknown())),
});
export type DataSubjectExportResponse = z.infer<
  typeof DataSubjectExportResponseSchema
>;
