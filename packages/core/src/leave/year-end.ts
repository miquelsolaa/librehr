import { Temporal } from "temporal-polyfill";
import { calculateCarryover, isCarryoverExpired } from "./carryover.js";

/**
 * Year-end close and carry-over expiry of one leave type's balance (LEA-002,
 * LEA-005, issue #116). Pure: the worker loads the ledger and writes the
 * planned entries.
 *
 * The ledger is cumulative (a balance is the sum of all of a type's
 * entries), so what is left at year end is already in next year's balance.
 * Closing a year therefore writes entries that net to minus the forfeited
 * days:
 *
 * - `carryover`, −C, dated 31 December, ref `carryover:<type>:<YYYY>:close`;
 * - `carryover`, +C, dated 1 January, ref `carryover:<type>:<YYYY>`;
 * - `forfeit`, −F, dated 31 December, ref `forfeit:<type>:<YYYY>`;
 *
 * where C = min(balance, cap) and F = balance − C. The pair moves C from one
 * year into the next, so a history read per year shows the days carried
 * over, while the balance only drops by F. Later, `expiry` (−unused,
 * ref `expiry:<type>:<YYYY>`) removes what was carried and not used in time.
 *
 * Every ref holds the leave type and the year closed, and the ledger allows
 * each one once per employee (migration 0036), so re-running is a no-op.
 * Entries without a leave type (the legacy "unassigned" bucket) are never
 * closed: callers pass a leave type, and `yearEndBalance` ignores the rest.
 */

export type YearEndEntryType = "carryover" | "forfeit" | "expiry";

export interface YearEndEntry {
  entryType: YearEndEntryType;
  /** Days, 2 decimals (`leave_ledger.amount` is numeric(5,2)). */
  amount: number;
  sourceRef: string;
  /** Local business date. */
  effectiveDate: string;
}

/** `carryover:<leaveTypeId>:<YYYY>`: the +C entry dated 1 January. */
export const carryoverSourceRef = (leaveTypeId: string, year: number) =>
  `carryover:${leaveTypeId}:${year}`;
/** `carryover:<leaveTypeId>:<YYYY>:close`: the −C entry dated 31 December. */
export const carryoverCloseSourceRef = (leaveTypeId: string, year: number) =>
  `carryover:${leaveTypeId}:${year}:close`;
/** `forfeit:<leaveTypeId>:<YYYY>`: days above the cap, lost at year end. */
export const forfeitSourceRef = (leaveTypeId: string, year: number) =>
  `forfeit:${leaveTypeId}:${year}`;
/** `expiry:<leaveTypeId>:<YYYY>`: carried days of `YYYY` left unused. */
export const expirySourceRef = (leaveTypeId: string, year: number) =>
  `expiry:${leaveTypeId}:${year}`;

const cents = (days: number) => Math.round(days * 100);

function checkYear(year: number) {
  if (!Number.isInteger(year) || year < 1000 || year > 9999) {
    throw new RangeError("year must be a four-digit integer");
  }
}

export interface LedgerRow {
  /** Null: a legacy entry without a leave type. */
  leaveTypeId: string | null;
  entryType: string;
  amount: number;
  sourceRef: string | null;
  effectiveDate: string;
}

/**
 * The balance of one leave type at the end of `year`, in integer cents:
 * every entry of that type dated on or before 31 December, except the
 * year's own close entries. `closed` is true once those exist, so a re-run
 * plans nothing even if a backdated entry changed the balance since.
 *
 * @example
 * yearEndBalance(
 *   [
 *     { leaveTypeId: "vac", entryType: "accrual", amount: 22, sourceRef: null, effectiveDate: "2026-01-01" },
 *     { leaveTypeId: "vac", entryType: "usage", amount: -12, sourceRef: "r1", effectiveDate: "2026-08-03" },
 *     { leaveTypeId: "vac", entryType: "usage", amount: -2, sourceRef: "r2", effectiveDate: "2027-01-04" },
 *     { leaveTypeId: null, entryType: "adjustment", amount: 5, sourceRef: null, effectiveDate: "2026-02-01" },
 *   ],
 *   "vac",
 *   2026,
 * ); // => { balanceCents: 1000, closed: false }
 */
export function yearEndBalance(
  entries: readonly LedgerRow[],
  leaveTypeId: string,
  year: number,
): { balanceCents: number; closed: boolean } {
  checkYear(year);
  const yearEnd = `${year}-12-31`;
  const closeRefs = new Set([
    carryoverCloseSourceRef(leaveTypeId, year),
    forfeitSourceRef(leaveTypeId, year),
  ]);
  let balanceCents = 0;
  let closed = false;
  for (const e of entries) {
    if (e.leaveTypeId !== leaveTypeId || e.effectiveDate > yearEnd) continue;
    if (e.sourceRef !== null && closeRefs.has(e.sourceRef)) {
      closed = true;
      continue;
    }
    balanceCents += cents(e.amount);
  }
  return { balanceCents, closed };
}

export interface YearEndInput {
  leaveTypeId: string;
  /** The leave year being closed. */
  year: number;
  /** `yearEndBalance(...).balanceCents`. */
  balanceCents: number;
  /** From the policy in force on 31 December (`carryover_max_days`). */
  carryoverMaxDays: number;
}

export interface YearEndPlan {
  carryoverCents: number;
  forfeitCents: number;
  /** Nothing when the balance is zero or negative. */
  entries: YearEndEntry[];
}

/**
 * Plans the close of one leave type's year: the remaining balance is carried
 * over up to the policy's cap and the excess is forfeited. A zero or
 * negative balance writes nothing (a negative balance stays owed in the
 * cumulative ledger). Carry-over plus forfeit always equals the balance.
 *
 * @example
 * planYearEnd({ leaveTypeId: "vac", year: 2026, balanceCents: 850, carryoverMaxDays: 5 });
 * // => { carryoverCents: 500, forfeitCents: 350, entries: [
 * //   { entryType: "carryover", amount: -5, sourceRef: "carryover:vac:2026:close", effectiveDate: "2026-12-31" },
 * //   { entryType: "carryover", amount: 5, sourceRef: "carryover:vac:2026", effectiveDate: "2027-01-01" },
 * //   { entryType: "forfeit", amount: -3.5, sourceRef: "forfeit:vac:2026", effectiveDate: "2026-12-31" } ] }
 */
export function planYearEnd(input: YearEndInput): YearEndPlan {
  checkYear(input.year);
  if (!Number.isInteger(input.balanceCents)) {
    throw new RangeError("balanceCents must be an integer");
  }
  if (!Number.isFinite(input.carryoverMaxDays)) {
    throw new RangeError("carryoverMaxDays must be a finite number");
  }
  if (input.balanceCents <= 0) {
    return { carryoverCents: 0, forfeitCents: 0, entries: [] };
  }
  const { carryoverAmount } = calculateCarryover({
    unusedBalance: input.balanceCents / 100,
    maxCarryoverDays: input.carryoverMaxDays,
    year: input.year,
  });
  const carryoverCents = Math.min(cents(carryoverAmount), input.balanceCents);
  // Derived from the integer balance, so C + F is the balance exactly.
  const forfeitCents = input.balanceCents - carryoverCents;
  const { leaveTypeId, year } = input;
  const yearEnd = `${year}-12-31`;
  const entries: YearEndEntry[] = [];
  if (carryoverCents > 0) {
    entries.push(
      {
        entryType: "carryover",
        amount: -carryoverCents / 100,
        sourceRef: carryoverCloseSourceRef(leaveTypeId, year),
        effectiveDate: yearEnd,
      },
      {
        entryType: "carryover",
        amount: carryoverCents / 100,
        sourceRef: carryoverSourceRef(leaveTypeId, year),
        effectiveDate: `${year + 1}-01-01`,
      },
    );
  }
  if (forfeitCents > 0) {
    entries.push({
      entryType: "forfeit",
      amount: -forfeitCents / 100,
      sourceRef: forfeitSourceRef(leaveTypeId, year),
      effectiveDate: yearEnd,
    });
  }
  return { carryoverCents, forfeitCents, entries };
}

/**
 * Last day on which days carried over from `year` can be used: the end of
 * month `carryoverExpiryMonths` of the next year (`calculateCarryover`
 * clamps the months to 1..12).
 *
 * @example
 * carryoverExpiryDate(2027, 2); // => "2028-02-29"
 */
export function carryoverExpiryDate(
  year: number,
  carryoverExpiryMonths: number,
): string {
  checkYear(year);
  if (!Number.isInteger(carryoverExpiryMonths)) {
    throw new RangeError("carryoverExpiryMonths must be an integer");
  }
  return calculateCarryover({
    unusedBalance: 0,
    maxCarryoverDays: 0,
    expiryMonths: carryoverExpiryMonths,
    year,
  }).expiresAt;
}

export interface CarryoverExpiryInput {
  leaveTypeId: string;
  /** The year the days were carried over from. */
  year: number;
  /** The +C carry-over entry, in cents. */
  carriedCents: number;
  /**
   * Days of this leave type used from 1 January of the next year through
   * the expiry date, in cents: usage net of cancelled (reversed) requests.
   */
  usedCents: number;
  /** From the policy in force when the year was closed. */
  carryoverExpiryMonths: number;
  /**
   * The run's business date. The run starts once that day has ended, so a
   * carry-over whose last day is `runDate` has expired.
   */
  runDate: string;
}

/**
 * Plans the expiry of carried-over days: once the expiry date has passed,
 * the carried amount minus the days used since 1 January (floored at 0, and
 * never more than was carried) expires. Usage is counted against carried
 * days first. Dated on the expiry date, so a later year-end close sees it.
 * Returns null while the days are still usable or when none are left.
 *
 * @example
 * planCarryoverExpiry({ leaveTypeId: "vac", year: 2026, carriedCents: 500,
 *   usedCents: 200, carryoverExpiryMonths: 3, runDate: "2027-03-31" });
 * // => { entryType: "expiry", amount: -3, sourceRef: "expiry:vac:2026",
 * //      effectiveDate: "2027-03-31" }
 */
export function planCarryoverExpiry(
  input: CarryoverExpiryInput,
): YearEndEntry | null {
  if (!Number.isInteger(input.carriedCents) || input.carriedCents < 0) {
    throw new RangeError("carriedCents must be a non-negative integer");
  }
  if (!Number.isInteger(input.usedCents)) {
    throw new RangeError("usedCents must be an integer");
  }
  const expiresAt = carryoverExpiryDate(
    input.year,
    input.carryoverExpiryMonths,
  );
  const now = Temporal.PlainDate.from(input.runDate).add({ days: 1 });
  if (!isCarryoverExpired(expiresAt, now.toString())) return null;
  const unused = Math.min(
    input.carriedCents,
    Math.max(0, input.carriedCents - Math.max(0, input.usedCents)),
  );
  if (unused === 0) return null;
  return {
    entryType: "expiry",
    amount: -unused / 100,
    sourceRef: expirySourceRef(input.leaveTypeId, input.year),
    effectiveDate: expiresAt,
  };
}
