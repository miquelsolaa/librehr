/**
 * ET art. 38.3: vacation that could not be taken because of temporary
 * incapacity, pregnancy, birth, adoption or breastfeeding (and the related
 * suspensions of ET art. 48) may be taken after that leave ends. The year-end
 * close therefore never forfeits or expires days of an employee who had such
 * leave in the period (LEA-002, maintainer decision on #132).
 *
 * Leave types only expose a free-text `code`, so the rule is deliberately
 * cautious: a leave type protects when its code is one of the protected codes
 * below, or when it is not an entitlement of the employee (no policy) and its
 * code is not a known ordinary permit. A custom or `other` type therefore
 * protects, as the safe fallback.
 */

/** Codes of leave that ET art. 38.3 protects. */
export const PROTECTED_LEAVE_CODES: ReadonlySet<string> = new Set([
  "sick_leave",
  "temporary_incapacity",
  "pregnancy_risk",
  "prenatal_exams",
  "maternity",
  "paternity",
  "birth_childcare",
  "adoption",
  "breastfeeding",
  "breastfeeding_risk",
]);

/** Known codes of ordinary leave and permits that never protect. */
export const ORDINARY_LEAVE_CODES: ReadonlySet<string> = new Set([
  "vacation",
  "personal_days",
  "marriage",
  "hospitalization_family",
  "bereavement",
  "moving",
  "public_duty",
  "family_force_majeure",
  "education_exams",
  "parental_leave",
  "parental_leave_unpaid",
  "unpaid_leave",
]);

/**
 * Whether approved leave of this type protects the employee's vacation from
 * forfeit and expiry (ET art. 38.3).
 *
 * @example
 * protectsVacation("sick_leave", false); // => true
 * protectsVacation("vacation", true);    // => false
 * protectsVacation("other", false);      // => true (unknown: safe fallback)
 * protectsVacation("other", true);       // => false (an entitlement)
 */
export function protectsVacation(
  leaveTypeCode: string,
  entitled: boolean,
): boolean {
  if (PROTECTED_LEAVE_CODES.has(leaveTypeCode)) return true;
  return !entitled && !ORDINARY_LEAVE_CODES.has(leaveTypeCode);
}
