import type { AccrualMethod } from "./types.js";

export interface ProratedAllowanceOptions {
  annualAllowance: number;
  year: number;
  startDate: string; // YYYY-MM-DD
  endDate?: string | undefined; // YYYY-MM-DD
  fteRatio?: number | undefined; // Full-time equivalent (e.g. 1.0 for 40h/week, 0.5 for 20h/week)
  roundingPrecision?: "exact" | "half_day" | "quarter_day" | undefined;
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function getDaysInYear(year: number): number {
  return isLeapYear(year) ? 366 : 365;
}

function parseIsoDateToUtc(dateStr: string): Date {
  const [yearStr, monthStr, dayStr] = dateStr.split("-");
  const year = parseInt(yearStr ?? "2026", 10);
  const month = parseInt(monthStr ?? "1", 10) - 1;
  const day = parseInt(dayStr ?? "1", 10);
  return new Date(Date.UTC(year, month, day));
}

function roundToPrecision(
  val: number,
  precision: "exact" | "half_day" | "quarter_day" = "exact",
): number {
  if (precision === "half_day") {
    return Math.round(val * 2) / 2;
  }
  if (precision === "quarter_day") {
    return Math.round(val * 4) / 4;
  }
  return Math.round(val * 100) / 100;
}

/**
 * Calculates statutory prorated leave entitlement for employees who start or terminate mid-year,
 * or work under part-time FTE contracts (Estatuto de los Trabajadores art. 38).
 */
export function calculateProratedAllowance(
  options: ProratedAllowanceOptions,
): number {
  const {
    annualAllowance,
    year,
    startDate,
    endDate,
    fteRatio = 1.0,
    roundingPrecision = "exact",
  } = options;

  if (annualAllowance <= 0 || fteRatio <= 0) {
    return 0;
  }

  const yearStartStr = `${year}-01-01`;
  const yearEndStr = `${year}-12-31`;

  // Determine effective start and end dates within the reference year
  const effectiveStartStr = startDate > yearStartStr ? startDate : yearStartStr;
  const effectiveEndStr =
    endDate && endDate < yearEndStr ? endDate : yearEndStr;

  if (effectiveStartStr > effectiveEndStr) {
    return 0;
  }

  const startUtc = parseIsoDateToUtc(effectiveStartStr).getTime();
  const endUtc = parseIsoDateToUtc(effectiveEndStr).getTime();
  const dayMs = 24 * 60 * 60 * 1000;

  const activeDays = Math.round((endUtc - startUtc) / dayMs) + 1;
  const totalDays = getDaysInYear(year);

  const fractionOfYear = Math.min(1, Math.max(0, activeDays / totalDays));
  const rawProrated = annualAllowance * fractionOfYear * fteRatio;

  return roundToPrecision(rawProrated, roundingPrecision);
}

export interface PeriodicAccrualOptions {
  annualAllowance: number;
  accrualMethod: AccrualMethod;
  month: number; // 1 to 12
  year?: number | undefined;
  fteRatio?: number | undefined;
  roundingPrecision?: "exact" | "half_day" | "quarter_day" | undefined;
}

/**
 * Calculates leave accrued for a specific period (e.g. monthly scheduled pg-boss worker run).
 */
export function calculatePeriodicAccrual(
  options: PeriodicAccrualOptions,
): number {
  const {
    annualAllowance,
    accrualMethod,
    month,
    fteRatio = 1.0,
    roundingPrecision = "exact",
  } = options;

  if (annualAllowance <= 0 || fteRatio <= 0) {
    return 0;
  }

  if (accrualMethod === "upfront") {
    // Granted fully at the start of the year (month 1)
    const amount = month === 1 ? annualAllowance * fteRatio : 0;
    return roundToPrecision(amount, roundingPrecision);
  }

  if (accrualMethod === "monthly") {
    const monthlyRate = (annualAllowance / 12) * fteRatio;
    return roundToPrecision(monthlyRate, roundingPrecision);
  }

  // Daily accrual fallback (approximated for 1 month of 30.4 days)
  const monthlyApprox = (annualAllowance / 365) * 30.416 * fteRatio;
  return roundToPrecision(monthlyApprox, roundingPrecision);
}
