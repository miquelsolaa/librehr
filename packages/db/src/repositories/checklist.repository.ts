import type { TenantTx } from "../with-tenant.js";

export interface ChecklistTemplateRow {
  id: string;
  organizationId: string;
  name: string;
  type: string;
  description: string | null;
  tasksCount?: number | undefined;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChecklistTemplateTaskRow {
  id: string;
  organizationId: string;
  templateId: string;
  title: string;
  description: string | null;
  assignedRole: string;
  dueOffsetDays: number;
  orderIndex: number;
  createdAt: Date;
}

export interface ChecklistInstanceRow {
  id: string;
  organizationId: string;
  templateId: string | null;
  employeeId: string;
  employeeName?: string | undefined;
  type: string;
  title: string;
  baseDate: string;
  status: string;
  completedAt: Date | null;
  totalTasks: number;
  completedTasks: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChecklistTaskRow {
  id: string;
  organizationId: string;
  instanceId: string;
  title: string;
  description: string | null;
  assignedRole: string;
  assigneeEmployeeId: string | null;
  dueDate: string;
  isCompleted: boolean;
  completedAt: Date | null;
  completedById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export class ChecklistRepository {
  async listTemplates(
    tx: TenantTx,
    type?: string | undefined,
  ): Promise<ChecklistTemplateRow[]> {
    return tx<ChecklistTemplateRow[]>`
      SELECT t.id, t.organization_id as "organizationId", t.name, t.type,
             t.description, COUNT(tsk.id)::int as "tasksCount",
             t.created_at as "createdAt", t.updated_at as "updatedAt"
      FROM checklist_templates t
      LEFT JOIN checklist_template_tasks tsk ON tsk.template_id = t.id
      WHERE (${type ?? null}::text IS NULL OR t.type = ${type ?? null})
      GROUP BY t.id
      ORDER BY t.name ASC
    `;
  }

  /** Whether a template exists in the current organization. */
  async templateExists(tx: TenantTx, templateId: string): Promise<boolean> {
    const rows = await tx`
      SELECT 1 FROM checklist_templates
      WHERE id = ${templateId}
        AND organization_id = ${tx.__tenantContext.organizationId}
      LIMIT 1
    `;
    return rows.length > 0;
  }

  async getTemplateTasks(
    tx: TenantTx,
    templateId: string,
  ): Promise<ChecklistTemplateTaskRow[]> {
    return tx<ChecklistTemplateTaskRow[]>`
      SELECT id, organization_id as "organizationId", template_id as "templateId",
             title, description, assigned_role as "assignedRole",
             due_offset_days as "dueOffsetDays", order_index as "orderIndex",
             created_at as "createdAt"
      FROM checklist_template_tasks
      WHERE template_id = ${templateId}
      ORDER BY order_index ASC, due_offset_days ASC
    `;
  }

  async createTemplate(
    tx: TenantTx,
    data: {
      name: string;
      type: "onboarding" | "offboarding";
      description?: string | null | undefined;
      tasks: {
        title: string;
        description?: string | null | undefined;
        assignedRole: "employee" | "manager" | "admin";
        dueOffsetDays: number;
      }[];
    },
  ): Promise<ChecklistTemplateRow> {
    const tRows = await tx<ChecklistTemplateRow[]>`
      INSERT INTO checklist_templates (name, type, description)
      VALUES (${data.name}, ${data.type}, ${data.description ?? null})
      RETURNING id, organization_id as "organizationId", name, type, description,
                created_at as "createdAt", updated_at as "updatedAt"
    `;
    const template = tRows[0]!;

    for (let i = 0; i < data.tasks.length; i++) {
      const task = data.tasks[i]!;
      await tx`
        INSERT INTO checklist_template_tasks (
          template_id, title, description, assigned_role,
          due_offset_days, order_index
        ) VALUES (
          ${template.id},
          ${task.title},
          ${task.description ?? null},
          ${task.assignedRole},
          ${task.dueOffsetDays},
          ${i}
        )
      `;
    }

    return template;
  }

  async instantiateChecklist(
    tx: TenantTx,
    data: {
      templateId?: string | null | undefined;
      employeeId: string;
      type: "onboarding" | "offboarding";
      title: string;
      baseDate: string;
      tasks: {
        title: string;
        description?: string | null | undefined;
        assignedRole: "employee" | "manager" | "admin";
        assigneeEmployeeId?: string | null | undefined;
        dueDate: string;
      }[];
    },
  ): Promise<ChecklistInstanceRow> {
    const instRows = await tx<{ id: string }[]>`
      INSERT INTO checklist_instances (
        template_id, employee_id, type, title, base_date, status
      ) VALUES (
        ${data.templateId ?? null},
        ${data.employeeId},
        ${data.type},
        ${data.title},
        ${data.baseDate},
        'in_progress'
      )
      RETURNING id
    `;
    const instanceId = instRows[0]!.id;

    for (const t of data.tasks) {
      await tx`
        INSERT INTO checklist_tasks (
          instance_id, title, description, assigned_role,
          assignee_employee_id, due_date, is_completed
        ) VALUES (
          ${instanceId},
          ${t.title},
          ${t.description ?? null},
          ${t.assignedRole},
          ${t.assigneeEmployeeId ?? null},
          ${t.dueDate},
          false
        )
      `;
    }

    const full = await this.getInstanceById(tx, instanceId);
    return full!;
  }

  async getInstanceById(
    tx: TenantTx,
    id: string,
  ): Promise<ChecklistInstanceRow | null> {
    const rows = await tx<ChecklistInstanceRow[]>`
      SELECT i.id, i.organization_id as "organizationId", i.template_id as "templateId",
             i.employee_id as "employeeId",
             CONCAT(e.first_name, ' ', e.last_name) as "employeeName",
             i.type, i.title, i.base_date::text as "baseDate", i.status,
             i.completed_at as "completedAt",
             COUNT(t.id)::int as "totalTasks",
             COUNT(CASE WHEN t.is_completed THEN 1 END)::int as "completedTasks",
             i.created_at as "createdAt", i.updated_at as "updatedAt"
      FROM checklist_instances i
      JOIN employees e ON e.id = i.employee_id
      LEFT JOIN checklist_tasks t ON t.instance_id = i.id
      WHERE i.id = ${id}
      GROUP BY i.id, e.first_name, e.last_name
      LIMIT 1
    `;
    return rows[0] ?? null;
  }

  async listInstances(
    tx: TenantTx,
    filters: {
      employeeId?: string | undefined;
      status?: string | undefined;
    } = {},
  ): Promise<ChecklistInstanceRow[]> {
    return tx<ChecklistInstanceRow[]>`
      SELECT i.id, i.organization_id as "organizationId", i.template_id as "templateId",
             i.employee_id as "employeeId",
             CONCAT(e.first_name, ' ', e.last_name) as "employeeName",
             i.type, i.title, i.base_date::text as "baseDate", i.status,
             i.completed_at as "completedAt",
             COUNT(t.id)::int as "totalTasks",
             COUNT(CASE WHEN t.is_completed THEN 1 END)::int as "completedTasks",
             i.created_at as "createdAt", i.updated_at as "updatedAt"
      FROM checklist_instances i
      JOIN employees e ON e.id = i.employee_id
      LEFT JOIN checklist_tasks t ON t.instance_id = i.id
      WHERE (${filters.employeeId ?? null}::uuid IS NULL OR i.employee_id = ${filters.employeeId ?? null})
        AND (${filters.status ?? null}::text IS NULL OR i.status = ${filters.status ?? null})
      GROUP BY i.id, e.first_name, e.last_name
      ORDER BY i.created_at DESC
    `;
  }

  async getTasksForInstance(
    tx: TenantTx,
    instanceId: string,
  ): Promise<ChecklistTaskRow[]> {
    return tx<ChecklistTaskRow[]>`
      SELECT id, organization_id as "organizationId", instance_id as "instanceId",
             title, description, assigned_role as "assignedRole",
             assignee_employee_id as "assigneeEmployeeId", due_date::text as "dueDate",
             is_completed as "isCompleted", completed_at as "completedAt",
             completed_by_id as "completedById",
             created_at as "createdAt", updated_at as "updatedAt"
      FROM checklist_tasks
      WHERE instance_id = ${instanceId}
      ORDER BY due_date ASC
    `;
  }

  /** A task with the employee its checklist is about, for owner checks. */
  async findTaskOwnership(
    tx: TenantTx,
    taskId: string,
  ): Promise<{
    assignedRole: string;
    assigneeEmployeeId: string | null;
    subjectEmployeeId: string;
  } | null> {
    const rows = await tx<
      {
        assignedRole: string;
        assigneeEmployeeId: string | null;
        subjectEmployeeId: string;
      }[]
    >`
      SELECT t.assigned_role as "assignedRole",
             t.assignee_employee_id as "assigneeEmployeeId",
             i.employee_id as "subjectEmployeeId"
      FROM checklist_tasks t
      JOIN checklist_instances i ON i.id = t.instance_id
      WHERE t.id = ${taskId}
        AND t.organization_id = ${tx.__tenantContext.organizationId}
      LIMIT 1
    `;
    return rows[0] ?? null;
  }

  async toggleTask(
    tx: TenantTx,
    taskId: string,
    completed: boolean,
    completedById: string,
  ): Promise<ChecklistTaskRow> {
    const updated = await tx<ChecklistTaskRow[]>`
      UPDATE checklist_tasks
      SET is_completed = ${completed},
          completed_at = ${completed ? new Date() : null},
          completed_by_id = ${completed ? completedById : null},
          updated_at = now()
      WHERE id = ${taskId}
      RETURNING id, organization_id as "organizationId", instance_id as "instanceId",
                title, description, assigned_role as "assignedRole",
                assignee_employee_id as "assigneeEmployeeId", due_date::text as "dueDate",
                is_completed as "isCompleted", completed_at as "completedAt",
                completed_by_id as "completedById",
                created_at as "createdAt", updated_at as "updatedAt"
    `;

    return updated[0]!;
  }
}
