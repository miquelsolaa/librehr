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
 */
export function computeChecklistTaskDueDates(
  tasks: ChecklistTaskDefinition[],
  baseDateStr: string, // YYYY-MM-DD
  currentDateStr: string = new Date().toISOString().slice(0, 10),
): ComputedChecklistTask[] {
  const baseDate = new Date(`${baseDateStr}T00:00:00Z`);
  const currentDate = new Date(`${currentDateStr}T00:00:00Z`);

  return tasks.map((task) => {
    const taskDate = new Date(baseDate.getTime());
    taskDate.setUTCDate(taskDate.getUTCDate() + task.dueOffsetDays);
    const dueDate = taskDate.toISOString().slice(0, 10);

    const isOverdue = taskDate.getTime() < currentDate.getTime();

    return {
      title: task.title,
      description: task.description,
      assignedRole: task.assignedRole,
      dueDate,
      isOverdue,
    };
  });
}
