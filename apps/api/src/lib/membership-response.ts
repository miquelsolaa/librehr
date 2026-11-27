import type {
  EmployeeMembership,
  EmployeeMembershipWriteResponse,
} from "@librehr/contracts";
import {
  peakAllocationDuring,
  type EmployeeMembership as CoreMembership,
} from "@librehr/core";
import type { EmployeeMembershipRow } from "@librehr/db";

export function toMembership(row: EmployeeMembershipRow): EmployeeMembership {
  return {
    id: row.id,
    employeeId: row.employeeId,
    departmentId: row.departmentId,
    groupId: row.groupId,
    targetType: row.targetType,
    targetName: row.targetName,
    role: row.role,
    allocationPercent: row.allocationPercent,
    startDate: row.startDate,
    endDate: row.endDate,
    endReason: row.endReason,
    ended: row.endedBy !== null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** The write result plus the over-allocation warning (ADR 0008 D3). */
export function writeResponse(
  row: EmployeeMembershipRow,
  others: readonly CoreMembership[],
): EmployeeMembershipWriteResponse {
  const peak = peakAllocationDuring([...others, row], row);
  return {
    membership: toMembership(row),
    overAllocation: peak.overAllocated
      ? { date: peak.date, totalPercent: peak.totalPercent }
      : null,
  };
}
