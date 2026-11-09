import { randomUUID } from "node:crypto";
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
  /** 1 = legacy unkeyed hash (unverifiable), 2 = keyed chain. */
  hashVersion: number;
  /** Position in the employee's v2 chain; null for legacy rows. */
  seq: number | null;
  createdAt: Date;
}

export type TimeEventKind =
  "clock_in" | "clock_out" | "break_start" | "break_end" | "correction";

/** Origin of a time event. Always chosen by the server route, never by the client. */
export type TimeEventOrigin = "web" | "mobile" | "kiosk" | "manual" | "import";

/**
 * Exactly the values stored for a v2 event, as the chain signer must hash
 * them. Timestamps are ISO 8601 UTC strings with milliseconds.
 */
export interface TimeChainLink {
  id: string;
  organizationId: string;
  employeeId: string;
  seq: number;
  eventType: TimeEventKind;
  occurredAt: string;
  recordedAt: string;
  source: TimeEventOrigin;
  actorId: string;
  refEventId: string | null;
  reason: string | null;
  prevHash: string | null;
}

/** Computes the v2 chain hash of a link (the HMAC key lives outside this package). */
export type TimeChainSigner = (link: TimeChainLink) => string;

export const TIME_CHAIN_HASH_VERSION = 2;

function eventColumns(tx: TenantTx) {
  return tx`
    id, organization_id as "organizationId", employee_id as "employeeId",
    event_type as "eventType", occurred_at as "occurredAt", recorded_at as "recordedAt",
    source, actor_id as "actorId", ref_event_id as "refEventId",
    reason, prev_hash as "prevHash", hash, hash_version as "hashVersion",
    seq::float8 as "seq", created_at as "createdAt"
  `;
}

export class TimeRepository {
  /**
   * Appends an immutable, tamper-evident time event to the employee's v2 hash
   * chain (TIM-002). This is the only write path for `time_events`.
   *
   * A transaction-scoped advisory lock on (organization, employee) serializes
   * the writers of one chain, so reading the previous link and inserting the
   * next one cannot interleave and fork it (the unique index on seq is the
   * backstop). The chain is ordered by `seq`, not `occurred_at`, so events
   * dated in the past still link in the order they were recorded.
   * `recordedAt` is taken once and used for both the stored column and the hash.
   */
  async appendEvent(
    tx: TenantTx,
    sign: TimeChainSigner,
    data: {
      organizationId: string;
      employeeId: string;
      eventType: TimeEventKind;
      occurredAt?: Date | undefined;
      source: TimeEventOrigin;
      actorId: string;
      refEventId?: string | null | undefined;
      reason?: string | null | undefined;
    },
  ): Promise<TimeEventRow> {
    const lockKey = `time_chain:${data.organizationId}:${data.employeeId}`;
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;

    const previous = await tx<{ seq: number; hash: string }[]>`
      SELECT seq::float8 as "seq", hash
      FROM time_events
      WHERE organization_id = ${data.organizationId}
        AND employee_id = ${data.employeeId}
        AND seq IS NOT NULL
      ORDER BY seq DESC
      LIMIT 1
    `;
    const prev = previous[0];

    const recordedAt = new Date();
    const occurredAt = data.occurredAt ?? recordedAt;
    const link: TimeChainLink = {
      id: randomUUID(),
      organizationId: data.organizationId,
      employeeId: data.employeeId,
      seq: prev ? prev.seq + 1 : 1,
      eventType: data.eventType,
      occurredAt: occurredAt.toISOString(),
      recordedAt: recordedAt.toISOString(),
      source: data.source,
      actorId: data.actorId,
      refEventId: data.refEventId ?? null,
      reason: data.reason ?? null,
      prevHash: prev?.hash ?? null,
    };
    const hash = sign(link);

    const rows = await tx<TimeEventRow[]>`
      INSERT INTO time_events (
        id, organization_id, employee_id, event_type, occurred_at, recorded_at,
        source, actor_id, ref_event_id, reason, prev_hash, hash, hash_version, seq
      ) VALUES (
        ${link.id},
        ${link.organizationId},
        ${link.employeeId},
        ${link.eventType},
        ${link.occurredAt}::timestamptz,
        ${link.recordedAt}::timestamptz,
        ${link.source},
        ${link.actorId},
        ${link.refEventId},
        ${link.reason},
        ${link.prevHash},
        ${hash},
        ${TIME_CHAIN_HASH_VERSION},
        ${link.seq}
      )
      RETURNING ${eventColumns(tx)}
    `;

    return rows[0]!;
  }

  /** One page of an employee's chained rows, in chain order, after `afterSeq`. */
  async listChainPage(
    tx: TenantTx,
    employeeId: string,
    afterSeq: number,
    limit: number,
  ): Promise<TimeEventRow[]> {
    return tx<TimeEventRow[]>`
      SELECT ${eventColumns(tx)}
      FROM time_events
      WHERE employee_id = ${employeeId}
        AND seq IS NOT NULL
        AND seq > ${afterSeq}
      ORDER BY seq ASC
      LIMIT ${limit}
    `;
  }

  /** One page of rows without a chain position (legacy v1 rows), by id. */
  async listUnchainedPage(
    tx: TenantTx,
    employeeId: string,
    afterId: string | null,
    limit: number,
  ): Promise<TimeEventRow[]> {
    return tx<TimeEventRow[]>`
      SELECT ${eventColumns(tx)}
      FROM time_events
      WHERE employee_id = ${employeeId}
        AND seq IS NULL
        AND (${afterId}::uuid IS NULL OR id > ${afterId}::uuid)
      ORDER BY id ASC
      LIMIT ${limit}
    `;
  }

  /** Employees of the current tenant that have at least one time event. */
  async listEmployeesWithEvents(tx: TenantTx): Promise<string[]> {
    const rows = await tx<{ employeeId: string }[]>`
      SELECT DISTINCT employee_id as "employeeId"
      FROM time_events
      ORDER BY employee_id
    `;
    return rows.map((r) => r.employeeId);
  }

  async getLatestEvent(
    tx: TenantTx,
    employeeId: string,
  ): Promise<TimeEventRow | null> {
    const rows = await tx<TimeEventRow[]>`
      SELECT ${eventColumns(tx)}
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
      SELECT ${eventColumns(tx)}
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
