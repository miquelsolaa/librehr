import type { TenantTx } from "../with-tenant.js";

interface EmploymentPeriod {
  id: string;
  jobTitle: string;
  employmentType: string;
  startDate: string;
  endDate: string | null;
}
type CreateEmploymentPeriod = Omit<EmploymentPeriod, "id" | "endDate"> & {
  endDate?: string | null | undefined;
};

export class EmploymentHistoryRepository {
  async list(tx: TenantTx, employeeId: string): Promise<EmploymentPeriod[]> {
    return tx<EmploymentPeriod[]>`
      SELECT id, job_title AS "jobTitle", employment_type AS "employmentType",
             start_date::text AS "startDate", end_date::text AS "endDate"
      FROM employments WHERE employee_id = ${employeeId}
      ORDER BY start_date DESC, id DESC`;
  }

  async create(
    tx: TenantTx,
    employeeId: string,
    data: CreateEmploymentPeriod,
  ): Promise<EmploymentPeriod | null> {
    const conflicting = await tx<{ exists: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM employments WHERE employee_id = ${employeeId}
        AND daterange(start_date, COALESCE(end_date, 'infinity'::date), '[]') &&
            daterange(${data.startDate}::date, COALESCE(${data.endDate ?? null}::date, 'infinity'::date), '[]')) AS exists`;
    if (conflicting[0]?.exists) return null;
    const rows = await tx<EmploymentPeriod[]>`
      INSERT INTO employments (employee_id, job_title, employment_type, start_date, end_date)
      VALUES (${employeeId}, ${data.jobTitle}, ${data.employmentType}, ${data.startDate}, ${data.endDate ?? null})
      RETURNING id, job_title AS "jobTitle", employment_type AS "employmentType",
                start_date::text AS "startDate", end_date::text AS "endDate"`;
    return rows[0] ?? null;
  }
}
