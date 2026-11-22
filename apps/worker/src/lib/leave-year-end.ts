import {
  carryoverExpiryDate,
  planCarryoverExpiry,
  planYearEnd,
  typeBalanceCentsAt,
  yearEndBalance,
  type LedgerRow,
} from "@librehr/core";
import {
  loadEmploymentPeriods,
  LeaveYearEndRepository,
  type PolicyInForceRow,
  type TenantTx,
} from "@librehr/db";

/**
 * Year-end close and carry-over expiry steps of the leave.accrue job
 * (LEA-002, issue #116). The maths is in `@librehr/core` (`year-end.ts`);
 * these steps load the ledger, call it and write what it plans. Every read
 * and write runs in the job's tenant transaction, under RLS.
 */

interface StepContext {
  tx: TenantTx;
  deps: { logger: { warn(obj: object): void } };
  logIds: Record<string, string>;
}

export interface YearEndCounts {
  /** Employee and leave type pairs with a policy in force on 31 December. */
  balances: number;
  /** Carry-over pairs (`carryover` entries) written. */
  carryovers: number;
  forfeits: number;
  /** The year was already closed for that employee and type (re-run). */
  alreadyClosed: number;
}

const key = (employeeId: string, leaveTypeId: string) =>
  `${employeeId}:${leaveTypeId}`;

type ResolvedPolicy = PolicyInForceRow & {
  policyId: string;
  leaveTypeId: string;
  carryoverMaxDays: number;
  carryoverExpiryMonths: number;
};

const resolved = (p: PolicyInForceRow): p is ResolvedPolicy =>
  p.policyId !== null &&
  p.leaveTypeId !== null &&
  p.carryoverMaxDays !== null &&
  p.carryoverExpiryMonths !== null;

/**
 * Closes `year` per leave type an employee has a policy for on 31 December:
 * the balance up to that day is carried over up to the policy's
 * `carryover_max_days`, and the rest is forfeited. It closes employees
 * employed on some day from 31 December to `runDate` (so a fixed-term
 * contract that ended in December and restarted in January is closed too).
 * The unassigned (legacy) bucket and types without a policy are never
 * closed, nor are employees who left before 31 December and have not come
 * back: their remaining days are settled on termination, by HR.
 */
export async function closeLeaveYear(
  ctx: StepContext,
  year: number,
  runDate: string,
): Promise<YearEndCounts> {
  const { tx } = ctx;
  const repo = new LeaveYearEndRepository();
  const counts: YearEndCounts = {
    balances: 0,
    carryovers: 0,
    forfeits: 0,
    alreadyClosed: 0,
  };
  const yearEnd = `${year}-12-31`;
  // Missing policies were reported by the final accrual pass of the same
  // year, which runs first and fails the job before anything is written.
  const policies = (await repo.listPoliciesInForce(tx, yearEnd)).filter(
    resolved,
  );
  if (policies.length === 0) return counts;

  const employment = await loadEmploymentPeriods(
    tx,
    [...new Set(policies.map((p) => p.employeeId))],
    yearEnd,
    runDate > yearEnd ? runDate : yearEnd,
  );
  // null: legacy employee without employment rows or termination date,
  // employed as for accrual. [] or absent: not employed from 31 December
  // to the run date.
  const open = policies.filter((p) => {
    const spans = employment.get(p.employeeId);
    return spans === null || (spans !== undefined && spans.length > 0);
  });
  counts.balances = open.length;
  if (open.length === 0) return counts;

  const entries = new Map<string, LedgerRow[]>();
  for (const row of await repo.listTypedEntriesUpTo(
    tx,
    [...new Set(open.map((p) => p.employeeId))],
    yearEnd,
  )) {
    const list = entries.get(row.employeeId) ?? [];
    list.push(row);
    entries.set(row.employeeId, list);
  }

  for (const p of open) {
    const { balanceCents, closed } = yearEndBalance(
      entries.get(p.employeeId) ?? [],
      p.leaveTypeId,
      year,
    );
    if (closed) {
      counts.alreadyClosed++;
      continue;
    }
    const plan = planYearEnd({
      leaveTypeId: p.leaveTypeId,
      year,
      balanceCents,
      carryoverMaxDays: p.carryoverMaxDays,
    });
    let carried = false;
    let forfeited = false;
    for (const entry of plan.entries) {
      const inserted = await repo.appendYearEndOnce(tx, {
        employeeId: p.employeeId,
        leaveTypeId: p.leaveTypeId,
        ...entry,
      });
      if (!inserted) continue;
      if (entry.entryType === "carryover") carried = true;
      else forfeited = true;
    }
    if (carried) counts.carryovers++;
    if (forfeited) counts.forfeits++;
  }
  return counts;
}

/**
 * Expires the days carried over from `year` that were not used by their
 * expiry date (`carryover_expiry_months` of the policy in force on
 * 31 December of `year`). Returns the number of `expiry` entries written.
 */
export async function expireCarryovers(
  ctx: StepContext,
  year: number,
  runDate: string,
): Promise<number> {
  const { tx, deps } = ctx;
  const repo = new LeaveYearEndRepository();
  const carried = await repo.listUnexpiredCarryovers(tx, year);
  if (carried.length === 0) return 0;

  const policies = new Map(
    (await repo.listPoliciesInForce(tx, `${year}-12-31`))
      .filter(resolved)
      .map((p) => [key(p.employeeId, p.leaveTypeId), p]),
  );
  // Usage per expiry date: one query per distinct date, loaded on demand.
  const usage = new Map<string, Map<string, number>>();
  let written = 0;
  for (const c of carried) {
    const policy = policies.get(key(c.employeeId, c.leaveTypeId));
    if (!policy) {
      deps.logger.warn({
        msg: "carry-over expiry skipped: no policy in force at year end",
        ...ctx.logIds,
        employeeId: c.employeeId,
        leaveTypeId: c.leaveTypeId,
      });
      continue;
    }
    const base = {
      leaveTypeId: c.leaveTypeId,
      year,
      carriedCents: c.carriedCents,
      carryoverExpiryMonths: policy.carryoverExpiryMonths,
      runDate,
    };
    // Still usable: nothing to read or write yet.
    const due = planCarryoverExpiry({
      ...base,
      usedCents: 0,
      balanceCents: c.carriedCents,
    });
    if (due === null) continue;

    const expiresAt = carryoverExpiryDate(year, policy.carryoverExpiryMonths);
    let used = usage.get(expiresAt);
    if (!used) {
      used = new Map(
        (await repo.listNetUsageCents(tx, `${year + 1}-01-01`, expiresAt)).map(
          (u) => [key(u.employeeId, u.leaveTypeId), u.usedCents],
        ),
      );
      usage.set(expiresAt, used);
    }
    // The type's balance on the expiry date caps the expiry at zero balance.
    // Once a year per employee and type, so one small read each.
    const balanceCents = typeBalanceCentsAt(
      await repo.listTypedEntriesUpTo(tx, [c.employeeId], expiresAt),
      c.leaveTypeId,
      expiresAt,
    );
    const entry = planCarryoverExpiry({
      ...base,
      usedCents: used.get(key(c.employeeId, c.leaveTypeId)) ?? 0,
      balanceCents,
    });
    if (!entry) continue;
    const inserted = await repo.appendYearEndOnce(tx, {
      employeeId: c.employeeId,
      leaveTypeId: c.leaveTypeId,
      ...entry,
    });
    if (inserted) written++;
  }
  return written;
}
