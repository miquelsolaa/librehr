import { addDays, isBeforeDate } from "../calendar/business-date.js";

export interface ChecklistTaskDefinition {
  title: string;
  description?: string | undefined;
  assignedRole: "employee" | "manager" | "admin";
  dueOffsetDays: number; // e.g. -3 (3 days before start/termination), 0 (on day 1), +7 (7 days after)
}

export interface ComputedChecklistTask {
  title: string;
  description?: string | undefined;
  assignedRole: "employee" | "manager" | "admin";
  dueDate: string; // YYYY-MM-DD
  isOverdue: boolean;
}

/**
 * Calculates concrete task due dates for an onboarding/offboarding checklist
 * relative to the target employee's start or termination date (ONB-001, ONB-002).
 * `currentDateStr` is "today" in the organization's time zone (see
 * `todayInZone`); it is required so the core never falls back to the UTC date.
 *
 * @example
 * computeChecklistTaskDueDates(
 *   [{ title: "Sign", assignedRole: "employee", dueOffsetDays: -1 }],
 *   "2027-01-01",
 *   "2027-01-01",
 * ); // => [{ title: "Sign", dueDate: "2026-12-31", isOverdue: true, ... }]
 */
export function computeChecklistTaskDueDates(
  tasks: ChecklistTaskDefinition[],
  baseDateStr: string, // YYYY-MM-DD
  currentDateStr: string, // YYYY-MM-DD
): ComputedChecklistTask[] {
  return tasks.map((task) => {
    const dueDate = addDays(baseDateStr, task.dueOffsetDays);
    return {
      title: task.title,
      description: task.description,
      assignedRole: task.assignedRole,
      dueDate,
      isOverdue: isBeforeDate(dueDate, currentDateStr),
    };
  });
}
