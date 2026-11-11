import { z } from "zod";
import {
  chainStatus,
  checkChainHead,
  verifyChainSegment,
  INITIAL_CHAIN_CURSOR,
  type ChainCursor,
  type ChainHead,
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
  organizationId: z.guid(),
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
const CHAIN_VERIFIED_ACTION = "time.chain_verified";

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
  /** Chain-level findings (truncated, missing or rewound heads). */
  headIssues: number;
  /** Ids and issue kinds only, capped at {@link MAX_REPORTED_ISSUES}. */
  issues: Array<ChainIssue & { employeeId: string }>;
}

/** Newest link of one employee's chain as recorded in the audit log. */
const RecordedHeadSchema = z.object({
  employeeId: z.guid(),
  seq: z.number().int().min(1),
  hash: z.string().min(1),
});
type RecordedHead = z.infer<typeof RecordedHeadSchema>;

/**
 * Heads recorded by the previous run. Entries written before heads were
 * recorded, or malformed ones, yield an empty map (nothing to compare).
 */
function parseRecordedHeads(metadata: unknown): Map<string, ChainHead> {
  const parsed = z
    .object({ heads: z.array(RecordedHeadSchema) })
    .safeParse(metadata);
  const heads = new Map<string, ChainHead>();
  if (!parsed.success) return heads;
  for (const h of parsed.data.heads) {
    heads.set(h.employeeId, { seq: h.seq, hash: h.hash });
  }
  return heads;
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
 * tampered).
 *
 * Per-row checks cannot see rows deleted from the end of a chain, so the
 * newest links are also compared with the chain-head anchor that the write
 * path maintains, and with the heads this job recorded on its previous run
 * (`checkChainHead`). Any tampered row or head finding makes the run
 * "tampered".
 *
 * Read-only apart from one audit_log entry with the counts and the heads
 * (ids, seq and hash only), so re-running is safe. Logs and output contain
 * ids and counts only, never personal data.
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
  const auditRepo = new AuditRepository();

  const previousHeads = await withTenant(deps.sql, tenant, async (tx) =>
    parseRecordedHeads(
      (await auditRepo.latestByAction(tx, CHAIN_VERIFIED_ACTION))?.metadata,
    ),
  );
  const employeeIds = await withTenant(deps.sql, tenant, (tx) =>
    timeRepo.listEmployeesWithEvents(tx),
  );
  // An employee whose rows and anchor are all gone is only known from the
  // previous run's record.
  for (const employeeId of previousHeads.keys()) {
    if (!employeeIds.includes(employeeId)) employeeIds.push(employeeId);
  }

  const totals = { verified: 0, tampered: 0, legacy: 0 };
  const issues: AuditVerifyChainReport["issues"] = [];
  const heads: RecordedHead[] = [];
  let tamperedEmployees = 0;
  let headIssues = 0;
  const addIssue = (issue: ChainIssue, employeeId: string) => {
    if (issues.length < MAX_REPORTED_ISSUES) {
      issues.push({ ...issue, employeeId });
    }
  };

  for (const employeeId of employeeIds) {
    let employeeTampered = 0;

    // Read before the rows: rows appended during the run are newer than the
    // anchor and cannot make it look truncated.
    let anchor = await withTenant(deps.sql, tenant, (tx) =>
      timeRepo.getChainHead(tx, employeeId),
    );
    const previous = previousHeads.get(employeeId) ?? null;
    let newest: (ChainHead & { eventId: string }) | null = null;
    let hashAtAnchorSeq: string | null = null;
    let hashAtPreviousSeq: string | null = null;

    let cursor: ChainCursor = INITIAL_CHAIN_CURSOR;
    let afterSeq = 0;
    for (;;) {
      const page = await withTenant(deps.sql, tenant, (tx) =>
        timeRepo.listChainPage(tx, employeeId, afterSeq, batchSize),
      );
      if (page.length === 0) break;
      for (const row of page) {
        if (row.seq === null) continue;
        if (anchor && row.seq === anchor.seq) hashAtAnchorSeq = row.hash;
        if (previous && row.seq === previous.seq) hashAtPreviousSeq = row.hash;
        newest = { seq: row.seq, hash: row.hash, eventId: row.id };
      }
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
      for (const issue of result.issues) addIssue(issue, employeeId);
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
      for (const issue of result.issues) addIssue(issue, employeeId);
      afterId = page[page.length - 1]!.id;
      if (page.length < batchSize) break;
    }

    // The first event of a new chain may have been written after the anchor
    // was read; only a still-missing anchor is a finding.
    if (anchor === null && newest !== null) {
      anchor = await withTenant(deps.sql, tenant, (tx) =>
        timeRepo.getChainHead(tx, employeeId),
      );
      if (anchor !== null) hashAtAnchorSeq = anchor.hash;
    }

    const headKinds = checkChainHead({
      newest,
      anchor,
      hashAtAnchorSeq,
      previous,
      hashAtPreviousSeq,
    });
    for (const kind of headKinds) {
      addIssue(
        { eventId: newest?.eventId ?? null, seq: newest?.seq ?? null, kind },
        employeeId,
      );
    }
    headIssues += headKinds.length;
    if (headKinds.length > 0) employeeTampered++;

    if (newest !== null) {
      heads.push({ employeeId, seq: newest.seq, hash: newest.hash });
    }
    if (employeeTampered > 0) tamperedEmployees++;
  }

  const status: ChainStatus = headIssues > 0 ? "tampered" : chainStatus(totals);
  const result: AuditVerifyChainReport = {
    organizationId: data.organizationId,
    runDate: data.runDate,
    status,
    employeesChecked: employeeIds.length,
    tamperedEmployees,
    events: totals,
    headIssues,
    issues,
  };

  await withTenant(deps.sql, tenant, (tx) =>
    auditRepo.log(tx, {
      action: CHAIN_VERIFIED_ACTION,
      resourceType: "time_event_chain",
      metadata: {
        runDate: data.runDate,
        status,
        employeesChecked: result.employeesChecked,
        tamperedEmployees,
        headIssues,
        ...totals,
        // The next run compares against these, so a later rewind of both the
        // rows and the anchor is still detected.
        heads,
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
    employeesChecked: result.employeesChecked,
    tamperedEmployees,
    headIssues,
    ...totals,
  };
  if (status === "tampered") deps.logger.error(logEntry);
  else deps.logger.info(logEntry);

  return result;
}
