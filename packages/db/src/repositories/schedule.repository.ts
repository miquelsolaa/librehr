import type { TenantTx } from "../with-tenant.js";

export interface ScheduleRow {
  id: string;
  organizationId: string;
  name: string;
  type: string;
  weeklyHours: number;
  minimumDailyRestHours: number;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ScheduleRuleRow {
  id: string;
  organizationId: string;
  scheduleId: string;
  dayOfWeek: number;
  expectedHours: number;
  coreStartMinutes: number | null;
  coreEndMinutes: number | null;
  breakMinutes: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export class ScheduleRepository {
  async createAssignment(
    tx: TenantTx,
    data: {
      employeeId: string;
      name: string;
      effectiveFrom: string;
      minimumDailyRestHours: number;
      rules: Array<{
        dayOfWeek: number;
        expectedHours: number;
        breakMinutes: number;
      }>;
    },
  ): Promise<"NOT_FOUND" | "OVERLAP" | { id: string }> {
    const orgId = tx.__tenantContext.organizationId;
    const employees = await tx<
      { id: string }[]
    >`SELECT id FROM employees WHERE id = ${data.employeeId} AND organization_id = ${orgId} FOR UPDATE`;
    if (!employees[0]) return "NOT_FOUND";
    const overlaps = await tx<
      { id: string }[]
    >`SELECT id FROM employee_schedules WHERE employee_id = ${data.employeeId} AND organization_id = ${orgId} AND (effective_to IS NULL OR effective_to >= ${data.effectiveFrom}::date) LIMIT 1`;
    if (overlaps[0]) return "OVERLAP";
    const weeklyHours = data.rules.reduce(
      (sum, rule) => sum + rule.expectedHours,
      0,
    );
    const schedules = await tx<
      { id: string }[]
    >`INSERT INTO schedules (name, type, weekly_hours, minimum_daily_rest_hours, is_default) VALUES (${data.name}, 'fixed', ${weeklyHours}, ${data.minimumDailyRestHours}, false) RETURNING id`;
    const schedule = schedules[0];
    if (!schedule) throw new Error("Schedule creation failed");
    for (const rule of data.rules) {
      await tx`INSERT INTO schedule_rules (schedule_id, day_of_week, expected_hours, break_minutes) VALUES (${schedule.id}, ${rule.dayOfWeek}, ${rule.expectedHours}, ${rule.breakMinutes})`;
    }
    await tx`INSERT INTO employee_schedules (employee_id, schedule_id, effective_from) VALUES (${data.employeeId}, ${schedule.id}, ${data.effectiveFrom}::date)`;
    return schedule;
  }

  async list(tx: TenantTx): Promise<ScheduleRow[]> {
    return tx<ScheduleRow[]>`
      SELECT id, organization_id as "organizationId", name, type,
             weekly_hours::float as "weeklyHours",
             minimum_daily_rest_hours::float as "minimumDailyRestHours",
             is_default as "isDefault", created_at as "createdAt", updated_at as "updatedAt"
      FROM schedules
      WHERE organization_id = ${tx.__tenantContext.organizationId}
      ORDER BY is_default DESC, name ASC
    `;
  }

  async getScheduleWithRules(
    tx: TenantTx,
    scheduleId: string,
  ): Promise<{ schedule: ScheduleRow; rules: ScheduleRuleRow[] } | null> {
    const sRows = await tx<ScheduleRow[]>`
      SELECT id, organization_id as "organizationId", name, type,
             weekly_hours::float as "weeklyHours",
             minimum_daily_rest_hours::float as "minimumDailyRestHours",
             is_default as "isDefault", created_at as "createdAt", updated_at as "updatedAt"
      FROM schedules
      WHERE id = ${scheduleId} AND organization_id = ${tx.__tenantContext.organizationId}
      LIMIT 1
    `;

    if (!sRows[0]) return null;

    const rRows = await tx<ScheduleRuleRow[]>`
      SELECT id, organization_id as "organizationId", schedule_id as "scheduleId",
             day_of_week as "dayOfWeek", expected_hours::float as "expectedHours",
             core_start_minutes as "coreStartMinutes", core_end_minutes as "coreEndMinutes",
             break_minutes as "breakMinutes", created_at as "createdAt", updated_at as "updatedAt"
      FROM schedule_rules
      WHERE schedule_id = ${scheduleId} AND organization_id = ${tx.__tenantContext.organizationId}
      ORDER BY day_of_week ASC
    `;

    return { schedule: sRows[0], rules: rRows };
  }

  async getForEmployee(
    tx: TenantTx,
    employeeId: string,
    onDate?: string | undefined,
  ): Promise<{ schedule: ScheduleRow; rules: ScheduleRuleRow[] } | null> {
    const checkDate = onDate ?? new Date().toISOString().slice(0, 10);

    const assigned = await tx<{ scheduleId: string }[]>`
      SELECT schedule_id as "scheduleId"
      FROM employee_schedules
      WHERE employee_id = ${employeeId}
        AND organization_id = ${tx.__tenantContext.organizationId}
        AND effective_from <= ${checkDate}
        AND (effective_to IS NULL OR effective_to >= ${checkDate})
      ORDER BY effective_from DESC
      LIMIT 1
    `;

    let scheduleId = assigned[0]?.scheduleId;

    if (!scheduleId) {
      const defaultSched = await tx<{ id: string }[]>`
        SELECT id FROM schedules WHERE is_default = true AND organization_id = ${tx.__tenantContext.organizationId} LIMIT 1
      `;
      scheduleId = defaultSched[0]?.id;
    }

    if (!scheduleId) return null;
    return this.getScheduleWithRules(tx, scheduleId);
  }
}
