import { z } from "zod";
import {
  chainStatus,
  verifyChainSegment,
  INITIAL_CHAIN_CURSOR,
  type ChainCursor,
  type ChainIssue,
  type ChainStatus,
  type StoredChainEvent,
} from "@librehr/core";
import {
  withTenant,
  AuditRepository,
  TimeRepository,
  type Sql,
  type TimeEventRow,
} from "@librehr/db";
import { isoDate, parsePayload } from "../lib/payload.js";

export const AuditVerifyChainPayloadSchema = z.object({
  organizationId: z.string().uuid(),
  runDate: z.string().regex(isoDate),
  /** Rows read per query; bounds memory and transaction length. */
  batchSize: z.number().int().min(1).max(5000).optional(),
});

export type AuditVerifyChainPayload = z.input<
  typeof AuditVerifyChainPayloadSchema
>;

export const auditVerifyChainSingletonKey = (
  p: z.output<typeof AuditVerifyChainPayloadSchema>,
) => `${p.organizationId}:${p.runDate}`;

const DEFAULT_BATCH_SIZE = 500;
/** Issues kept in the job output; the counts always cover every row. */
const MAX_REPORTED_ISSUES = 100;

export interface AuditVerifyChainDeps {
  sql: Sql;
  timeChainKey: string;
  logger: {
    info(obj: object): void;
    error(obj: object): void;
  };
}

export interface AuditVerifyChainReport {
  organizationId: string;
  runDate: string;
  status: ChainStatus;
  employeesChecked: number;
  tamperedEmployees: number;
  events: { verified: number; tampered: number; legacy: number };
  /** Ids and issue kinds only, capped at {@link MAX_REPORTED_ISSUES}. */
  issues: Array<ChainIssue & { employeeId: string }>;
}

function toStored(row: TimeEventRow): StoredChainEvent {
  return {
    id: row.id,
    organizationId: row.organizationId,
    employeeId: row.employeeId,
    seq: row.seq,
    eventType: row.eventType,
    occurredAt: row.occurredAt.toISOString(),
    recordedAt: row.recordedAt.toISOString(),
    source: row.source,
    actorId: row.actorId,
    refEventId: row.refEventId,
    reason: row.reason,
    prevHash: row.prevHash,
    hash: row.hash,
    hashVersion: row.hashVersion,
  };
}

/**
 * Verifies every employee's time-event chain of one organization (TIM-002).
 *
 * Chained rows are read in `seq` order in batches and checked with the keyed
 * v2 HMAC, the seq sequence and the prev-hash links. Rows without a chain
 * position are legacy v1 rows: counted, never verified, never tampered (a
 * downgraded v2 row still carries its seq, so it is read and flagged as
 * tampered). Any tampered row makes the run "tampered".
 *
 * Read-only apart from one audit_log entry with the counts, so re-running is
 * safe. Logs and output contain ids and counts only, never personal data.
 */
export async function handleAuditVerifyChain(
  job: { id: string; data: unknown },
  deps: AuditVerifyChainDeps,
): Promise<AuditVerifyChainReport> {
  const data = parsePayload(
    "audit.verify-chain",
    AuditVerifyChainPayloadSchema,
    job.data,
  );
  const batchSize = data.batchSize ?? DEFAULT_BATCH_SIZE;
  const tenant = { organizationId: data.organizationId };
  const timeRepo = new TimeRepository();

  const employeeIds = await withTenant(deps.sql, tenant, (tx) =>
    timeRepo.listEmployeesWithEvents(tx),
  );

  const totals = { verified: 0, tampered: 0, legacy: 0 };
  const issues: AuditVerifyChainReport["issues"] = [];
  let tamperedEmployees = 0;

  for (const employeeId of employeeIds) {
    let employeeTampered = 0;

    let cursor: ChainCursor = INITIAL_CHAIN_CURSOR;
    let afterSeq = 0;
    for (;;) {
      const page = await withTenant(deps.sql, tenant, (tx) =>
        timeRepo.listChainPage(tx, employeeId, afterSeq, batchSize),
      );
      if (page.length === 0) break;
      const result = verifyChainSegment(
        deps.timeChainKey,
        employeeId,
        page.map(toStored),
        cursor,
      );
      cursor = result.cursor;
      totals.verified += result.verified;
      totals.tampered += result.tampered;
      totals.legacy += result.legacy;
      employeeTampered += result.tampered;
      for (const issue of result.issues) {
        if (issues.length < MAX_REPORTED_ISSUES) {
          issues.push({ ...issue, employeeId });
        }
      }
      afterSeq = page[page.length - 1]!.seq ?? afterSeq;
      if (page.length < batchSize) break;
    }

    let afterId: string | null = null;
    for (;;) {
      const page: TimeEventRow[] = await withTenant(deps.sql, tenant, (tx) =>
        timeRepo.listUnchainedPage(tx, employeeId, afterId, batchSize),
      );
      if (page.length === 0) break;
      // Rows without seq are legacy by definition; verifyChainSegment counts
      // them and flags anything else (e.g. a v2 row whose seq was removed).
      const result = verifyChainSegment(
        deps.timeChainKey,
        employeeId,
        page.map(toStored),
        // Never advances the real chain cursor: these rows are outside it.
        { expectedSeq: -1, expectedPrevHash: null },
      );
      totals.legacy += result.legacy;
      totals.tampered += result.tampered;
      employeeTampered += result.tampered;
      for (const issue of result.issues) {
        if (issues.length < MAX_REPORTED_ISSUES) {
          issues.push({ ...issue, employeeId });
        }
      }
      afterId = page[page.length - 1]!.id;
      if (page.length < batchSize) break;
    }

    if (employeeTampered > 0) tamperedEmployees++;
  }

  const status = chainStatus(totals);
  const report: AuditVerifyChainReport = {
    organizationId: data.organizationId,
    runDate: data.runDate,
    status,
    employeesChecked: employeeIds.length,
    tamperedEmployees,
    events: totals,
    issues,
  };

  await withTenant(deps.sql, tenant, (tx) =>
    new AuditRepository().log(tx, {
      action: "time.chain_verified",
      resourceType: "time_event_chain",
      metadata: {
        runDate: data.runDate,
        status,
        employeesChecked: report.employeesChecked,
        tamperedEmployees,
        ...totals,
      },
    }),
  );

  const logEntry = {
    msg: "time chain verification finished",
    requirement: "TIM-002",
    jobId: job.id,
    organizationId: data.organizationId,
    runDate: data.runDate,
    status,
    employeesChecked: report.employeesChecked,
    tamperedEmployees,
    ...totals,
  };
  if (status === "tampered") deps.logger.error(logEntry);
  else deps.logger.info(logEntry);

  return report;
}
