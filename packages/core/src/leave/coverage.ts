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
