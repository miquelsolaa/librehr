import { Hono } from "hono";
import type { Sql } from "postgres";
import {
  type AuthUser,
  createProblemDetails,
  CreateShiftTemplateRequestSchema,
  CreateShiftPatternRequestSchema,
  AssignShiftsRequestSchema,
  GenerateRosterRequestSchema,
  CreateShiftSwapRequestSchema,
  DecideShiftSwapRequestSchema,
} from "@librehr/contracts";
import {
  addDays,
  generateRotationalRoster,
  type RotationalPattern,
  type ShiftDefinition,
} from "@librehr/core";
import { withTenant, ShiftRepository, EmployeeRepository } from "@librehr/db";
import { NotFoundError, ValidationError } from "../errors/index.js";
import { businessToday } from "../lib/business-date.js";
import { IdParamSchema, parseJsonBody, parseParams } from "../lib/validate.js";
import { requireAuth } from "../middleware/auth.js";
import {
  inEmployeeFilter,
  requireEmployeesInScope,
  resolvePolicyContext,
  scopedEmployeeFilter,
} from "../policies/context.js";

/**
 * Rostering changes someone's working time, so it follows the time-record
 * correction scope: managers for their direct reports, admin/HR for the
 * organization.
 */
const ROSTER_PERMISSION = "time.record.correct" as const;

export function createShiftRoutes(sql: Sql) {
  const router = new Hono();
  const shiftRepo = new ShiftRepository();
  const employeeRepo = new EmployeeRepository();

  // 1. GET /shifts/templates - List shift templates
  router.get("/shifts/templates", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;
    const templates = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => shiftRepo.getShiftTemplates(tx),
    );
    return c.json(templates);
  });

  // 2. POST /shifts/templates - Create shift template (admin only)
  router.post("/shifts/templates", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;
    if (user.role !== "admin") {
      const problem = createProblemDetails({
        status: 403,
        title: "Forbidden",
        detail: "Only administrators can create shift templates",
        code: "FORBIDDEN",
      });
      return c.json(problem, 403, {
        "Content-Type": "application/problem+json",
      });
    }

    const data = await parseJsonBody(c, CreateShiftTemplateRequestSchema);

    const template = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => shiftRepo.createShiftTemplate(tx, data),
    );
    return c.json(template, 201);
  });

  // 3. GET /shifts/patterns - List rotational patterns with steps
  router.get("/shifts/patterns", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;
    const patterns = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        const list = await shiftRepo.getShiftPatterns(tx);
        const detailed = [];
        for (const p of list) {
          const steps = await shiftRepo.getShiftPatternSteps(tx, p.id);
          detailed.push({ ...p, steps });
        }
        return detailed;
      },
    );
    return c.json(patterns);
  });

  // 4. POST /shifts/patterns - Create rotational pattern (admin only)
  router.post("/shifts/patterns", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;
    if (user.role !== "admin") {
      const problem = createProblemDetails({
        status: 403,
        title: "Forbidden",
        detail: "Only administrators can create shift patterns",
        code: "FORBIDDEN",
      });
      return c.json(problem, 403, {
        "Content-Type": "application/problem+json",
      });
    }

    const data = await parseJsonBody(c, CreateShiftPatternRequestSchema);

    const pattern = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) =>
        shiftRepo.createShiftPattern(tx, {
          name: data.name,
          cycleDays: data.cycleDays,
          description: data.description,
          steps: data.steps.map((s) => ({
            stepOrder: s.stepOrder,
            shiftTemplateId: s.shiftTemplateId ?? null,
            isRest: s.isRest,
          })),
        }),
    );
    return c.json(pattern, 201);
  });

  // 5. GET /shifts/assignments - Get shift roster
  router.get("/shifts/assignments", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;
    const employeeId = c.req.query("employeeId");

    const assignments = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        const startDate =
          c.req.query("startDate") ?? (await businessToday(c, tx));
        const endDate = c.req.query("endDate") ?? addDays(startDate, 30);
        // Employees see their own roster, managers theirs and their reports'.
        const filter = scopedEmployeeFilter(
          await resolvePolicyContext(c, tx),
          "time.record.read",
          employeeId,
        );
        const rows = await shiftRepo.getShiftAssignments(tx, {
          startDate,
          endDate,
          employeeId: filter.employeeId,
        });
        return rows.filter((r) => inEmployeeFilter(filter, r.employeeId));
      },
    );
    return c.json(assignments);
  });

  // 6. POST /shifts/assignments - Assign shifts manually
  router.post("/shifts/assignments", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;
    if (user.role !== "admin" && user.role !== "manager") {
      const problem = createProblemDetails({
        status: 403,
        title: "Forbidden",
        detail: "Only managers and administrators can assign shifts",
        code: "FORBIDDEN",
      });
      return c.json(problem, 403, {
        "Content-Type": "application/problem+json",
      });
    }

    const data = await parseJsonBody(c, AssignShiftsRequestSchema);

    await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        await requireEmployeesInScope(
          await resolvePolicyContext(c, tx),
          ROSTER_PERMISSION,
          data.assignments.map((a) => a.employeeId),
          (id) => employeeRepo.findById(tx, id),
        );
        return shiftRepo.assignShifts(
          tx,
          data.assignments.map((a) => ({
            employeeId: a.employeeId,
            date: a.date,
            shiftTemplateId: a.shiftTemplateId ?? null,
            status: a.status ?? "scheduled",
            notes: a.notes ?? undefined,
          })),
        );
      },
    );
    return c.json({ success: true, count: data.assignments.length });
  });

  // 7. POST /shifts/generate-roster - Generate continuous rotational cycle roster (TIM-004, TIM-005)
  router.post("/shifts/generate-roster", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;
    if (user.role !== "admin" && user.role !== "manager") {
      const problem = createProblemDetails({
        status: 403,
        title: "Forbidden",
        detail: "Only managers and administrators can generate shift rosters",
        code: "FORBIDDEN",
      });
      return c.json(problem, 403, {
        "Content-Type": "application/problem+json",
      });
    }

    const data = await parseJsonBody(c, GenerateRosterRequestSchema);

    const { patternId, anchorDate, startDate, endDate, employeeIds } = data;

    const result = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        await requireEmployeesInScope(
          await resolvePolicyContext(c, tx),
          ROSTER_PERMISSION,
          employeeIds,
          (id) => employeeRepo.findById(tx, id),
        );

        // Fetch pattern and its steps
        const patterns = await shiftRepo.getShiftPatterns(tx);
        const patternRow = patterns.find((p) => p.id === patternId);
        if (!patternRow) {
          throw new NotFoundError({
            detail: "Shift pattern not found",
            code: "PATTERN_NOT_FOUND",
          });
        }

        const steps = await shiftRepo.getShiftPatternSteps(tx, patternId);
        const templates = await shiftRepo.getShiftTemplates(tx);

        const templateMap: Record<string, ShiftDefinition> = {};
        for (const t of templates) {
          templateMap[t.code] = {
            id: t.id,
            name: t.name,
            code: t.code,
            type: t.type as ShiftDefinition["type"],
            startTime: t.startTime,
            endTime: t.endTime,
            color: t.color,
            breakMinutes: t.breakMinutes,
          };
        }

        const pattern: RotationalPattern = {
          id: patternRow.id,
          name: patternRow.name,
          cycleDays: patternRow.cycleDays,
          steps: steps.map((s) => ({
            stepOrder: s.stepOrder,
            shiftCode: s.shiftCode ?? "OFF",
            isRest: s.isRest,
          })),
        };

        const generatedDays = generateRotationalRoster({
          pattern,
          anchorDate,
          startDate,
          endDate,
          shiftDefinitions: templateMap,
        });

        // Batch assignments for all targeted employees
        const assignmentsToSave: Array<{
          employeeId: string;
          date: string;
          shiftTemplateId: string | null;
          status: string;
        }> = [];

        for (const empId of employeeIds) {
          for (const item of generatedDays) {
            assignmentsToSave.push({
              employeeId: empId,
              date: item.date,
              shiftTemplateId: item.shift ? item.shift.id : null,
              status: "scheduled",
            });
          }
        }

        await shiftRepo.assignShifts(tx, assignmentsToSave);
        return {
          count: assignmentsToSave.length,
          daysGenerated: generatedDays.length,
        };
      },
    );

    return c.json(result, 201);
  });

  // 8. GET /shifts/swaps - List shift swap requests
  router.get("/shifts/swaps", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;
    const status = c.req.query("status");
    const swaps = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        // A swap is visible when either side is within the caller's scope.
        const filter = scopedEmployeeFilter(
          await resolvePolicyContext(c, tx),
          "time.record.read",
        );
        const filterObj: {
          status?: string | undefined;
          employeeId?: string | undefined;
        } = {};
        if (status) filterObj.status = status;
        if (filter.employeeId) filterObj.employeeId = filter.employeeId;

        const rows = await shiftRepo.getShiftSwaps(tx, filterObj);
        return rows.filter(
          (s) =>
            inEmployeeFilter(filter, s.requesterId) ||
            inEmployeeFilter(filter, s.targetEmployeeId),
        );
      },
    );
    return c.json(swaps);
  });

  // 9. POST /shifts/swaps - Request shift swap (employee)
  router.post("/shifts/swaps", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;
    const data = await parseJsonBody(c, CreateShiftSwapRequestSchema);

    const swap = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        const currentEmp = await employeeRepo.findByUserId(tx, user.id);
        if (!currentEmp) {
          throw new ValidationError({
            detail: "User is not linked to an employee profile",
            code: "NO_EMPLOYEE_PROFILE",
          });
        }
        if (!(await employeeRepo.findById(tx, data.targetEmployeeId))) {
          throw new NotFoundError({ detail: "Employee not found" });
        }

        return shiftRepo.createShiftSwap(tx, {
          requesterId: currentEmp.id,
          targetEmployeeId: data.targetEmployeeId,
          requesterDate: data.requesterDate,
          targetDate: data.targetDate,
          reason: data.reason,
        });
      },
    );

    return c.json(swap, 201);
  });

  // 10. PATCH /shifts/swaps/:id - Decide shift swap (manager or admin)
  router.patch("/shifts/swaps/:id", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;
    if (user.role !== "admin" && user.role !== "manager") {
      const problem = createProblemDetails({
        status: 403,
        title: "Forbidden",
        detail: "Only managers and administrators can decide shift swaps",
        code: "FORBIDDEN",
      });
      return c.json(problem, 403, {
        "Content-Type": "application/problem+json",
      });
    }

    const { id } = parseParams(c, IdParamSchema, {
      detail: "Shift swap request not found",
      code: "SWAP_NOT_FOUND",
    });
    const data = await parseJsonBody(c, DecideShiftSwapRequestSchema);

    const updated = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        const swap = await shiftRepo.findShiftSwapById(tx, id);
        if (!swap) return null;
        // Both rosters change, so both employees must be the decider's
        // reports (and a manager cannot decide their own swap).
        const ctx = await resolvePolicyContext(c, tx);
        await requireEmployeesInScope(
          ctx,
          ROSTER_PERMISSION,
          [swap.requesterId, swap.targetEmployeeId],
          (empId) => employeeRepo.findById(tx, empId),
        );
        return shiftRepo.decideShiftSwap(tx, id, {
          status: data.status,
          approverId: ctx.employeeId ?? user.id,
        });
      },
    );

    if (!updated) {
      const problem = createProblemDetails({
        status: 404,
        title: "Not Found",
        detail: "Shift swap request not found",
        code: "SWAP_NOT_FOUND",
      });
      return c.json(problem, 404, {
        "Content-Type": "application/problem+json",
      });
    }

    return c.json(updated);
  });

  return router;
}
