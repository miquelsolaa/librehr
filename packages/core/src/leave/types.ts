export type StandardLeaveTypeCode =
  | "vacation"
  | "personal_days"
  | "sick_leave"
  | "marriage"
  | "hospitalization_family"
  | "bereavement"
  | "moving"
  | "public_duty"
  | "prenatal_exams"
  | "family_force_majeure"
  | "parental_leave_unpaid"
  | "birth_childcare"
  | "education_exams"
  | "parental_leave"
  | "unpaid_leave"
  | "other";

export interface LeaveTypeConfig {
  code: StandardLeaveTypeCode | string;
  name: string;
  isPaid: boolean;
  requiresApproval: boolean;
  halfDaysAllowed: boolean;
  countsWorkingDays: boolean;
  color?: string;
}

export type AccrualMethod = "upfront" | "monthly" | "daily";

export interface LeavePolicyConfig {
  annualAllowanceDays: number;
  accrualMethod: AccrualMethod;
  carryoverMaxDays: number;
  carryoverExpiryMonths: number; // e.g. 3 months -> expires March 31
  allowNegativeBalance?: boolean;
}
