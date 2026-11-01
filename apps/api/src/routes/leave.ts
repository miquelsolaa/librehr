import { Hono } from "hono";
import type { Sql } from "postgres";
import {
  type AuthUser,
  createProblemDetails,
  CreateLeaveTypeRequestSchema,
  CreateLeaveRequestSchema,
  DecideLeaveRequestSchema,
  AdjustBalanceRequestSchema,
} from "@openhr/contracts";
import { validateLeaveRequest, calculateWorkingDays } from "@openhr/core";
import {
  withTenant,
  LeaveRepository,
  HolidayRepository,
  EmployeeRepository,
  NotificationRepository,
  AuditRepository,
} from "@openhr/db";
import { requireAuth } from "../middleware/auth.js";
import { can } from "../policies/can.js";
import type { MailPort } from "../ports/mail.js";

export function createLeaveRoutes(sql: Sql, _mailPort?: MailPort) {
  const router = new Hono();
  const leaveRepo = new LeaveRepository();
  const holidayRepo = new HolidayRepository();
  const employeeRepo = new EmployeeRepository();
  const notificationRepo = new NotificationRepository();
  const auditRepo = new AuditRepository();

  // 1. GET /leave/types - List configurable leave types
  router.get("/leave/types", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;

    const types = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        return leaveRepo.getLeaveTypes(tx);
      },
    );

    return c.json(types);
  });

  // 2. POST /leave/types - Create leave type (admin only)
  router.post("/leave/types", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;

    const allowed = can(
      {
        userId: user.id,
        organizationId: user.organizationId,
        role: user.role,
      },
      "org.write",
    );

    if (!allowed) {
      const problem = createProblemDetails({
        status: 403,
        title: "Forbidden",
        detail: "You do not have permission to configure leave types",
        code: "FORBIDDEN",
      });
      return c.json(problem, 403, {
        "Content-Type": "application/problem+json",
      });
    }

    const body = await c.req.json().catch(() => null);
    const parsed = CreateLeaveTypeRequestSchema.safeParse(body);
    if (!parsed.success) {
      const problem = createProblemDetails({
        status: 400,
        title: "Bad Request",
        detail: parsed.error.errors.map((e) => e.message).join(", "),
        code: "VALIDATION_ERROR",
        errors: parsed.error.issues.map((i) => ({
          field: i.path.join("."),
          message: i.message,
        })),
      });
      return c.json(problem, 400, {
        "Content-Type": "application/problem+json",
      });
    }

    const created = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        return leaveRepo.createLeaveType(tx, parsed.data);
      },
    );

    return c.json(created, 201);
  });

  // 3. GET /leave/balance - Get employee's leave balance summary & ledger timeline
  router.get("/leave/balance", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;
    const requestedEmployeeId = c.req.query("employeeId");

    const summary = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        // Resolve target employee
        let targetEmployeeId = requestedEmployeeId;
        if (!targetEmployeeId) {
          const emp = await employeeRepo.findByUserId(tx, user.id);
          if (!emp) {
            return null;
          }
          targetEmployeeId = emp.id;
        }

        // Authorization check
        const emp = await employeeRepo.findById(tx, targetEmployeeId);
        if (!emp) {
          return "NOT_FOUND";
        }

        const isSelf = emp.userId === user.id;
        const allowed =
          isSelf ||
          can(
            {
              userId: user.id,
              organizationId: user.organizationId,
              role: user.role,
            },
            "leave.request.read",
            {
              organizationId: user.organizationId,
              employeeId: emp.id,
              managerId: emp.managerId ?? undefined,
            },
          );

        if (!allowed) {
          return "FORBIDDEN";
        }

        const balance = await leaveRepo.calculateBalance(tx, targetEmployeeId);
        const entries = await leaveRepo.getLedgerEntries(tx, targetEmployeeId);

        return {
          currentBalance: balance.currentBalance,
          totalAccrued: balance.totalAccrued,
          totalUsed: balance.totalUsed,
          totalCarryover: balance.totalCarryover,
          totalAdjustments: balance.totalAdjustments,
          entries: entries.map((e) => ({
            id: e.id,
            employeeId: e.employeeId,
            entryType: e.entryType,
            amount: e.amount,
            unit: e.unit,
            sourceRef: e.sourceRef,
            note: e.note,
            effectiveDate: e.effectiveDate,
            createdAt: e.createdAt.toISOString(),
          })),
        };
      },
    );

    if (summary === "NOT_FOUND" || summary === null) {
      const problem = createProblemDetails({
        status: 404,
        title: "Not Found",
        detail: "Employee profile not found",
        code: "EMPLOYEE_NOT_FOUND",
      });
      return c.json(problem, 404, {
        "Content-Type": "application/problem+json",
      });
    }

    if (summary === "FORBIDDEN") {
      const problem = createProblemDetails({
        status: 403,
        title: "Forbidden",
        detail: "You do not have permission to view this balance",
        code: "FORBIDDEN",
      });
      return c.json(problem, 403, {
        "Content-Type": "application/problem+json",
      });
    }

    return c.json(summary);
  });

  // 4. GET /leave/requests - List requests (filtered by scope)
  router.get("/leave/requests", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;
    const requestedEmployeeId = c.req.query("employeeId");
    const status = c.req.query("status");
    const yearStr = c.req.query("year");
    const year = yearStr ? parseInt(yearStr, 10) : undefined;

    const result = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        const currentEmp = await employeeRepo.findByUserId(tx, user.id);
        const isAdmin = user.role === "admin";
        const isManager = user.role === "manager";

        let filterEmployeeId: string | undefined = requestedEmployeeId;

        // Employees can only view their own requests
        if (!isAdmin && !isManager) {
          if (!currentEmp) return [];
          filterEmployeeId = currentEmp.id;
        } else if (isManager && !isAdmin && !requestedEmployeeId) {
          const allRequests = await leaveRepo.getLeaveRequests(tx, {
            status,
            year,
          });
          return allRequests.filter((r) => {
            if (currentEmp && r.employeeId === currentEmp.id) return true;
            return true;
          });
        }

        return leaveRepo.getLeaveRequests(tx, {
          employeeId: filterEmployeeId,
          status,
          year,
        });
      },
    );

    return c.json(
      result.map((r) => ({
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
      })),
    );
  });

  // 5. POST /leave/requests - Submit a leave request
  router.post("/leave/requests", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;
    const body = await c.req.json().catch(() => null);
    const parsed = CreateLeaveRequestSchema.safeParse(body);

    if (!parsed.success) {
      const problem = createProblemDetails({
        status: 400,
        title: "Bad Request",
        detail: parsed.error.errors.map((e) => e.message).join(", "),
        code: "VALIDATION_ERROR",
        errors: parsed.error.issues.map((i) => ({
          field: i.path.join("."),
          message: i.message,
        })),
      });
      return c.json(problem, 400, {
        "Content-Type": "application/problem+json",
      });
    }

    const reqData = parsed.data;

    const result = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        let employeeId = reqData.employeeId;
        const currentEmp = await employeeRepo.findByUserId(tx, user.id);

        if (!employeeId) {
          if (!currentEmp) {
            return { error: "NO_EMPLOYEE_PROFILE" as const };
          }
          employeeId = currentEmp.id;
        } else if (currentEmp && currentEmp.id !== employeeId) {
          // Submitting on behalf of another employee requires HR admin permission (LEA-010)
          const allowed = can(
            {
              userId: user.id,
              organizationId: user.organizationId,
              role: user.role,
            },
            "employee.write",
          );
          if (!allowed) {
            return { error: "FORBIDDEN" as const };
          }
        }

        const targetEmp = await employeeRepo.findById(tx, employeeId);
        if (!targetEmp) {
          return { error: "TARGET_EMPLOYEE_NOT_FOUND" as const };
        }

        // Fetch location holidays for working days computation
        const startYear = parseInt(reqData.startDate.slice(0, 4), 10);
        let holidaysSet = new Set<string>();
        if (targetEmp.locationId) {
          await holidayRepo.ensureCalendarForLocation(
            tx,
            targetEmp.locationId,
            startYear,
          );
          const holidays = await holidayRepo.getHolidaysForLocation(
            tx,
            targetEmp.locationId,
            startYear,
          );
          holidaysSet = new Set(holidays.map((h) => h.date));
        }

        // Calculate working days
        let workingDaysCalc;
        try {
          workingDaysCalc = calculateWorkingDays({
            startDate: reqData.startDate,
            endDate: reqData.endDate,
            halfDayStart: reqData.halfDayStart,
            halfDayEnd: reqData.halfDayEnd,
            holidays: holidaysSet,
          });
        } catch (err: unknown) {
          return {
            error: "INVALID_DATES" as const,
            message: err instanceof Error ? err.message : "Invalid dates",
          };
        }

        if (workingDaysCalc.totalWorkingDays <= 0) {
          return {
            error: "ZERO_DAYS" as const,
            message: "The requested period contains 0 working days",
          };
        }

        // Validate request against existing requests and ledger
        const ledgerRows = await leaveRepo.getLedgerEntries(tx, employeeId);
        const existingReqs = await leaveRepo.getLeaveRequests(tx, {
          employeeId,
        });

        const validation = validateLeaveRequest({
          proposal: {
            startDate: reqData.startDate,
            endDate: reqData.endDate,
            halfDayStart: reqData.halfDayStart,
            halfDayEnd: reqData.halfDayEnd,
          },
          ledgerEntries: ledgerRows.map((r) => ({
            id: r.id,
            employeeId: r.employeeId,
            entryType: r.entryType as
              | "accrual"
              | "usage"
              | "adjustment"
              | "carryover"
              | "expiry"
              | "reversal",
            amount: r.amount,
            unit: (r.unit as "days" | "hours") ?? "days",
            effectiveDate: r.effectiveDate,
            createdAt: r.createdAt.toISOString(),
          })),
          existingRequests: existingReqs.map((r) => ({
            id: r.id,
            startDate: r.startDate,
            endDate: r.endDate,
            status: r.status as
              "pending" | "approved" | "rejected" | "cancelled",
          })),
          holidays: holidaysSet,
          allowNegativeBalance: false,
        });

        if (!validation.valid) {
          return {
            error: validation.reason,
            message: validation.message,
          };
        }

        // Insert leave request
        const newReq = await leaveRepo.createLeaveRequest(tx, {
          employeeId,
          leaveTypeId: reqData.leaveTypeId,
          startDate: reqData.startDate,
          endDate: reqData.endDate,
          halfDayStart: reqData.halfDayStart,
          halfDayEnd: reqData.halfDayEnd,
          workingDays: workingDaysCalc.totalWorkingDays,
          notes: reqData.notes ?? null,
        });

        // Audit log
        await auditRepo.log(tx, {
          actorId: user.id,
          action: "leave.request.create",
          resourceType: "leave_request",
          resourceId: newReq.id,
          metadata: {
            employeeId,
            startDate: reqData.startDate,
            endDate: reqData.endDate,
            workingDays: workingDaysCalc.totalWorkingDays,
          },
        });

        // In-app notification to manager (if designated)
        if (targetEmp.managerId) {
          const managerEmp = await employeeRepo.findById(
            tx,
            targetEmp.managerId,
          );
          if (managerEmp?.userId) {
            await notificationRepo.create(tx, {
              userId: managerEmp.userId,
              title: "New Leave Request",
              body: `${targetEmp.firstName} ${targetEmp.lastName} requested ${workingDaysCalc.totalWorkingDays} day(s) off (${reqData.startDate} to ${reqData.endDate}).`,
              category: "leave_request",
              link: `/time-off`,
            });
          }
        }

        return { request: newReq, employee: targetEmp };
      },
    );

    if ("error" in result) {
      if (result.error === "FORBIDDEN") {
        const problem = createProblemDetails({
          status: 403,
          title: "Forbidden",
          detail: "Cannot request leave on behalf of another employee",
          code: "FORBIDDEN",
        });
        return c.json(problem, 403, {
          "Content-Type": "application/problem+json",
        });
      }
      if (result.error === "OVERLAPPING_REQUEST") {
        const problem = createProblemDetails({
          status: 409,
          title: "Conflict",
          detail: result.message,
          code: "OVERLAPPING_REQUEST",
        });
        return c.json(problem, 409, {
          "Content-Type": "application/problem+json",
        });
      }
      const problem = createProblemDetails({
        status: 400,
        title: "Validation Error",
        detail: "message" in result ? result.message : "Invalid leave request",
        code: result.error,
      });
      return c.json(problem, 400, {
        "Content-Type": "application/problem+json",
      });
    }

    const { request: newReq } = result;
    return c.json(
      {
        id: newReq.id,
        employeeId: newReq.employeeId,
        employeeName: newReq.employeeName ?? "",
        leaveTypeId: newReq.leaveTypeId,
        leaveTypeName: newReq.leaveTypeName ?? "",
        leaveTypeCode: newReq.leaveTypeCode ?? "",
        leaveTypeColor: newReq.leaveTypeColor ?? "#3b82f6",
        startDate: newReq.startDate,
        endDate: newReq.endDate,
        halfDayStart: newReq.halfDayStart,
        halfDayEnd: newReq.halfDayEnd,
        workingDays: newReq.workingDays,
        status: newReq.status,
        notes: newReq.notes,
        approverId: newReq.approverId,
        approverName: newReq.approverName,
        decidedAt: newReq.decidedAt ? newReq.decidedAt.toISOString() : null,
        decisionReason: newReq.decisionReason,
        createdAt: newReq.createdAt.toISOString(),
      },
      201,
    );
  });

  // 6. POST /leave/requests/:id/decide - Approve or Reject request
  router.post("/leave/requests/:id/decide", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;
    const requestId = c.req.param("id");
    const body = await c.req.json().catch(() => null);
    const parsed = DecideLeaveRequestSchema.safeParse(body);

    if (!parsed.success) {
      const problem = createProblemDetails({
        status: 400,
        title: "Bad Request",
        detail: parsed.error.errors.map((e) => e.message).join(", "),
        code: "VALIDATION_ERROR",
        errors: parsed.error.issues.map((i) => ({
          field: i.path.join("."),
          message: i.message,
        })),
      });
      return c.json(problem, 400, {
        "Content-Type": "application/problem+json",
      });
    }

    const result = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        const req = await leaveRepo.getLeaveRequestById(tx, requestId);
        if (!req) return { error: "NOT_FOUND" as const };

        const targetEmp = await employeeRepo.findById(tx, req.employeeId);
        if (!targetEmp) return { error: "NOT_FOUND" as const };

        // Permission check
        const allowed = can(
          {
            userId: user.id,
            organizationId: user.organizationId,
            role: user.role,
          },
          "leave.request.approve",
          {
            organizationId: user.organizationId,
            employeeId: targetEmp.id,
            managerId: targetEmp.managerId ?? undefined,
          },
        );

        if (!allowed) {
          return { error: "FORBIDDEN" as const };
        }

        const approverEmp = await employeeRepo.findByUserId(tx, user.id);
        const approverId = approverEmp ? approverEmp.id : req.employeeId;

        let updated;
        if (parsed.data.decision === "approve") {
          updated = await leaveRepo.approveLeaveRequest(
            tx,
            requestId,
            approverId,
          );
        } else {
          updated = await leaveRepo.rejectLeaveRequest(
            tx,
            requestId,
            approverId,
            parsed.data.reason,
          );
        }

        // Audit log
        await auditRepo.log(tx, {
          actorId: user.id,
          action: `leave.request.${parsed.data.decision}`,
          resourceType: "leave_request",
          resourceId: requestId,
          metadata: {
            decision: parsed.data.decision,
            reason: parsed.data.reason ?? null,
          },
        });

        // Notify employee
        if (targetEmp.userId) {
          await notificationRepo.create(tx, {
            userId: targetEmp.userId,
            title: `Leave Request ${parsed.data.decision === "approve" ? "Approved" : "Rejected"}`,
            body: `Your leave request for ${req.startDate} to ${req.endDate} has been ${parsed.data.decision}d.`,
            category: "leave_decision",
            link: `/time-off`,
          });
        }

        return { request: updated };
      },
    );

    if ("error" in result) {
      if (result.error === "NOT_FOUND") {
        const problem = createProblemDetails({
          status: 404,
          title: "Not Found",
          detail: "Leave request not found",
          code: "REQUEST_NOT_FOUND",
        });
        return c.json(problem, 404, {
          "Content-Type": "application/problem+json",
        });
      }
      const problem = createProblemDetails({
        status: 403,
        title: "Forbidden",
        detail: "You do not have permission to approve/reject this request",
        code: "FORBIDDEN",
      });
      return c.json(problem, 403, {
        "Content-Type": "application/problem+json",
      });
    }

    const { request: updated } = result;
    return c.json({
      id: updated.id,
      employeeId: updated.employeeId,
      employeeName: updated.employeeName ?? "",
      leaveTypeId: updated.leaveTypeId,
      leaveTypeName: updated.leaveTypeName ?? "",
      leaveTypeCode: updated.leaveTypeCode ?? "",
      leaveTypeColor: updated.leaveTypeColor ?? "#3b82f6",
      startDate: updated.startDate,
      endDate: updated.endDate,
      halfDayStart: updated.halfDayStart,
      halfDayEnd: updated.halfDayEnd,
      workingDays: updated.workingDays,
      status: updated.status,
      notes: updated.notes,
      approverId: updated.approverId,
      approverName: updated.approverName,
      decidedAt: updated.decidedAt ? updated.decidedAt.toISOString() : null,
      decisionReason: updated.decisionReason,
      createdAt: updated.createdAt.toISOString(),
    });
  });

  // 7. POST /leave/requests/:id/cancel - Cancel request (appends compensating reversal if approved)
  router.post("/leave/requests/:id/cancel", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;
    const requestId = c.req.param("id");

    const result = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        const req = await leaveRepo.getLeaveRequestById(tx, requestId);
        if (!req) return { error: "NOT_FOUND" as const };

        const currentEmp = await employeeRepo.findByUserId(tx, user.id);
        const isSelf = currentEmp && currentEmp.id === req.employeeId;
        const isAdmin = user.role === "admin";

        if (!isSelf && !isAdmin) {
          return { error: "FORBIDDEN" as const };
        }

        try {
          const cancelled = await leaveRepo.cancelLeaveRequest(
            tx,
            requestId,
            user.id,
          );

          await auditRepo.log(tx, {
            actorId: user.id,
            action: "leave.request.cancel",
            resourceType: "leave_request",
            resourceId: requestId,
            metadata: {
              previousStatus: req.status,
              reversalLedgerEntryId: cancelled.reversalLedgerEntryId,
            },
          });

          return { request: cancelled };
        } catch (err: unknown) {
          return {
            error: "INVALID_STATE" as const,
            message:
              err instanceof Error ? err.message : "Cannot cancel request",
          };
        }
      },
    );

    if ("error" in result) {
      if (result.error === "NOT_FOUND") {
        const problem = createProblemDetails({
          status: 404,
          title: "Not Found",
          detail: "Leave request not found",
          code: "REQUEST_NOT_FOUND",
        });
        return c.json(problem, 404, {
          "Content-Type": "application/problem+json",
        });
      }
      if (result.error === "FORBIDDEN") {
        const problem = createProblemDetails({
          status: 403,
          title: "Forbidden",
          detail: "You do not have permission to cancel this request",
          code: "FORBIDDEN",
        });
        return c.json(problem, 403, {
          "Content-Type": "application/problem+json",
        });
      }
      const problem = createProblemDetails({
        status: 400,
        title: "Bad Request",
        detail: result.message,
        code: "INVALID_REQUEST_STATE",
      });
      return c.json(problem, 400, {
        "Content-Type": "application/problem+json",
      });
    }

    const { request: cancelled } = result;
    return c.json({
      id: cancelled.id,
      employeeId: cancelled.employeeId,
      employeeName: cancelled.employeeName ?? "",
      leaveTypeId: cancelled.leaveTypeId,
      leaveTypeName: cancelled.leaveTypeName ?? "",
      leaveTypeCode: cancelled.leaveTypeCode ?? "",
      leaveTypeColor: cancelled.leaveTypeColor ?? "#3b82f6",
      startDate: cancelled.startDate,
      endDate: cancelled.endDate,
      halfDayStart: cancelled.halfDayStart,
      halfDayEnd: cancelled.halfDayEnd,
      workingDays: cancelled.workingDays,
      status: cancelled.status,
      notes: cancelled.notes,
      approverId: cancelled.approverId,
      approverName: cancelled.approverName,
      decidedAt: cancelled.decidedAt ? cancelled.decidedAt.toISOString() : null,
      decisionReason: cancelled.decisionReason,
      createdAt: cancelled.createdAt.toISOString(),
    });
  });

  // 8. POST /leave/adjust - Direct HR balance adjustment (LEA-010)
  router.post("/leave/adjust", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;

    const allowed = can(
      {
        userId: user.id,
        organizationId: user.organizationId,
        role: user.role,
      },
      "employee.write",
    );

    if (!allowed) {
      const problem = createProblemDetails({
        status: 403,
        title: "Forbidden",
        detail: "Only HR administrators can adjust leave balances",
        code: "FORBIDDEN",
      });
      return c.json(problem, 403, {
        "Content-Type": "application/problem+json",
      });
    }

    const body = await c.req.json().catch(() => null);
    const parsed = AdjustBalanceRequestSchema.safeParse(body);

    if (!parsed.success) {
      const problem = createProblemDetails({
        status: 400,
        title: "Bad Request",
        detail: parsed.error.errors.map((e) => e.message).join(", "),
        code: "VALIDATION_ERROR",
        errors: parsed.error.issues.map((i) => ({
          field: i.path.join("."),
          message: i.message,
        })),
      });
      return c.json(problem, 400, {
        "Content-Type": "application/problem+json",
      });
    }

    const entry = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        const emp = await employeeRepo.findById(tx, parsed.data.employeeId);
        if (!emp) return null;

        const ledger = await leaveRepo.appendLedgerEntry(tx, {
          employeeId: parsed.data.employeeId,
          entryType: "adjustment",
          amount: parsed.data.amount,
          unit: "days",
          note: parsed.data.note,
          effectiveDate: parsed.data.effectiveDate,
        });

        await auditRepo.log(tx, {
          actorId: user.id,
          action: "leave.balance.adjust",
          resourceType: "leave_ledger",
          resourceId: ledger.id,
          metadata: {
            employeeId: parsed.data.employeeId,
            amount: parsed.data.amount,
            note: parsed.data.note,
          },
        });

        return ledger;
      },
    );

    if (!entry) {
      const problem = createProblemDetails({
        status: 404,
        title: "Not Found",
        detail: "Employee not found",
        code: "EMPLOYEE_NOT_FOUND",
      });
      return c.json(problem, 404, {
        "Content-Type": "application/problem+json",
      });
    }

    return c.json(
      {
        id: entry.id,
        employeeId: entry.employeeId,
        entryType: entry.entryType,
        amount: entry.amount,
        unit: entry.unit,
        sourceRef: entry.sourceRef,
        note: entry.note,
        effectiveDate: entry.effectiveDate,
        createdAt: entry.createdAt.toISOString(),
      },
      201,
    );
  });

  return router;
}
