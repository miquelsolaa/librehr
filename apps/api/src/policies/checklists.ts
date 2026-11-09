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

/** The scope-relevant fields of the employee a checklist is about. */
export interface ChecklistSubject {
  id: string;
  organizationId: string;
  managerId: string | null;
}

/**
 * ONB-002: employee ids whose checklist instances the caller may read. HR/admin
 * (organization-scoped `employee.write`) see the whole organization; managers
 * their own and their direct reports'; everyone else (employees, auditors)
 * their own only.
 */
export function checklistInstanceReadScope(
  ctx: PolicyUserContext,
): "all" | ReadonlySet<string> {
  if (permissionScope(ctx, "employee.write") === "organization") return "all";
  const ids = new Set<string>(ctx.employeeId ? [ctx.employeeId] : []);
  if (permissionScope(ctx, "employee.read") === "reports") {
    for (const id of ctx.reports ?? []) ids.add(id);
  }
  return ids;
}

/**
 * ONB-002: who may instantiate a checklist for an employee. HR/admin for
 * anyone in the organization; a manager for a direct report only (not for
 * themselves); nobody else.
 */
export function canAssignChecklist(
  ctx: PolicyUserContext,
  subject: ChecklistSubject,
): boolean {
  if (subject.organizationId !== ctx.organizationId) return false;
  if (permissionScope(ctx, "employee.write") === "organization") return true;
  if (!mayAssignChecklists(ctx)) return false;
  return (
    Boolean(ctx.employeeId) &&
    subject.id !== ctx.employeeId &&
    subject.managerId === ctx.employeeId
  );
}
/**
 * Whether the caller's role may assign checklists to anyone at all, checked
 * before looking the employee up so roles without the right get a plain 403.
 */
export function mayAssignChecklists(
  ctx: Pick<PolicyUserContext, "role">,
): boolean {
  const role = { ...ctx, userId: "", organizationId: "" };
  return (
    permissionScope(role, "employee.write") === "organization" ||
    permissionScope(role, "employee.read") === "reports"
  );
}
