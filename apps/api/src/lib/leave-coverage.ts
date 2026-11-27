import {
  blackoutsForDepartments,
  checkBlackoutDate,
  departmentIdsOn,
  evaluateTeamCoverage,
  isMembershipActiveDuring,
} from "@librehr/core";
import {
  DepartmentRepository,
  EmployeeMembershipRepository,
  EmployeeRepository,
  LeaveRepository,
  type TenantTx,
} from "@librehr/db";

const leaveRepo = new LeaveRepository();
const employeeRepo = new EmployeeRepository();
const departmentRepo = new DepartmentRepository();
const membershipRepo = new EmployeeMembershipRepository();

export interface LeaveCoverageInput {
  employeeId: string;
  primaryDepartmentId: string | null;
  startDate: string;
  endDate: string;
  halfDayStart: boolean;
  halfDayEnd: boolean;
  /** Working days of the request (calendar dates, organization time zone). */
  workingDays: readonly string[];
}

export type LeaveCoverageFailure = {
  error:
    | "BLACKOUT_PERIOD"
    | "COVERAGE_NOT_CONFIGURED"
    | "COVERAGE_UNVERIFIABLE"
    | "COVERAGE_THRESHOLD";
  message: string;
};

/**
 * Blackout and coverage checks for a new leave request (LEA-007), across
 * the primary department and every secondary department membership active
 * on each working day (ORG-007, ADR 0008 D6):
 * - blackouts are the union of org-wide ones and those of every department
 *   the person works in that day;
 * - the primary department must have a coverage policy, as before (an
 *   employee without one skips only this requirement);
 * - a secondary department is checked only when it has a policy, so adding
 *   a membership never causes COVERAGE_NOT_CONFIGURED;
 * - team size and absences count heads among the department's primary and
 *   secondary members on that day; allocation is ignored.
 * Returns null when the request may proceed.
 */
export async function checkLeaveCoverage(
  tx: TenantTx,
  input: LeaveCoverageInput,
): Promise<LeaveCoverageFailure | null> {
  const secondaries = (
    await membershipRepo.listForEmployee(tx, input.employeeId)
  ).filter(
    (m) =>
      m.departmentId !== null &&
      isMembershipActiveDuring(m, {
        startDate: input.startDate,
        endDate: input.endDate,
      }),
  );

  // Without a primary department every blackout applies, as before ORG-007.
  const blackouts = await leaveRepo.listBlackoutPeriods(tx);
  for (const date of input.workingDays) {
    const applicable =
      input.primaryDepartmentId === null
        ? blackouts
        : blackoutsForDepartments(
            blackouts,
            departmentIdsOn(input.primaryDepartmentId, secondaries, date),
          );
    const bo = checkBlackoutDate(date, applicable);
    if (bo.inBlackout) {
      return {
        error: "BLACKOUT_PERIOD",
        message: `Requested dates conflict with a blackout period: ${bo.reason}`,
      };
    }
  }

  // Coverage rules must be configured explicitly for the primary department.
  // An employee stored without one (tolerated until edited, ADR 0008 D10)
  // skips only that requirement: secondaries with a policy are still checked.
  const policies = new Map<string, number>();
  if (input.primaryDepartmentId !== null) {
    const primary = await departmentRepo.findById(
      tx,
      input.primaryDepartmentId,
    );
    if (!primary || primary.minPresencePercent === null) {
      return {
        error: "COVERAGE_NOT_CONFIGURED",
        message:
          "Configure the department coverage policy before requesting leave.",
      };
    }
    policies.set(primary.id, primary.minPresencePercent);
  }
  for (const m of secondaries) {
    const id = m.departmentId!;
    if (policies.has(id)) continue;
    const department = await departmentRepo.findById(tx, id);
    if (department?.minPresencePercent != null) {
      policies.set(id, department.minPresencePercent);
    }
  }

  for (const date of input.workingDays) {
    const requestedHalf =
      (date === input.startDate && input.halfDayStart) ||
      (date === input.endDate && input.halfDayEnd);
    for (const departmentId of departmentIdsOn(
      input.primaryDepartmentId,
      secondaries,
      date,
    )) {
      const minPresencePercent = policies.get(departmentId);
      // A secondary department without a policy is not checked.
      if (minPresencePercent === undefined) continue;
      const members = await employeeRepo.list(tx, {
        departmentId,
        membership: "any",
        asOf: date,
        status: "active",
        pageSize: 1,
      });
      const absences = await leaveRepo.getTeamAbsences(tx, {
        startDate: date,
        endDate: date,
        departmentId,
        includeSecondary: true,
      });
      const existingHalf = absences.some(
        (absence) =>
          (date === absence.startDate && absence.halfDayStart) ||
          (date === absence.endDate && absence.halfDayEnd),
      );
      if (minPresencePercent > 0 && (requestedHalf || existingHalf)) {
        return {
          error: "COVERAGE_UNVERIFIABLE",
          message:
            "Half-day coverage cannot be verified because time-of-day details are unavailable.",
        };
      }
      const coverage = evaluateTeamCoverage({
        teamSize: members.total,
        activeAbsencesOnDate: absences.length,
        minPresencePercent,
      });
      if (!coverage.allowed) {
        return {
          error: "COVERAGE_THRESHOLD",
          message: coverage.reason ?? "Team coverage threshold reached",
        };
      }
    }
  }
  return null;
}
