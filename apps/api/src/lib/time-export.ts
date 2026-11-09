import type { Context } from "hono";
import {
  chainStatus,
  checkChainHead,
  dateInZone,
  verifyChainSegment,
  INITIAL_CHAIN_CURSOR,
  type ChainHead,
  type ChainStatus,
  type InspectionExportEmployee,
  type StoredChainEvent,
} from "@librehr/core";
import { TimeRepository, type TenantTx, type TimeEventRow } from "@librehr/db";
import { buildTimesheet } from "./timesheet.js";

const timeRepo = new TimeRepository();

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
 * TIM-002 status of one employee's whole chain, checked the same way as the
 * worker's `audit.verify-chain` job: chained rows in `seq` order, rows without
 * a chain position on their own (legacy, or tampered when not v1), and the
 * newest link against the stored chain-head anchor. `anchor` must be read
 * before `events`, so a punch recorded meanwhile cannot look like truncation.
 */
export function employeeChainStatus(
  key: string,
  employeeId: string,
  events: readonly TimeEventRow[],
  anchor: ChainHead | null,
): ChainStatus {
  const chained = events
    .filter((e) => e.seq !== null)
    .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  const unchained = events.filter((e) => e.seq === null);

  const main = verifyChainSegment(
    key,
    employeeId,
    chained.map(toStored),
    INITIAL_CHAIN_CURSOR,
  );
  const outside = verifyChainSegment(
    key,
    employeeId,
    unchained.map(toStored),
    // Never part of the real chain: only counted (legacy) or flagged.
    { expectedSeq: -1, expectedPrevHash: null },
  );

  const newestRow = chained[chained.length - 1];
  const newest =
    newestRow && newestRow.seq !== null
      ? { seq: newestRow.seq, hash: newestRow.hash }
      : null;
  const hashAtAnchorSeq =
    anchor === null
      ? null
      : (chained.find((e) => e.seq === anchor.seq)?.hash ?? null);
  const headIssues = checkChainHead({
    newest,
    anchor,
    hashAtAnchorSeq,
    previous: null,
    hashAtPreviousSeq: null,
  });

  return chainStatus({
    verified: main.verified,
    tampered: main.tampered + outside.tampered + headIssues.length,
    legacy: main.legacy + outside.legacy,
  });
}

/**
 * Local dates within the period touched by a TIM-003 correction: the day of
 * the corrected time and the day of the record it replaces.
 */
export function correctedDates(
  events: readonly TimeEventRow[],
  timeZone: string,
  startDate: string,
  endDate: string,
): string[] {
  const byId = new Map(events.map((e) => [e.id, e]));
  const dates = new Set<string>();
  for (const event of events) {
    if (!event.refEventId) continue;
    const touched = [event, byId.get(event.refEventId)];
    for (const item of touched) {
      if (!item) continue;
      const date = dateInZone(item.occurredAt, timeZone);
      if (date >= startDate && date <= endDate) dates.add(date);
    }
  }
  return [...dates].sort();
}

export interface ExportSubject {
  id: string;
  locationId: string | null;
  firstName: string;
  lastName: string;
}

export interface CollectedEmployee {
  input: InspectionExportEmployee;
  totalWorkedMinutes: number | null;
  totalOvertimeMinutes: number | null;
}

/**
 * Everything the export needs about one employee, in one zone: the period
 * timesheet (`days: null` without a configured schedule), corrected dates
 * and the chain status. Two queries for events and schedules, one for the
 * chain anchor.
 */
export async function collectExportEmployee(
  c: Context,
  tx: TenantTx,
  subject: ExportSubject,
  period: { startDate: string; endDate: string; timeZone: string },
  timeChainKey: string,
): Promise<CollectedEmployee> {
  const anchor = await timeRepo.getChainHead(tx, subject.id);
  const { timesheet, events } = await buildTimesheet(c, tx, {
    employeeId: subject.id,
    locationId: subject.locationId,
    startDate: period.startDate,
    endDate: period.endDate,
    timeZone: period.timeZone,
  });
  return {
    input: {
      employeeId: subject.id,
      name: `${subject.firstName} ${subject.lastName}`,
      days: timesheet.ok ? timesheet.days : null,
      correctedDates: correctedDates(
        events,
        period.timeZone,
        period.startDate,
        period.endDate,
      ),
      chainStatus: employeeChainStatus(
        timeChainKey,
        subject.id,
        events,
        anchor,
      ),
    },
    totalWorkedMinutes: timesheet.ok
      ? timesheet.summary.totalWorkedMinutes
      : null,
    totalOvertimeMinutes: timesheet.ok
      ? timesheet.summary.totalOvertimeMinutes
      : null,
  };
}
