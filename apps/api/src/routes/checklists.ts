import { Hono } from "hono";
import type { Sql } from "postgres";
import {
  type AuthUser,
  createProblemDetails,
  CreateChecklistTemplateSchema,
  InstantiateChecklistSchema,
  ToggleChecklistTaskSchema,
} from "@librehr/contracts";
import { computeChecklistTaskDueDates } from "@librehr/core";
import {
  withTenant,
  ChecklistRepository,
  EmployeeRepository,
  AuditRepository,
} from "@librehr/db";
import { NotFoundError } from "../errors/index.js";
import { IdParamSchema, parseJsonBody, parseParams } from "../lib/validate.js";
import { requireAuth } from "../middleware/auth.js";

export function createChecklistRoutes(sql: Sql) {
  const router = new Hono();
  const checklistRepo = new ChecklistRepository();
  const empRepo = new EmployeeRepository();
  const auditRepo = new AuditRepository();

  // 1. GET /checklists/templates - List templates
  router.get("/checklists/templates", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;
    const type = c.req.query("type");

    const templates = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        return checklistRepo.listTemplates(tx, type);
      },
    );

    return c.json(
      templates.map((t) => ({
        ...t,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
      })),
    );
  });

  // 2. POST /checklists/templates - Create template (admin/manager)
  router.post("/checklists/templates", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;

    if (user.role !== "admin") {
      return c.json(
        createProblemDetails({
          status: 403,
          title: "Forbidden",
          detail: "Only administrators can configure checklist templates",
          code: "FORBIDDEN",
        }),
        403,
        { "Content-Type": "application/problem+json" },
      );
    }

    const data = await parseJsonBody(c, CreateChecklistTemplateSchema, {
      status: 422,
      detail: "Invalid template payload",
    });

    const template = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        const created = await checklistRepo.createTemplate(tx, data);
        await auditRepo.log(tx, {
          actorId: user.id,
          action: "checklist.template_create",
          resourceType: "checklist_template",
          resourceId: created.id,
          metadata: { name: created.name, type: created.type },
        });
        return created;
      },
    );

    return c.json(
      {
        ...template,
        createdAt: template.createdAt.toISOString(),
        updatedAt: template.updatedAt.toISOString(),
      },
      201,
    );
  });

  // 3. GET /checklists/instances - List checklist instances
  router.get("/checklists/instances", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;
    const employeeId = c.req.query("employeeId");
    const status = c.req.query("status");

    const instances = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        const currentEmp = await empRepo.findByUserId(tx, user.id);

        // Employees can only view their own checklist instances
        if (
          user.role === "employee" &&
          employeeId &&
          currentEmp &&
          employeeId !== currentEmp.id
        ) {
          return "FORBIDDEN";
        }

        const targetEmployeeId =
          user.role === "employee" ? (currentEmp?.id ?? "none") : employeeId;

        return checklistRepo.listInstances(tx, {
          employeeId: targetEmployeeId,
          status,
        });
      },
    );

    if (instances === "FORBIDDEN") {
      return c.json(
        createProblemDetails({
          status: 403,
          title: "Forbidden",
          detail: "Cannot view other employee's checklists",
          code: "FORBIDDEN",
        }),
        403,
        { "Content-Type": "application/problem+json" },
      );
    }

    return c.json(
      instances.map((i) => ({
        ...i,
        completedAt: i.completedAt?.toISOString() ?? null,
        createdAt: i.createdAt.toISOString(),
        updatedAt: i.updatedAt.toISOString(),
      })),
    );
  });

  // 4. POST /checklists/instances - Instantiate a checklist (ONB-001, ONB-002)
  router.post("/checklists/instances", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;

    if (user.role === "employee") {
      return c.json(
        createProblemDetails({
          status: 403,
          title: "Forbidden",
          detail: "Only managers or admins can assign checklists",
          code: "FORBIDDEN",
        }),
        403,
        { "Content-Type": "application/problem+json" },
      );
    }

    const { templateId, employeeId, baseDate, customTitle } =
      await parseJsonBody(c, InstantiateChecklistSchema, {
        status: 422,
        detail: "Invalid checklist instantiation payload",
      });

    const instance = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        const templateTasks = await checklistRepo.getTemplateTasks(
          tx,
          templateId,
        );
        const employee = await empRepo.findById(tx, employeeId);
        if (!employee) {
          throw new NotFoundError({ detail: "Employee not found" });
        }

        const scheduledTasks = computeChecklistTaskDueDates(
          templateTasks.map((t) => ({
            title: t.title,
            description: t.description ?? undefined,
            assignedRole: t.assignedRole as "employee" | "manager" | "admin",
            dueOffsetDays: t.dueOffsetDays,
          })),
          baseDate,
        );

        const inst = await checklistRepo.instantiateChecklist(tx, {
          templateId,
          employeeId,
          type: "onboarding",
          title:
            customTitle ??
            `Onboarding - ${employee.firstName} ${employee.lastName}`,
          baseDate,
          tasks: scheduledTasks.map((st) => ({
            title: st.title,
            description: st.description ?? null,
            assignedRole: st.assignedRole,
            dueDate: st.dueDate,
          })),
        });

        await auditRepo.log(tx, {
          actorId: user.id,
          action: "checklist.instantiate",
          resourceType: "checklist_instance",
          resourceId: inst.id,
          metadata: { title: inst.title, employeeId, baseDate },
        });

        return inst;
      },
    );

    return c.json(
      {
        ...instance,
        completedAt: instance.completedAt?.toISOString() ?? null,
        createdAt: instance.createdAt.toISOString(),
        updatedAt: instance.updatedAt.toISOString(),
      },
      201,
    );
  });

  // 5. PATCH /checklists/tasks/:id - Toggle task completion status
  router.patch("/checklists/tasks/:id", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;
    const { id: taskId } = parseParams(c, IdParamSchema, {
      detail: "Checklist task not found",
    });
    const body = await parseJsonBody(c, ToggleChecklistTaskSchema);

    const updatedTask = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        const task = await checklistRepo.toggleTask(
          tx,
          taskId,
          body.isCompleted,
          user.id,
        );

        if (task) {
          await auditRepo.log(tx, {
            actorId: user.id,
            action: "checklist.task_toggle",
            resourceType: "checklist_task",
            resourceId: taskId,
            metadata: { isCompleted: body.isCompleted },
          });
        }

        return task;
      },
    );

    if (!updatedTask) {
      return c.json(
        createProblemDetails({
          status: 404,
          title: "Not Found",
          detail: "Checklist task not found",
          code: "NOT_FOUND",
        }),
        404,
        { "Content-Type": "application/problem+json" },
      );
    }

    return c.json({
      ...updatedTask,
      completedAt: updatedTask.completedAt?.toISOString() ?? null,
    });
  });

  return router;
}
