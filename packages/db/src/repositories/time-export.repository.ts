import type { Sql } from "postgres";
import type { TenantTx } from "../with-tenant.js";

export type TimeExportJobStatus =
  "queued" | "running" | "ready" | "failed" | "expired";
export type TimeExportJobFormat = "csv" | "pdf";
export type TimeExportJobLocale = "ca" | "es" | "en";

/** One background export (migration 0045). Ids, period and outcome only. */
export interface TimeExportJobRow {
  id: string;
  organizationId: string;
  requestedBy: string;
  scope: "organization";
  format: TimeExportJobFormat;
  locale: TimeExportJobLocale;
  periodStart: string;
  periodEnd: string;
  employeeDays: number;
  status: TimeExportJobStatus;
  attempts: number;
  contentHash: string | null;
  employeeCount: number | null;
  byteSize: number | null;
  storageKey: string | null;
  errorCode: string | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  expiresAt: Date | null;
}

/** A queued export as the dispatch sweep sees it: ids only. */
export interface QueuedTimeExport {
  exportId: string;
  organizationId: string;
}

const columns = (tx: TenantTx) => tx`
  id, organization_id as "organizationId", requested_by as "requestedBy",
  scope, format, locale,
  period_start::text as "periodStart", period_end::text as "periodEnd",
  employee_days as "employeeDays", status, attempts,
  content_hash as "contentHash", employee_count as "employeeCount",
  byte_size::float8 as "byteSize", storage_key as "storageKey",
  error_code as "errorCode", created_at as "createdAt",
  started_at as "startedAt", completed_at as "completedAt",
  expires_at as "expiresAt"
`;

/**
 * TIM-006 (issue #38): background organization exports. The API requests
 * and reads (`create`, `findForRequester`, `listForRequester`,
 * `countActive`); the worker dispatches, runs and cleans up (`listQueued`,
 * `findById`, `claim`, `markReady`, `markFailed`, `listExpired`,
 * `markExpired`, `failStale`). The runtime role cannot update rows, so the
 * worker-side methods only work for the owner role.
 */
export class TimeExportRepository {
  /**
   * Serializes export requests of one organization until the transaction
   * ends, so a count of active exports followed by `create` stays true.
   */
  async lockOrganization(tx: TenantTx): Promise<void> {
    await tx`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`time_export:${tx.__tenantContext.organizationId}`}, 0)
      )`;
  }

  /** Queued or running exports of the organization. */
  async countActive(tx: TenantTx): Promise<number> {
    const rows = await tx<{ n: number }[]>`
      SELECT count(*)::int AS n FROM time_exports
      WHERE status IN ('queued', 'running')`;
    return rows[0]?.n ?? 0;
  }

  /**
   * Queues an export. Returns null when the requester already has one queued
   * or running (enforced by a partial unique index, so it holds under
   * concurrent requests).
   */
  async create(
    tx: TenantTx,
    data: {
      id?: string;
      requestedBy: string;
      format: TimeExportJobFormat;
      locale: TimeExportJobLocale;
      periodStart: string;
      periodEnd: string;
      employeeDays: number;
    },
  ): Promise<TimeExportJobRow | null> {
    const rows = await tx<TimeExportJobRow[]>`
      INSERT INTO time_exports (
        id, requested_by, format, locale, period_start, period_end,
        employee_days
      ) VALUES (
        coalesce(${data.id ?? null}::uuid, gen_random_uuid()),
        ${data.requestedBy},
        ${data.format},
        ${data.locale},
        ${data.periodStart}::date,
        ${data.periodEnd}::date,
        ${data.employeeDays}
      )
      ON CONFLICT (organization_id, requested_by)
        WHERE status IN ('queued', 'running')
        DO NOTHING
      RETURNING ${columns(tx)}`;
    return rows[0] ?? null;
  }

  /** One export, only if `userId` requested it; null otherwise. */
  async findForRequester(
    tx: TenantTx,
    id: string,
    userId: string,
  ): Promise<TimeExportJobRow | null> {
    const rows = await tx<TimeExportJobRow[]>`
      SELECT ${columns(tx)} FROM time_exports
      WHERE id = ${id} AND requested_by = ${userId}`;
    return rows[0] ?? null;
  }

  /** The requester's exports, newest first. */
  async listForRequester(
    tx: TenantTx,
    userId: string,
    limit: number,
  ): Promise<TimeExportJobRow[]> {
    return tx<TimeExportJobRow[]>`
      SELECT ${columns(tx)} FROM time_exports
      WHERE requested_by = ${userId}
      ORDER BY created_at DESC, id DESC
      LIMIT ${limit}`;
  }

  /**
   * The dispatch sweep's only read without a tenant context: queued export
   * ids across organizations, oldest first, through the owner-only SECURITY
   * DEFINER function of migration 0045.
   */
  async listQueued(sql: Sql, limit: number): Promise<QueuedTimeExport[]> {
    return sql<QueuedTimeExport[]>`
      SELECT export_id AS "exportId", organization_id AS "organizationId"
      FROM public.librehr_queued_time_exports(${limit})`;
  }

  async findById(tx: TenantTx, id: string): Promise<TimeExportJobRow | null> {
    const rows = await tx<TimeExportJobRow[]>`
      SELECT ${columns(tx)} FROM time_exports WHERE id = ${id}`;
    return rows[0] ?? null;
  }

  /**
   * Marks a queued (or re-driven running) export as running and counts the
   * attempt. Returns null when it is already ready, failed or expired, so a
   * redelivered job does nothing (at-least-once delivery).
   */
  async claim(tx: TenantTx, id: string): Promise<TimeExportJobRow | null> {
    const rows = await tx<TimeExportJobRow[]>`
      UPDATE time_exports
      SET status = 'running', attempts = attempts + 1, started_at = now()
      WHERE id = ${id} AND status IN ('queued', 'running')
      RETURNING ${columns(tx)}`;
    return rows[0] ?? null;
  }

  /** Records the stored file. Only a running export can become ready. */
  async markReady(
    tx: TenantTx,
    id: string,
    data: {
      contentHash: string;
      employeeCount: number;
      byteSize: number;
      storageKey: string;
      expiresAt: Date;
    },
  ): Promise<TimeExportJobRow | null> {
    const rows = await tx<TimeExportJobRow[]>`
      UPDATE time_exports
      SET status = 'ready',
          content_hash = ${data.contentHash},
          employee_count = ${data.employeeCount},
          byte_size = ${data.byteSize},
          storage_key = ${data.storageKey},
          error_code = NULL,
          completed_at = now(),
          expires_at = ${data.expiresAt}
      WHERE id = ${id} AND status = 'running'
      RETURNING ${columns(tx)}`;
    return rows[0] ?? null;
  }

  /** Gives up on a queued or running export with a coarse error code. */
  async markFailed(
    tx: TenantTx,
    id: string,
    errorCode: string,
  ): Promise<TimeExportJobRow | null> {
    const rows = await tx<TimeExportJobRow[]>`
      UPDATE time_exports
      SET status = 'failed', error_code = ${errorCode}, completed_at = now()
      WHERE id = ${id} AND status IN ('queued', 'running')
      RETURNING ${columns(tx)}`;
    return rows[0] ?? null;
  }

  /** Ready exports whose file expired at or before `now`. */
  async listExpired(
    tx: TenantTx,
    now: Date,
    limit: number,
  ): Promise<{ id: string; storageKey: string }[]> {
    return tx<{ id: string; storageKey: string }[]>`
      SELECT id, storage_key AS "storageKey" FROM time_exports
      WHERE status = 'ready' AND expires_at <= ${now}
      ORDER BY expires_at, id
      LIMIT ${limit}`;
  }

  /**
   * Marks a ready export's file as deleted. The row (id, period, hash,
   * requester) stays as the trace of what was issued.
   */
  async markExpired(tx: TenantTx, id: string): Promise<boolean> {
    const rows = await tx`
      UPDATE time_exports SET status = 'expired', storage_key = NULL
      WHERE id = ${id} AND status = 'ready'
      RETURNING id`;
    return rows.length > 0;
  }

  /**
   * Fails exports stuck in running since before `startedBefore` (a crashed
   * worker). Returns their ids.
   */
  async failStale(
    tx: TenantTx,
    startedBefore: Date,
    errorCode: string,
  ): Promise<string[]> {
    const rows = await tx<{ id: string }[]>`
      UPDATE time_exports
      SET status = 'failed', error_code = ${errorCode}, completed_at = now()
      WHERE status = 'running' AND started_at < ${startedBefore}
      RETURNING id`;
    return rows.map((row) => row.id);
  }
}
