import type { TenantTx } from "../with-tenant.js";

export interface TimeBankRecordRow {
  id: string;
  organizationId: string;
  employeeId: string;
  type: string;
  minutes: number;
  referenceDate: string;
  notes: string | null;
  createdAt: Date;
}

/** TIM-012: time bank operations. */
export class TimeBankRepository {
  async createTimeBankRecord(
    tx: TenantTx,
    data: {
      employeeId: string;
      type: string;
      minutes: number;
      referenceDate: string;
      notes?: string | undefined;
      actorId: string;
    },
  ): Promise<TimeBankRecordRow> {
    const rows = await tx<TimeBankRecordRow[]>`
      INSERT INTO time_bank_records (
        employee_id, type, minutes, reference_date, notes, actor_id
      ) VALUES (
        ${data.employeeId},
        ${data.type},
        ${data.minutes},
        ${data.referenceDate},
        ${data.notes ?? null},
        ${data.actorId}
      )
      RETURNING id, organization_id as "organizationId", employee_id as "employeeId",
                type, minutes, reference_date as "referenceDate", notes, created_at as "createdAt"
    `;
    return rows[0]!;
  }

  async getTimeBankRecords(
    tx: TenantTx,
    employeeId: string,
  ): Promise<TimeBankRecordRow[]> {
    return tx<TimeBankRecordRow[]>`
      SELECT id, organization_id as "organizationId", employee_id as "employeeId",
             type, minutes, reference_date as "referenceDate", notes, created_at as "createdAt"
      FROM time_bank_records
      WHERE employee_id = ${employeeId}
      ORDER BY reference_date DESC, created_at DESC
    `;
  }
}
