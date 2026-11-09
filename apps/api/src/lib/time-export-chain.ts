import {
  chainStatus,
  checkChainHead,
  verifyChainSegment,
  INITIAL_CHAIN_CURSOR,
  type ChainCursor,
  type ChainHead,
  type ChainStatus,
  type ChainVerificationCounts,
  type StoredChainEvent,
} from "@librehr/core";
import { TimeRepository, type TenantTx, type TimeEventRow } from "@librehr/db";

const timeRepo = new TimeRepository();

/** Rows read per query while verifying a chain; bounds memory per employee. */
export const CHAIN_PAGE_SIZE = 1000;

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
 * Running state of one employee's chain check, fed page by page so a long
 * history is verified in one pass without being held in memory.
 */
export interface ChainScan {
  readonly key: string;
  readonly employeeId: string;
  anchor: ChainHead | null;
  cursor: ChainCursor;
  counts: ChainVerificationCounts;
  newest: ChainHead | null;
  hashAtAnchorSeq: string | null;
}

export function startChainScan(
  key: string,
  employeeId: string,
  anchor: ChainHead | null,
): ChainScan {
  return {
    key,
    employeeId,
    anchor,
    cursor: INITIAL_CHAIN_CURSOR,
    counts: { verified: 0, tampered: 0, legacy: 0 },
    newest: null,
    hashAtAnchorSeq: null,
  };
}

function addCounts(scan: ChainScan, result: ChainVerificationCounts) {
  scan.counts.verified += result.verified;
  scan.counts.tampered += result.tampered;
  scan.counts.legacy += result.legacy;
}

/** Feeds the next rows that have a chain position, in ascending `seq`. */
export function scanChainedPage(
  scan: ChainScan,
  rows: readonly TimeEventRow[],
): void {
  for (const row of rows) {
    if (row.seq === null) continue;
    if (scan.anchor && row.seq === scan.anchor.seq) {
      scan.hashAtAnchorSeq = row.hash;
    }
    scan.newest = { seq: row.seq, hash: row.hash };
  }
  const result = verifyChainSegment(
    scan.key,
    scan.employeeId,
    rows.map(toStored),
    scan.cursor,
  );
  scan.cursor = result.cursor;
  addCounts(scan, result);
}

/**
 * Feeds rows without a chain position: legacy v1 rows are counted, anything
 * else (a v2 row whose seq was removed) is tampered.
 */
export function scanUnchainedPage(
  scan: ChainScan,
  rows: readonly TimeEventRow[],
): void {
  const result = verifyChainSegment(
    scan.key,
    scan.employeeId,
    rows.map(toStored),
    // Never part of the real chain: only counted (legacy) or flagged.
    { expectedSeq: -1, expectedPrevHash: null },
  );
  addCounts(scan, result);
}

/** Status once every row was fed: row findings plus the anchor check. */
export function finishChainScan(scan: ChainScan): ChainStatus {
  const headIssues = checkChainHead({
    newest: scan.newest,
    anchor: scan.anchor,
    hashAtAnchorSeq: scan.hashAtAnchorSeq,
    // No record of an earlier verification here: see employeeChainStatus.
    previous: null,
    hashAtPreviousSeq: null,
  });
  return chainStatus({
    ...scan.counts,
    tampered: scan.counts.tampered + headIssues.length,
  });
}

/**
 * TIM-002 status of one employee's whole chain, for the TIM-006 export.
 *
 * Detects: a row whose keyed HMAC does not match its stored fields (edited
 * row), a gap in `seq` or a broken prev-hash link (deleted or inserted row),
 * a row without a chain position that is not a legacy v1 row, a missing
 * chain-head anchor while chained rows exist, and an anchored newest link
 * that is gone or differs (deleted or rewritten tail). Legacy v1 rows are
 * only counted (`legacy_only` when nothing else exists).
 *
 * Does not detect what needs an earlier verification run's record, which
 * only the worker's `audit.verify-chain` keeps: rows and anchor rewound
 * together to an earlier consistent state (`head_regressed`), or an
 * employee whose every row and anchor were removed (reported as `empty`).
 *
 * `anchor` must be read before `events`, so a punch recorded meanwhile
 * cannot look like truncation.
 */
export function employeeChainStatus(
  key: string,
  employeeId: string,
  events: readonly TimeEventRow[],
  anchor: ChainHead | null,
): ChainStatus {
  const scan = startChainScan(key, employeeId, anchor);
  scanChainedPage(
    scan,
    events
      .filter((e) => e.seq !== null)
      .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0)),
  );
  scanUnchainedPage(
    scan,
    events.filter((e) => e.seq === null),
  );
  return finishChainScan(scan);
}

/**
 * {@link employeeChainStatus} read from the database page by page, in `seq`
 * order with a cursor: one HMAC per stored row, at most
 * {@link CHAIN_PAGE_SIZE} rows in memory at a time.
 */
export async function verifyEmployeeChain(
  tx: TenantTx,
  key: string,
  employeeId: string,
  pageSize = CHAIN_PAGE_SIZE,
): Promise<ChainStatus> {
  // Read before the rows: rows appended meanwhile are newer than the anchor.
  const scan = startChainScan(
    key,
    employeeId,
    await timeRepo.getChainHead(tx, employeeId),
  );
  for (let afterSeq = 0; ;) {
    const page = await timeRepo.listChainPage(
      tx,
      employeeId,
      afterSeq,
      pageSize,
    );
    scanChainedPage(scan, page);
    if (page.length < pageSize) break;
    afterSeq = page[page.length - 1]!.seq ?? afterSeq;
  }
  for (let afterId: string | null = null; ;) {
    const page: TimeEventRow[] = await timeRepo.listUnchainedPage(
      tx,
      employeeId,
      afterId,
      pageSize,
    );
    scanUnchainedPage(scan, page);
    if (page.length < pageSize) break;
    afterId = page[page.length - 1]!.id;
  }
  // The first event of a new chain may have been written after the anchor
  // was read; only a still-missing anchor is a finding.
  if (scan.anchor === null && scan.newest !== null) {
    scan.anchor = await timeRepo.getChainHead(tx, employeeId);
    if (scan.anchor !== null) scan.hashAtAnchorSeq = scan.anchor.hash;
  }
  return finishChainScan(scan);
}
