import { calculateWorkingDays } from "../calendar/working-days.js";
import type { LeaveLedgerEntry } from "./ledger.js";
import { foldLedgerToBalance } from "./ledger.js";

export interface ExistingRequest {
  id: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  status: "pending" | "approved" | "rejected" | "cancelled";
}

export interface LeaveRequestProposal {
  startDate: string;
  endDate: string;
  halfDayStart?: boolean | undefined;
  halfDayEnd?: boolean | undefined;
}

export interface LeaveValidationOptions {
  proposal: LeaveRequestProposal;
  ledgerEntries: readonly LeaveLedgerEntry[];
  existingRequests: readonly ExistingRequest[];
  holidays?: ReadonlySet<string> | undefined;
  allowNegativeBalance?: boolean | undefined;
}

export interface ValidationSuccess {
  valid: true;
  requiredDays: number;
  remainingBalanceAfter: number;
}

export interface ValidationFailure {
  valid: false;
  reason: "INVALID_DATES" | "INSUFFICIENT_BALANCE" | "OVERLAPPING_REQUEST";
  message: string;
}

export type LeaveValidationResult = ValidationSuccess | ValidationFailure;

export function validateLeaveRequest(
  options: LeaveValidationOptions,
): LeaveValidationResult {
  const {
    proposal,
    ledgerEntries,
    existingRequests,
    holidays,
    allowNegativeBalance,
  } = options;

  if (proposal.startDate > proposal.endDate) {
    return {
      valid: false,
      reason: "INVALID_DATES",
      message: `Start date ${proposal.startDate} must be on or before end date ${proposal.endDate}`,
    };
  }

  // Check overlap with active existing requests
  const activeExisting = existingRequests.filter(
    (req) => req.status === "approved" || req.status === "pending",
  );

  for (const req of activeExisting) {
    // Two intervals [s1, e1] and [s2, e2] overlap if s1 <= e2 and s2 <= e1
    if (
      proposal.startDate <= req.endDate &&
      req.startDate <= proposal.endDate
    ) {
      return {
        valid: false,
        reason: "OVERLAPPING_REQUEST",
        message: `Requested dates overlap with an existing ${req.status} request from ${req.startDate} to ${req.endDate}`,
      };
    }
  }

  // Calculate working days
  const calculation = calculateWorkingDays({
    startDate: proposal.startDate,
    endDate: proposal.endDate,
    holidays,
    halfDayStart: proposal.halfDayStart,
    halfDayEnd: proposal.halfDayEnd,
  });

  const requiredDays = calculation.totalWorkingDays;
  const currentBalance = foldLedgerToBalance(ledgerEntries);
  const remainingBalanceAfter =
    Math.round((currentBalance - requiredDays) * 100) / 100;

  if (remainingBalanceAfter < 0 && !allowNegativeBalance) {
    return {
      valid: false,
      reason: "INSUFFICIENT_BALANCE",
      message: `Insufficient leave balance: requires ${requiredDays} days, but current balance is ${currentBalance} days`,
    };
  }

  return {
    valid: true,
    requiredDays,
    remainingBalanceAfter,
  };
}
