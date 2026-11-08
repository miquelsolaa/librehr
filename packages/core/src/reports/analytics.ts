export interface EmployeeSnapshot {
  id: string;
  hireDate: string; // YYYY-MM-DD
  terminationDate?: string | null | undefined; // YYYY-MM-DD
  departmentId?: string | null | undefined;
}

export interface HeadcountMetrics {
  startingHeadcount: number;
  endingHeadcount: number;
  joinersCount: number;
  leaversCount: number;
  netChange: number;
  turnoverRatePercent: number;
}

/**
 * Calculates headcount metrics over a specified date range (RPT-001).
 * Follows standard HR turnover formulas:
 * turnoverRate = (leavers / averageHeadcount) * 100
 */
export function calculateHeadcountMetrics(
  employees: EmployeeSnapshot[],
  startDateStr: string, // YYYY-MM-DD
  endDateStr: string, // YYYY-MM-DD
): HeadcountMetrics {
  let startingHeadcount = 0;
  let endingHeadcount = 0;
  let joinersCount = 0;
  let leaversCount = 0;

  for (const emp of employees) {
    const terminationDate = emp.terminationDate ?? null;

    // Was active at the start moment
    const activeAtStart =
      emp.hireDate < startDateStr &&
      (!terminationDate || terminationDate >= startDateStr);
    if (activeAtStart) {
      startingHeadcount++;
    }

    // Closing headcount excludes departures effective on the last day.
    const activeAtEnd =
      emp.hireDate <= endDateStr &&
      (!terminationDate || terminationDate > endDateStr);
    if (activeAtEnd) {
      endingHeadcount++;
    }

    // Joined during the period
    if (emp.hireDate >= startDateStr && emp.hireDate <= endDateStr) {
      joinersCount++;
    }

    // Left during the period
    if (
      terminationDate &&
      terminationDate >= startDateStr &&
      terminationDate <= endDateStr
    ) {
      leaversCount++;
    }
  }

  const averageHeadcount = (startingHeadcount + endingHeadcount) / 2;
  const turnoverRatePercent =
    averageHeadcount > 0
      ? Math.round((leaversCount / averageHeadcount) * 10000) / 100
      : 0;

  return {
    startingHeadcount,
    endingHeadcount,
    joinersCount,
    leaversCount,
    netChange: endingHeadcount - startingHeadcount,
    turnoverRatePercent,
  };
}

export interface AbsenceRecord {
  employeeId: string;
  category: "vacation" | "sick" | "maternity_paternity" | "unpaid" | "other";
  workingDays: number;
}

export interface AbsenceMetrics {
  totalAbsentDays: number;
  totalPlannedWorkingDays: number;
  absenceRatePercent: number;
  byCategory: Record<string, number>;
}

/**
 * Calculates absence rate over a working period (RPT-001).
 * absenceRate = (totalAbsentDays / totalPlannedWorkingDays) * 100
 */
export function calculateAbsenceMetrics(
  absences: AbsenceRecord[],
  activeEmployeeCount: number,
  workingDaysInPeriod: number,
): AbsenceMetrics {
  const totalPlannedWorkingDays = activeEmployeeCount * workingDaysInPeriod;
  let totalAbsentDays = 0;
  const byCategory: Record<string, number> = {
    vacation: 0,
    sick: 0,
    maternity_paternity: 0,
    unpaid: 0,
    other: 0,
  };

  for (const abs of absences) {
    totalAbsentDays += abs.workingDays;
    byCategory[abs.category] =
      (byCategory[abs.category] ?? 0) + abs.workingDays;
  }

  const absenceRatePercent =
    totalPlannedWorkingDays > 0
      ? Math.round((totalAbsentDays / totalPlannedWorkingDays) * 10000) / 100
      : 0;

  return {
    totalAbsentDays,
    totalPlannedWorkingDays,
    absenceRatePercent,
    byCategory,
  };
}
