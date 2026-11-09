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

/** A schedule applying to an employee over a span of days (see core `ScheduleSpan`). */
export interface ScheduleSpanRow {
  scheduleId: string;
  isDefault: boolean;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  rules: { dayOfWeek: number; expectedHours: number }[];
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

  /**
   * Every schedule that can apply to an employee between two dates, in one
   * query: the assignments overlapping the period plus the organization
   * default, each with its day rules. Core resolves the schedule per day
   * (`resolveScheduleForDate`), so a timesheet never queries per day.
   */
  async getScheduleSpansForEmployee(
    tx: TenantTx,
    employeeId: string,
    startDate: string,
    endDate: string,
  ): Promise<ScheduleSpanRow[]> {
    const orgId = tx.__tenantContext.organizationId;
    const rows = await tx<
      {
        scheduleId: string;
        isDefault: boolean;
        effectiveFrom: string | null;
        effectiveTo: string | null;
        dayOfWeek: number | null;
        expectedHours: number | null;
      }[]
    >`
      WITH spans AS (
        SELECT es.schedule_id, false AS is_default,
               es.effective_from, es.effective_to
        FROM employee_schedules es
        WHERE es.employee_id = ${employeeId}
          AND es.organization_id = ${orgId}
          AND es.effective_from <= ${endDate}::date
          AND (es.effective_to IS NULL OR es.effective_to >= ${startDate}::date)
        UNION ALL
        SELECT d.id, true, NULL::date, NULL::date
        FROM (
          SELECT id FROM schedules
          WHERE is_default = true AND organization_id = ${orgId}
          LIMIT 1
        ) d
      )
      SELECT s.schedule_id AS "scheduleId", s.is_default AS "isDefault",
             s.effective_from::text AS "effectiveFrom",
             s.effective_to::text AS "effectiveTo",
             r.day_of_week AS "dayOfWeek",
             r.expected_hours::float AS "expectedHours"
      FROM spans s
      LEFT JOIN schedule_rules r
        ON r.schedule_id = s.schedule_id AND r.organization_id = ${orgId}
      ORDER BY s.is_default, s.effective_from, r.day_of_week
    `;

    const spans = new Map<string, ScheduleSpanRow>();
    for (const row of rows) {
      const key = `${row.scheduleId}|${row.isDefault}|${row.effectiveFrom ?? ""}`;
      let span = spans.get(key);
      if (!span) {
        span = {
          scheduleId: row.scheduleId,
          isDefault: row.isDefault,
          effectiveFrom: row.effectiveFrom,
          effectiveTo: row.effectiveTo,
          rules: [],
        };
        spans.set(key, span);
      }
      if (row.dayOfWeek !== null && row.expectedHours !== null) {
        span.rules.push({
          dayOfWeek: row.dayOfWeek,
          expectedHours: row.expectedHours,
        });
      }
    }
    return [...spans.values()];
  }

  /** The schedule in force for an employee on a business date. */
  async getForEmployee(
    tx: TenantTx,
    employeeId: string,
    checkDate: string,
  ): Promise<{ schedule: ScheduleRow; rules: ScheduleRuleRow[] } | null> {
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
