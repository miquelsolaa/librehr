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
  async list(tx: TenantTx): Promise<ScheduleRow[]> {
    return tx<ScheduleRow[]>`
      SELECT id, organization_id as "organizationId", name, type,
             weekly_hours::float as "weeklyHours",
             minimum_daily_rest_hours::float as "minimumDailyRestHours",
             is_default as "isDefault", created_at as "createdAt", updated_at as "updatedAt"
      FROM schedules
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
      WHERE id = ${scheduleId}
      LIMIT 1
    `;

    if (!sRows[0]) return null;

    const rRows = await tx<ScheduleRuleRow[]>`
      SELECT id, organization_id as "organizationId", schedule_id as "scheduleId",
             day_of_week as "dayOfWeek", expected_hours::float as "expectedHours",
             core_start_minutes as "coreStartMinutes", core_end_minutes as "coreEndMinutes",
             break_minutes as "breakMinutes", created_at as "createdAt", updated_at as "updatedAt"
      FROM schedule_rules
      WHERE schedule_id = ${scheduleId}
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
        AND effective_from <= ${checkDate}
        AND (effective_to IS NULL OR effective_to >= ${checkDate})
      ORDER BY effective_from DESC
      LIMIT 1
    `;

    let scheduleId = assigned[0]?.scheduleId;

    if (!scheduleId) {
      const defaultSched = await tx<{ id: string }[]>`
        SELECT id FROM schedules WHERE is_default = true LIMIT 1
      `;
      scheduleId = defaultSched[0]?.id;
    }

    if (!scheduleId) return null;
    return this.getScheduleWithRules(tx, scheduleId);
  }
}
