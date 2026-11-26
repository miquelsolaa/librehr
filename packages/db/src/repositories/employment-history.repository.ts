import type { TenantTx } from "../with-tenant.js";

interface EmploymentPeriod {
  id: string;
  jobTitle: string;
  employmentType: string;
  workingHoursPerWeek: number;
  startDate: string;
  endDate: string | null;
}
type CreateEmploymentPeriod = Omit<
  EmploymentPeriod,
  "id" | "endDate" | "workingHoursPerWeek"
> & {
  endDate?: string | null | undefined;
  workingHoursPerWeek?: number | undefined;
};

export interface CreatedEmploymentPeriod {
  period: EmploymentPeriod;
  /** Id of the open-ended period this one closed, if any. */
  closedPeriodId: string | null;
}

export class EmploymentHistoryRepository {
  async list(tx: TenantTx, employeeId: string): Promise<EmploymentPeriod[]> {
    return tx<EmploymentPeriod[]>`
      SELECT id, job_title AS "jobTitle", employment_type AS "employmentType",
             working_hours_per_week::float AS "workingHoursPerWeek",
             start_date::text AS "startDate", end_date::text AS "endDate"
      FROM employments WHERE employee_id = ${employeeId}
      ORDER BY start_date DESC, id DESC`;
  }

  /**
   * Appends a period (LEA-002, #131). A period that starts after the start of
   * the open-ended current period closes it the day before, so a change of
   * contract hours never rewrites the hours of time already worked. Any other
   * overlap returns null. Callers lock the employee row first.
   */
  async create(
    tx: TenantTx,
    employeeId: string,
    data: CreateEmploymentPeriod,
  ): Promise<CreatedEmploymentPeriod | null> {
    const open = await tx<{ id: string }[]>`
      SELECT id FROM employments
      WHERE employee_id = ${employeeId} AND end_date IS NULL
        AND start_date < ${data.startDate}::date`;
    const closedPeriodId = open[0]?.id ?? null;
    const conflicting = await tx<{ exists: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM employments WHERE employee_id = ${employeeId}
        AND id IS DISTINCT FROM ${closedPeriodId}::uuid
        AND daterange(start_date, COALESCE(end_date, 'infinity'::date), '[]') &&
            daterange(${data.startDate}::date, COALESCE(${data.endDate ?? null}::date, 'infinity'::date), '[]')) AS exists`;
    if (conflicting[0]?.exists) return null;
    if (closedPeriodId) {
      await tx`
        UPDATE employments
        SET end_date = ${data.startDate}::date - 1, updated_at = now()
        WHERE id = ${closedPeriodId}`;
    }
    const rows = await tx<EmploymentPeriod[]>`
      INSERT INTO employments (employee_id, job_title, employment_type,
        working_hours_per_week, start_date, end_date)
      VALUES (${employeeId}, ${data.jobTitle}, ${data.employmentType},
        ${data.workingHoursPerWeek ?? 40}, ${data.startDate}, ${data.endDate ?? null})
      RETURNING id, job_title AS "jobTitle", employment_type AS "employmentType",
                working_hours_per_week::float AS "workingHoursPerWeek",
                start_date::text AS "startDate", end_date::text AS "endDate"`;
    const period = rows[0];
    return period ? { period, closedPeriodId } : null;
  }
}
