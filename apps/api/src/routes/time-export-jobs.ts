import { Hono } from "hono";
import type { Sql } from "postgres";
import {
  type AuthUser,
  type TimeExportJob,
  OFFICIAL_EXPORT_ASYNC_MAX_EMPLOYEE_DAYS,
  TimeExportJobRequestSchema,
} from "@librehr/contracts";
import {
  withTenant,
  AuditRepository,
  TimeExportRepository,
  type TenantTx,
  type TimeExportJobRow,
} from "@librehr/db";
import {
  mayExportOrganization,
  organizationExportSubjects,
} from "@librehr/time-export";
import { requireAuth } from "../middleware/auth.js";
import { createRateLimiter } from "../middleware/rate-limit.js";
import type { RateLimitStore } from "../lib/rate-limit-store.js";
import type { ExportFileReader } from "../lib/export-files.js";
import { can } from "../policies/can.js";
import { resolvePolicyContext } from "../policies/context.js";
import {
  AppError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "../errors/index.js";
import { IdParamSchema, parseJsonBody, parseParams } from "../lib/validate.js";
import { logger } from "../middleware/logger.js";

/** Queued or running exports one organization may have at once. */
export const MAX_ACTIVE_EXPORTS_PER_ORGANIZATION = 3;
/** How many of the caller's exports the list returns. */
const LIST_LIMIT = 20;
/** Default rate limit of these routes: per user and client address. */
const DEFAULT_RATE_LIMIT = { windowMs: 60_000, max: 30 };

export interface TimeExportJobRouteOptions {
  rateLimitStore: RateLimitStore;
  files: ExportFileReader;
  trustProxy?: number | undefined;
  /** Overrides OFFICIAL_EXPORT_ASYNC_MAX_EMPLOYEE_DAYS (tests). */
  asyncMaxEmployeeDays?: number | undefined;
  /** Overrides the default of 30 requests per minute (tests). */
  rateLimit?: { windowMs: number; max: number } | undefined;
}

const currentUser = (c: { get: unknown }) =>
  (c.get as (key: string) => unknown)("user") as AuthUser;

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/** The requester's view of a row: no storage key, no requester id. */
function toJob(row: TimeExportJobRow): TimeExportJob {
  return {
    exportId: row.id,
    status: row.status,
    scope: row.scope,
    format: row.format,
    locale: row.locale,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    employeeDays: row.employeeDays,
    contentHash: row.contentHash,
    employeeCount: row.employeeCount,
    byteSize: row.byteSize,
    errorCode: row.errorCode,
    createdAt: row.createdAt.toISOString(),
    completedAt: iso(row.completedAt),
    expiresAt: iso(row.expiresAt),
  };
}

const notFound = () =>
  new NotFoundError({ detail: "Export not found", code: "EXPORT_NOT_FOUND" });

/**
 * TIM-006 (issue #38): background organization exports above the
 * synchronous cap. The API only queues a row; the worker builds the file
 * (see apps/worker/src/queues/time.export.ts) and the requester downloads it
 * here until it expires.
 *
 * Only the requester sees an export, and only while they still hold
 * organization-wide `time.record.read` with an active membership (an
 * auditor whose TIM-008 window closed loses access). Anyone else, in this
 * tenant or another, gets 404, so export ids cannot be probed. Every
 * download is audited (`time.export.download`, ids only).
 */
export function createTimeExportJobRoutes(
  sql: Sql,
  options: TimeExportJobRouteOptions,
) {
  const router = new Hono();
  const asyncMaxEmployeeDays =
    options.asyncMaxEmployeeDays ?? OFFICIAL_EXPORT_ASYNC_MAX_EMPLOYEE_DAYS;
  const limit = createRateLimiter({
    name: "time.export-jobs.user",
    store: options.rateLimitStore,
    ...(options.rateLimit ?? DEFAULT_RATE_LIMIT),
    trustProxy: options.trustProxy,
    account: (c) => currentUser(c).id,
  });
  const repo = new TimeExportRepository();
  const auditRepo = new AuditRepository();

  /** Organization-wide time access, re-checked against the membership. */
  const mayExport = async (
    c: Parameters<typeof resolvePolicyContext>[0],
    tx: TenantTx,
  ): Promise<boolean> => {
    const ctx = await resolvePolicyContext(c, tx);
    if (!can(ctx, "time.record.read")) return false;
    const requester = await repo.findActiveRequester(tx, ctx.userId);
    return requester !== null && mayExportOrganization(requester.role);
  };

  router.post("/time/exports", requireAuth, limit, async (c) => {
    const user = currentUser(c);
    const body = await parseJsonBody(c, TimeExportJobRequestSchema);
    const job = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        if (!(await mayExport(c, tx))) {
          throw new ForbiddenError({
            detail:
              "Exporting the whole organization requires organization-wide access to time records",
          });
        }
        const { employeeDays } = await organizationExportSubjects(tx, {
          startDate: body.startDate,
          endDate: body.endDate,
        });
        if (employeeDays === 0) {
          throw new AppError({
            status: 422,
            title: "Export Empty",
            code: "EXPORT_EMPTY",
            detail: "No employee is employed during the requested period.",
          });
        }
        if (employeeDays > asyncMaxEmployeeDays) {
          throw new AppError({
            status: 422,
            title: "Export Too Large",
            code: "EXPORT_TOO_LARGE",
            detail: `A background organization export can cover at most ${asyncMaxEmployeeDays} employee-days (employees × days of the period). Request a shorter period.`,
          });
        }
        // Serialize the count and the insert per organization; the
        // per-requester limit is a unique index.
        await repo.lockOrganization(tx);
        const inProgress = () =>
          new ConflictError({
            code: "EXPORT_IN_PROGRESS",
            detail:
              "Wait for the background exports in progress to finish before requesting another.",
          });
        if (
          (await repo.countActive(tx)) >= MAX_ACTIVE_EXPORTS_PER_ORGANIZATION
        ) {
          throw inProgress();
        }
        const row = await repo.create(tx, {
          requestedBy: user.id,
          format: body.format,
          locale: body.locale,
          periodStart: body.startDate,
          periodEnd: body.endDate,
          employeeDays,
        });
        if (!row) throw inProgress();
        return toJob(row);
      },
    );
    return c.json(job, 202, {
      Location: `/v1/time/exports/${job.exportId}`,
    });
  });

  router.get("/time/exports", requireAuth, limit, async (c) => {
    const user = currentUser(c);
    const items = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        if (!(await mayExport(c, tx))) {
          throw new ForbiddenError({
            detail:
              "Background exports require organization-wide access to time records",
          });
        }
        const rows = await repo.listForRequester(tx, user.id, LIST_LIMIT);
        return rows.map(toJob);
      },
    );
    return c.json({ items }, 200, { "Cache-Control": "no-store" });
  });

  /** The caller's own export while they may still export; 404 otherwise. */
  const findOwn = async (
    c: Parameters<typeof resolvePolicyContext>[0],
    tx: TenantTx,
    id: string,
  ): Promise<TimeExportJobRow> => {
    if (!(await mayExport(c, tx))) throw notFound();
    const row = await repo.findForRequester(tx, id, currentUser(c).id);
    if (!row) throw notFound();
    return row;
  };

  router.get("/time/exports/:id", requireAuth, limit, async (c) => {
    const user = currentUser(c);
    const { id } = parseParams(c, IdParamSchema, { code: "EXPORT_NOT_FOUND" });
    const job = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => toJob(await findOwn(c, tx, id)),
    );
    return c.json(job, 200, { "Cache-Control": "no-store" });
  });

  router.get("/time/exports/:id/download", requireAuth, limit, async (c) => {
    const user = currentUser(c);
    const { id } = parseParams(c, IdParamSchema, { code: "EXPORT_NOT_FOUND" });
    const file = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        const row = await findOwn(c, tx, id);
        const expired = () =>
          new AppError({
            status: 410,
            title: "Gone",
            code: "EXPORT_EXPIRED",
            detail:
              "The export file has expired and was deleted. Request a new export.",
          });
        if (
          row.status === "expired" ||
          (row.status === "ready" &&
            row.expiresAt !== null &&
            row.expiresAt.getTime() <= Date.now())
        ) {
          throw expired();
        }
        if (
          row.status !== "ready" ||
          row.storageKey === null ||
          row.contentHash === null
        ) {
          throw new ConflictError({
            code: "EXPORT_NOT_READY",
            detail: "The export is not ready to download.",
          });
        }
        const bytes = await options.files.get(row.storageKey);
        if (!bytes) {
          // Ready but no file: deleted by hand, or another volume.
          logger.error({
            msg: "time export file missing",
            requirement: "TIM-006",
            exportId: row.id,
          });
          throw expired();
        }
        // TIM-008 access logging: every download, ids only.
        await auditRepo.log(tx, {
          actorId: user.id,
          action: "time.export.download",
          resourceType: "time_export",
          resourceId: row.id,
          metadata: { format: row.format, contentHash: row.contentHash },
        });
        return { row, bytes, contentHash: row.contentHash };
      },
    );

    const { row, bytes } = file;
    const headers = {
      "Cache-Control": "no-store",
      "X-Export-Id": row.id,
      "X-Content-SHA256": file.contentHash,
      "Content-Disposition": `attachment; filename="registro-jornada-${row.periodStart}-${row.periodEnd}.${row.format}"`,
    };
    if (row.format === "csv") {
      // The BOM makes spreadsheet software read UTF-8; it is not hashed,
      // so the worker stores the CSV without it (as GET /v1/time/export).
      const body = new Uint8Array(bytes.byteLength + 3);
      body.set([0xef, 0xbb, 0xbf], 0);
      body.set(bytes, 3);
      return c.body(body, 200, {
        ...headers,
        "Content-Type": "text/csv; charset=utf-8",
      });
    }
    return c.body(bytes, 200, {
      ...headers,
      "Content-Type": "application/pdf",
    });
  });

  return router;
}
