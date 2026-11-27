export interface BlackoutPeriod {
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  reason: string;
}

export interface TeamCoverageCheckParams {
  teamSize: number;
  activeAbsencesOnDate: number;
  minPresencePercent?: number | undefined; // e.g. 50 (at least 50% must be present)
  maxAbsenceCount?: number | undefined; // e.g. 2 (at most 2 people absent)
}

export interface TeamCoverageResult {
  allowed: boolean;
  reason?: string | undefined;
  presencePercent: number;
  projectedAbsences: number;
}

/**
 * Checks whether a requested date falls inside any active blackout period (LEA-007).
 */
export function checkBlackoutDate(
  date: string,
  blackouts: readonly BlackoutPeriod[],
): { inBlackout: boolean; reason?: string | undefined } {
  for (const bo of blackouts) {
    if (date >= bo.startDate && date <= bo.endDate) {
      return {
        inBlackout: true,
        reason:
          bo.reason || "Blackout period active for company peak operations",
      };
    }
  }
  return { inBlackout: false };
}

/** A blackout period scoped to one department, or org-wide when null. */
export interface DepartmentBlackoutPeriod extends BlackoutPeriod {
  departmentId: string | null;
}

/**
 * Blackouts that apply to someone working in `departmentIds`: org-wide ones
 * plus those of any of the departments, i.e. the union across the primary
 * and secondary departments (LEA-007, ADR 0008 D6).
 *
 * @example
 * blackoutsForDepartments(
 *   [
 *     { departmentId: null, startDate: "2026-12-24", endDate: "2026-12-31", reason: "Closing" },
 *     { departmentId: "d2", startDate: "2026-11-20", endDate: "2026-11-30", reason: "Peak" },
 *     { departmentId: "d3", startDate: "2026-08-01", endDate: "2026-08-15", reason: "Audit" },
 *   ],
 *   ["d1", "d2"],
 * ); // => the org-wide and the d2 blackouts
 */
export function blackoutsForDepartments<T extends DepartmentBlackoutPeriod>(
  blackouts: readonly T[],
  departmentIds: readonly string[],
): T[] {
  return blackouts.filter(
    (bo) => bo.departmentId === null || departmentIds.includes(bo.departmentId),
  );
}

/**
 * Pure calculation to enforce team coverage minimum thresholds (LEA-007).
 */
export function evaluateTeamCoverage(
  params: TeamCoverageCheckParams,
): TeamCoverageResult {
  const {
    teamSize,
    activeAbsencesOnDate,
    minPresencePercent,
    maxAbsenceCount,
  } = params;

  if (teamSize <= 0) {
    return {
      allowed: true,
      presencePercent: 100,
      projectedAbsences: activeAbsencesOnDate + 1,
    };
  }

  const projectedAbsences = activeAbsencesOnDate + 1; // including the new requested absence
  const projectedPresent = Math.max(0, teamSize - projectedAbsences);
  const presencePercent = Math.round((projectedPresent / teamSize) * 100);

  if (maxAbsenceCount !== undefined && projectedAbsences > maxAbsenceCount) {
    return {
      allowed: false,
      reason: `Maximum team absence limit of ${maxAbsenceCount} employees reached on this date (${projectedAbsences} projected).`,
      presencePercent,
      projectedAbsences,
    };
  }

  if (
    minPresencePercent !== undefined &&
    presencePercent < minPresencePercent
  ) {
    return {
      allowed: false,
      reason: `Team presence would drop to ${presencePercent}%, below the required minimum threshold of ${minPresencePercent}%.`,
      presencePercent,
      projectedAbsences,
    };
  }

  return {
    allowed: true,
    presencePercent,
    projectedAbsences,
  };
}
