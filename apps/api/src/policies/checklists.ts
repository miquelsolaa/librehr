import { permissionScope, type PolicyUserContext } from "./can.js";

export interface ChecklistTaskOwnership {
  assignedRole: string;
  assigneeEmployeeId: string | null;
  subjectEmployeeId: string;
  /** Manager (employee id) of the employee the checklist is about. */
  subjectManagerId: string | null;
}

/**
 * ONB-002: a task is completed by its owner. HR/admin may toggle any task;
 * otherwise the explicit assignee, or the owner role relative to the
 * checklist's employee: "employee" is that employee, "manager" their
 * manager, "admin" administrators only.
 */
export function canToggleChecklistTask(
  ctx: PolicyUserContext,
  task: ChecklistTaskOwnership,
): boolean {
  if (permissionScope(ctx, "employee.write") === "organization") return true;
  if (!ctx.employeeId) return false;
  if (task.assigneeEmployeeId)
    return task.assigneeEmployeeId === ctx.employeeId;
  switch (task.assignedRole) {
    case "employee":
      return task.subjectEmployeeId === ctx.employeeId;
    case "manager":
      return task.subjectManagerId === ctx.employeeId;
    default:
      return false;
  }
}
