import { Hono } from "hono";
import type { Sql } from "postgres";
import {
  type AuthUser,
  createProblemDetails,
  CreateTimeCorrectionSchema,
  DecideTimeCorrectionSchema,
} from "@librehr/contracts";
import { computeEventHash } from "@librehr/core";
import {
  withTenant,
  TimeCorrectionRepository,
  TimeRepository,
  EmployeeRepository,
  AuditRepository,
  NotificationRepository,
} from "@librehr/db";
import { requireAuth } from "../middleware/auth.js";
import { can } from "../policies/can.js";

export function createTimeCorrectionRoutes(sql: Sql) {
  const router = new Hono();
  const correctionRepo = new TimeCorrectionRepository();
  const timeRepo = new TimeRepository();
  const employeeRepo = new EmployeeRepository();
  const auditRepo = new AuditRepository();
  const notificationRepo = new NotificationRepository();

  // 1. GET /time/corrections - List proposed corrections
  router.get("/time/corrections", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;
    const requestedEmpId = c.req.query("employeeId");
    const status = c.req.query("status");

    const items = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        const isAdmin = user.role === "admin";
        const isManager = user.role === "manager";
        const currentEmp = await employeeRepo.findByUserId(tx, user.id);

        let filterEmpId = requestedEmpId;
        if (!isAdmin && !isManager) {
          if (!currentEmp) return [];
          filterEmpId = currentEmp.id;
        }

        return correctionRepo.list(tx, {
          employeeId: filterEmpId,
          status,
        });
      },
    );

    return c.json(
      items.map((i) => ({
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
      })),
    );
  });

  // 2. POST /time/corrections - Submit a forgotten clocking correction
  router.post("/time/corrections", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;
    const body = await c.req.json().catch(() => null);
    const parsed = CreateTimeCorrectionSchema.safeParse(body);

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
        const emp = await employeeRepo.findByUserId(tx, user.id);
        if (!emp) return null;

        const corr = await correctionRepo.create(tx, {
          employeeId: emp.id,
          refEventId: parsed.data.refEventId,
          proposedEventType: parsed.data.proposedEventType,
          proposedOccurredAt: new Date(parsed.data.proposedOccurredAt),
          reason: parsed.data.reason,
        });

        // Notify manager if assigned
        if (emp.managerId) {
          const mgr = await employeeRepo.findById(tx, emp.managerId);
          if (mgr?.userId) {
            await notificationRepo.create(tx, {
              userId: mgr.userId,
              title: "Timesheet Correction Request",
              body: `${emp.firstName} ${emp.lastName} requested a timesheet correction (${parsed.data.proposedEventType}).`,
              category: "time_correction",
              link: "/time/corrections",
            });
          }
        }

        return corr;
      },
    );

    if (!created) {
      const problem = createProblemDetails({
        status: 404,
        title: "Not Found",
        detail: "Employee profile required",
        code: "EMPLOYEE_NOT_FOUND",
      });
      return c.json(problem, 404, {
        "Content-Type": "application/problem+json",
      });
    }

    return c.json(
      {
        id: created.id,
        employeeId: created.employeeId,
        refEventId: created.refEventId,
        proposedEventType: created.proposedEventType,
        proposedOccurredAt: created.proposedOccurredAt.toISOString(),
        reason: created.reason,
        status: created.status,
        approverId: created.approverId,
        decidedAt: null,
        decisionReason: null,
        createdEventId: null,
        createdAt: created.createdAt.toISOString(),
      },
      201,
    );
  });

  // 3. POST /time/corrections/:id/decide - Approve or Reject correction
  router.post("/time/corrections/:id/decide", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;
    const correctionId = c.req.param("id");
    const body = await c.req.json().catch(() => null);
    const parsed = DecideTimeCorrectionSchema.safeParse(body);

    if (!parsed.success) {
      const problem = createProblemDetails({
        status: 400,
        title: "Bad Request",
        detail: parsed.error.errors.map((e) => e.message).join(", "),
        code: "VALIDATION_ERROR",
      });
      return c.json(problem, 400, {
        "Content-Type": "application/problem+json",
      });
    }

    const result = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        const corr = await correctionRepo.findById(tx, correctionId);
        if (!corr) return { error: "NOT_FOUND" as const };

        const targetEmp = await employeeRepo.findById(tx, corr.employeeId);
        if (!targetEmp) return { error: "NOT_FOUND" as const };

        const allowed = can(
          {
            userId: user.id,
            organizationId: user.organizationId,
            role: user.role,
          },
          "time.record.correct",
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
        const approverId = approverEmp ? approverEmp.id : user.id;

        let createdEventId: string | null = null;

        if (parsed.data.decision === "approve") {
          const latest = await timeRepo.getLatestEvent(tx, corr.employeeId);
          const prevHash = latest?.hash ?? null;

          const hash = computeEventHash(prevHash, {
            organizationId: user.organizationId,
            employeeId: corr.employeeId,
            eventType: corr.proposedEventType,
            occurredAt: corr.proposedOccurredAt.toISOString(),
            recordedAt: new Date().toISOString(),
            source: "manual",
            actorId: user.id,
            refEventId: corr.refEventId ?? undefined,
            reason: `Approved correction: ${corr.reason}`,
          });

          const createdEv = await timeRepo.appendEvent(tx, {
            employeeId: corr.employeeId,
            eventType: corr.proposedEventType as
              | "clock_in"
              | "clock_out"
              | "break_start"
              | "break_end"
              | "correction",
            occurredAt: corr.proposedOccurredAt,
            source: "manual",
            actorId: user.id,
            refEventId: corr.refEventId,
            reason: `Approved correction: ${corr.reason}`,
            prevHash,
            hash,
          });

          createdEventId = createdEv.id;
        }

        const updated = await correctionRepo.updateDecision(tx, correctionId, {
          status: parsed.data.decision === "approve" ? "approved" : "rejected",
          approverId,
          decisionReason: parsed.data.reason,
          createdEventId,
        });

        await auditRepo.log(tx, {
          actorId: user.id,
          action: `time.correction.${parsed.data.decision}`,
          resourceType: "time_correction",
          resourceId: correctionId,
          metadata: {
            decision: parsed.data.decision,
            reason: parsed.data.reason ?? null,
            createdEventId,
          },
        });

        // Notify employee
        if (targetEmp.userId) {
          await notificationRepo.create(tx, {
            userId: targetEmp.userId,
            title: `Time Correction ${parsed.data.decision === "approve" ? "Approved" : "Rejected"}`,
            body: `Your timesheet correction request was ${parsed.data.decision}d.`,
            category: "time_decision",
            link: "/time",
          });
        }

        return { correction: updated };
      },
    );

    if ("error" in result) {
      if (result.error === "NOT_FOUND") {
        const problem = createProblemDetails({
          status: 404,
          title: "Not Found",
          detail: "Correction not found",
          code: "NOT_FOUND",
        });
        return c.json(problem, 404, {
          "Content-Type": "application/problem+json",
        });
      }
      const problem = createProblemDetails({
        status: 403,
        title: "Forbidden",
        detail: "You do not have permission to approve/reject this correction",
        code: "FORBIDDEN",
      });
      return c.json(problem, 403, {
        "Content-Type": "application/problem+json",
      });
    }

    const { correction: u } = result;
    return c.json({
      id: u.id,
      employeeId: u.employeeId,
      employeeName: u.employeeName,
      refEventId: u.refEventId,
      proposedEventType: u.proposedEventType,
      proposedOccurredAt: u.proposedOccurredAt.toISOString(),
      reason: u.reason,
      status: u.status,
      approverId: u.approverId,
      approverName: u.approverName,
      decidedAt: u.decidedAt ? u.decidedAt.toISOString() : null,
      decisionReason: u.decisionReason,
      createdEventId: u.createdEventId,
      createdAt: u.createdAt.toISOString(),
    });
  });

  return router;
}
