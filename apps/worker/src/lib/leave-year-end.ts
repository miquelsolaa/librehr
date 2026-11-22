import {
  isCarryoverDue,
  planCarryoverExpiry,
  planYearEnd,
  protectsVacation,
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
 *
 * Losing days is opt-in per policy (`carryover_enforced`), and even then ET
 * art. 38.3 protects employees who had incapacity, pregnancy, birth,
 * adoption or breastfeeding leave in the period: their whole balance is
 * carried over and never expires.
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
  /**
   * Enforced balances carried over whole instead, because the employee had
   * leave protected by ET art. 38.3 in the year.
   */
  protectedFromForfeit: number;
}

export interface ExpiryCounts {
  expiries: number;
  /** Due expiries not written because ET art. 38.3 protects the employee. */
  protectedFromExpiry: number;
}

type ResolvedPolicy = PolicyInForceRow & {
  policyId: string;
  leaveTypeId: string;
  carryoverMaxDays: number;
  carryoverExpiryMonths: number;
  carryoverEnforced: boolean;
};

const resolved = (p: PolicyInForceRow): p is ResolvedPolicy =>
  p.policyId !== null &&
  p.leaveTypeId !== null &&
  p.carryoverMaxDays !== null &&
  p.carryoverExpiryMonths !== null &&
  p.carryoverEnforced !== null;

/** Employees whose vacation ET art. 38.3 protects in [from, to]. */
async function protectedEmployees(
  repo: LeaveYearEndRepository,
  tx: TenantTx,
  from: string,
  to: string,
): Promise<Set<string>> {
  const rows = await repo.listApprovedLeaveTypes(tx, from, to);
  return new Set(
    rows
      .filter((r) => protectsVacation(r.code, r.entitled))
      .map((r) => r.employeeId),
  );
}

/**
 * Closes `year` per leave type an employee has a policy for on 31 December.
 * Enforced policies carry over up to `carryover_max_days` and forfeit the
 * rest; the others (the default), and employees with protected leave in the
 * year, carry the whole balance over. It closes employees employed on some
 * day from 31 December to `runDate` (so a fixed-term contract that ended in
 * December and restarted in January is closed too). The unassigned (legacy)
 * bucket and types without a policy are never closed, nor are employees who
 * left before 31 December and have not come back: their remaining days are
 * settled on termination, by HR.
 */
export async function closeLeaveYear(
  ctx: StepContext,
  year: number,
  runDate: string,
): Promise<YearEndCounts> {
  const { tx, deps } = ctx;
  const repo = new LeaveYearEndRepository();
  const counts: YearEndCounts = {
    balances: 0,
    carryovers: 0,
    forfeits: 0,
    alreadyClosed: 0,
    protectedFromForfeit: 0,
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

  const isProtected = open.some((p) => p.carryoverEnforced)
    ? await protectedEmployees(repo, tx, `${year}-01-01`, yearEnd)
    : new Set<string>();

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
    const shielded = p.carryoverEnforced && isProtected.has(p.employeeId);
    const plan = planYearEnd({
      leaveTypeId: p.leaveTypeId,
      year,
      balanceCents,
      enforcement:
        p.carryoverEnforced && !shielded
          ? {
              carryoverMaxDays: p.carryoverMaxDays,
              carryoverExpiryMonths: p.carryoverExpiryMonths,
            }
          : null,
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
    if (shielded && balanceCents > 0) {
      counts.protectedFromForfeit++;
      // Ids only: never the leave type of the protected absence or a reason.
      deps.logger.warn({
        msg: "leave year close: carried the whole balance over (ET art. 38.3 protected leave)",
        ...ctx.logIds,
        employeeId: p.employeeId,
        leaveTypeId: p.leaveTypeId,
        policyId: p.policyId,
      });
    }
  }
  return counts;
}

/**
 * Expires the days carried over from `year` by an enforced close that were
 * not used by their `expires_on` date (fixed at the close). Employees with
 * protected leave from 1 January to that date keep the days; they are
 * closed with the next year's balance.
 */
export async function expireCarryovers(
  ctx: StepContext,
  year: number,
  runDate: string,
): Promise<ExpiryCounts> {
  const { tx, deps } = ctx;
  const repo = new LeaveYearEndRepository();
  const counts: ExpiryCounts = { expiries: 0, protectedFromExpiry: 0 };
  const due = (await repo.listUnexpiredCarryovers(tx, year)).filter((c) =>
    isCarryoverDue(c.expiresOn, runDate),
  );
  if (due.length === 0) return counts;

  const windowStart = `${year + 1}-01-01`;
  // Usage and protection per expiry date: one query each per distinct date.
  const usage = new Map<string, Map<string, number>>();
  const shielded = new Map<string, Set<string>>();
  for (const c of due) {
    let used = usage.get(c.expiresOn);
    let isProtected = shielded.get(c.expiresOn);
    if (!used || !isProtected) {
      used = new Map(
        (await repo.listNetUsageCents(tx, windowStart, c.expiresOn)).map(
          (u) => [`${u.employeeId}:${u.leaveTypeId}`, u.usedCents],
        ),
      );
      isProtected = await protectedEmployees(
        repo,
        tx,
        windowStart,
        c.expiresOn,
      );
      usage.set(c.expiresOn, used);
      shielded.set(c.expiresOn, isProtected);
    }
    if (isProtected.has(c.employeeId)) {
      counts.protectedFromExpiry++;
      // Warn in the run for the expiry month only, not every later month.
      if (runDate.slice(0, 7) === c.expiresOn.slice(0, 7)) {
        deps.logger.warn({
          msg: "carry-over expiry skipped: ET art. 38.3 protected leave",
          ...ctx.logIds,
          employeeId: c.employeeId,
          leaveTypeId: c.leaveTypeId,
        });
      }
      continue;
    }
    // The type's balance on the expiry date caps the expiry at zero balance.
    // Once a year per employee and type, so one small read each.
    const balanceCents = typeBalanceCentsAt(
      await repo.listTypedEntriesUpTo(tx, [c.employeeId], c.expiresOn),
      c.leaveTypeId,
      c.expiresOn,
    );
    const entry = planCarryoverExpiry({
      leaveTypeId: c.leaveTypeId,
      year,
      carriedCents: c.carriedCents,
      expiresOn: c.expiresOn,
      usedCents: used.get(`${c.employeeId}:${c.leaveTypeId}`) ?? 0,
      balanceCents,
      runDate,
    });
    if (!entry) continue;
    const inserted = await repo.appendYearEndOnce(tx, {
      employeeId: c.employeeId,
      leaveTypeId: c.leaveTypeId,
      ...entry,
    });
    if (inserted) counts.expiries++;
  }
  return counts;
}
