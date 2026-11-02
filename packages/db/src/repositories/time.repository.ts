import type { TenantTx } from "../with-tenant.js";

export interface TimeEventRow {
  id: string;
  organizationId: string;
  employeeId: string;
  eventType: string; // clock_in, clock_out, break_start, break_end, correction
  occurredAt: Date;
  recordedAt: Date;
  source: string;
  actorId: string;
  refEventId: string | null;
  reason: string | null;
  prevHash: string | null;
  hash: string;
  createdAt: Date;
}

export class TimeRepository {
  /**
   * Appends an immutable, tamper-evident time event to the employee's hash chain.
   */
  async appendEvent(
    tx: TenantTx,
    data: {
      employeeId: string;
      eventType:
        "clock_in" | "clock_out" | "break_start" | "break_end" | "correction";
      occurredAt?: Date | undefined;
      source?: string | undefined;
      actorId: string;
      refEventId?: string | null | undefined;
      reason?: string | null | undefined;
      prevHash?: string | null | undefined;
      hash: string;
    },
  ): Promise<TimeEventRow> {
    const occurredAt = data.occurredAt ?? new Date();
    const recordedAt = new Date();

    const rows = await tx<TimeEventRow[]>`
      INSERT INTO time_events (
        employee_id, event_type, occurred_at, recorded_at,
        source, actor_id, ref_event_id, reason, prev_hash, hash
      ) VALUES (
        ${data.employeeId},
        ${data.eventType},
        ${occurredAt},
        ${recordedAt},
        ${data.source ?? "web"},
        ${data.actorId},
        ${data.refEventId ?? null},
        ${data.reason ?? null},
        ${data.prevHash ?? null},
        ${data.hash}
      )
      RETURNING id, organization_id as "organizationId", employee_id as "employeeId",
                event_type as "eventType", occurred_at as "occurredAt", recorded_at as "recordedAt",
                source, actor_id as "actorId", ref_event_id as "refEventId",
                reason, prev_hash as "prevHash", hash, created_at as "createdAt"
    `;

    return rows[0]!;
  }

  async getLatestEvent(
    tx: TenantTx,
    employeeId: string,
  ): Promise<TimeEventRow | null> {
    const rows = await tx<TimeEventRow[]>`
      SELECT id, organization_id as "organizationId", employee_id as "employeeId",
             event_type as "eventType", occurred_at as "occurredAt", recorded_at as "recordedAt",
             source, actor_id as "actorId", ref_event_id as "refEventId",
             reason, prev_hash as "prevHash", hash, created_at as "createdAt"
      FROM time_events
      WHERE employee_id = ${employeeId}
      ORDER BY occurred_at DESC, created_at DESC
      LIMIT 1
    `;
    return rows[0] ?? null;
  }

  async getEventsForEmployee(
    tx: TenantTx,
    employeeId: string,
    startDate?: string | undefined,
    endDate?: string | undefined,
  ): Promise<TimeEventRow[]> {
    return tx<TimeEventRow[]>`
      SELECT id, organization_id as "organizationId", employee_id as "employeeId",
             event_type as "eventType", occurred_at as "occurredAt", recorded_at as "recordedAt",
             source, actor_id as "actorId", ref_event_id as "refEventId",
             reason, prev_hash as "prevHash", hash, created_at as "createdAt"
      FROM time_events
      WHERE employee_id = ${employeeId}
        AND (${startDate ?? null}::timestamptz IS NULL OR occurred_at >= ${startDate ?? null}::timestamptz)
        AND (${endDate ?? null}::timestamptz IS NULL OR occurred_at <= ${endDate ?? null}::timestamptz)
      ORDER BY occurred_at ASC
    `;
  }

  // TIM-012: Time bank operations
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
  ): Promise<{
    id: string;
    organizationId: string;
    employeeId: string;
    type: string;
    minutes: number;
    referenceDate: string;
    notes: string | null;
    createdAt: Date;
  }> {
    const rows = await tx<
      {
        id: string;
        organizationId: string;
        employeeId: string;
        type: string;
        minutes: number;
        referenceDate: string;
        notes: string | null;
        createdAt: Date;
      }[]
    >`
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
  ): Promise<
    {
      id: string;
      organizationId: string;
      employeeId: string;
      type: string;
      minutes: number;
      referenceDate: string;
      notes: string | null;
      createdAt: Date;
    }[]
  > {
    return tx<
      {
        id: string;
        organizationId: string;
        employeeId: string;
        type: string;
        minutes: number;
        referenceDate: string;
        notes: string | null;
        createdAt: Date;
      }[]
    >`
      SELECT id, organization_id as "organizationId", employee_id as "employeeId",
             type, minutes, reference_date as "referenceDate", notes, created_at as "createdAt"
      FROM time_bank_records
      WHERE employee_id = ${employeeId}
      ORDER BY reference_date DESC, created_at DESC
    `;
  }
}
