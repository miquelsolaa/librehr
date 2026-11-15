import type { LeaveRequestRow, TimeCorrectionRow } from "@librehr/db";

/** JSON shape of a leave request (`LeaveRequestSchema`). */
export function toLeaveRequestResponse(r: LeaveRequestRow) {
  return {
    id: r.id,
    employeeId: r.employeeId,
    employeeName: r.employeeName ?? "",
    leaveTypeId: r.leaveTypeId,
    leaveTypeName: r.leaveTypeName ?? "",
    leaveTypeCode: r.leaveTypeCode ?? "",
    leaveTypeColor: r.leaveTypeColor ?? "#3b82f6",
    startDate: r.startDate,
    endDate: r.endDate,
    halfDayStart: r.halfDayStart,
    halfDayEnd: r.halfDayEnd,
    workingDays: r.workingDays,
    status: r.status,
    notes: r.notes,
    approverId: r.approverId,
    approverName: r.approverName,
    decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
    decisionReason: r.decisionReason,
    createdAt: r.createdAt.toISOString(),
  };
}

/** JSON shape of a time correction (`TimeCorrectionItemSchema`). */
export function toTimeCorrectionResponse(i: TimeCorrectionRow) {
  return {
    id: i.id,
    employeeId: i.employeeId,
    employeeName: i.employeeName,
    refEventId: i.refEventId,
    proposedEventType: i.proposedEventType,
    proposedOccurredAt: i.proposedOccurredAt.toISOString(),
    reason: i.reason,
    status: i.status,
    approverId: i.approverId,
    approverName: i.approverName,
    decidedAt: i.decidedAt ? i.decidedAt.toISOString() : null,
    decisionReason: i.decisionReason,
    createdEventId: i.createdEventId,
    createdAt: i.createdAt.toISOString(),
  };
}
