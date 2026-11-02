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
  generateRotationalRoster,
  type RotationalPattern,
  type ShiftDefinition,
} from "@librehr/core";
import { withTenant, ShiftRepository, EmployeeRepository } from "@librehr/db";
import { requireAuth } from "../middleware/auth.js";

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

    const body = await c.req.json();
    const parsed = CreateShiftTemplateRequestSchema.safeParse(body);
    if (!parsed.success) {
      const problem = createProblemDetails({
        status: 400,
        title: "Validation Error",
        detail:
          parsed.error.issues[0]?.message ?? "Invalid shift template data",
        code: "VALIDATION_ERROR",
      });
      return c.json(problem, 400, {
        "Content-Type": "application/problem+json",
      });
    }

    const template = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => shiftRepo.createShiftTemplate(tx, parsed.data),
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

    const body = await c.req.json();
    const parsed = CreateShiftPatternRequestSchema.safeParse(body);
    if (!parsed.success) {
      const problem = createProblemDetails({
        status: 400,
        title: "Validation Error",
        detail: parsed.error.issues[0]?.message ?? "Invalid shift pattern data",
        code: "VALIDATION_ERROR",
      });
      return c.json(problem, 400, {
        "Content-Type": "application/problem+json",
      });
    }

    const pattern = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) =>
        shiftRepo.createShiftPattern(tx, {
          name: parsed.data.name,
          cycleDays: parsed.data.cycleDays,
          description: parsed.data.description,
          steps: parsed.data.steps.map((s) => ({
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
    const startDate =
      c.req.query("startDate") ?? new Date().toISOString().slice(0, 10);
    const endDate =
      c.req.query("endDate") ??
      new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
    const employeeId = c.req.query("employeeId");

    const assignments = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        const currentEmp = await employeeRepo.findByUserId(tx, user.id);
        const empFilter =
          employeeId ??
          (user.role === "employee" && currentEmp ? currentEmp.id : undefined);
        return shiftRepo.getShiftAssignments(tx, {
          startDate,
          endDate,
          employeeId: empFilter,
        });
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

    const body = await c.req.json();
    const parsed = AssignShiftsRequestSchema.safeParse(body);
    if (!parsed.success) {
      const problem = createProblemDetails({
        status: 400,
        title: "Validation Error",
        detail: parsed.error.issues[0]?.message ?? "Invalid assignments data",
        code: "VALIDATION_ERROR",
      });
      return c.json(problem, 400, {
        "Content-Type": "application/problem+json",
      });
    }

    await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) =>
        shiftRepo.assignShifts(
          tx,
          parsed.data.assignments.map((a) => ({
            employeeId: a.employeeId,
            date: a.date,
            shiftTemplateId: a.shiftTemplateId ?? null,
            status: a.status ?? "scheduled",
            notes: a.notes ?? undefined,
          })),
        ),
    );
    return c.json({ success: true, count: parsed.data.assignments.length });
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

    const body = await c.req.json();
    const parsed = GenerateRosterRequestSchema.safeParse(body);
    if (!parsed.success) {
      const problem = createProblemDetails({
        status: 400,
        title: "Validation Error",
        detail:
          parsed.error.issues[0]?.message ?? "Invalid generation parameters",
        code: "VALIDATION_ERROR",
      });
      return c.json(problem, 400, {
        "Content-Type": "application/problem+json",
      });
    }

    const { patternId, anchorDate, startDate, endDate, employeeIds } =
      parsed.data;

    const result = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        // Fetch pattern and its steps
        const patterns = await shiftRepo.getShiftPatterns(tx);
        const patternRow = patterns.find((p) => p.id === patternId);
        if (!patternRow) {
          throw new Error("Pattern not found");
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
        const currentEmp = await employeeRepo.findByUserId(tx, user.id);
        const filterStatus = status ? status : undefined;
        const filterEmpId =
          user.role === "employee" && currentEmp ? currentEmp.id : undefined;

        const filterObj: {
          status?: string | undefined;
          employeeId?: string | undefined;
        } = {};
        if (filterStatus) filterObj.status = filterStatus;
        if (filterEmpId) filterObj.employeeId = filterEmpId;

        return shiftRepo.getShiftSwaps(tx, filterObj);
      },
    );
    return c.json(swaps);
  });

  // 9. POST /shifts/swaps - Request shift swap (employee)
  router.post("/shifts/swaps", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;
    const body = await c.req.json();
    const parsed = CreateShiftSwapRequestSchema.safeParse(body);
    if (!parsed.success) {
      const problem = createProblemDetails({
        status: 400,
        title: "Validation Error",
        detail: parsed.error.issues[0]?.message ?? "Invalid swap request",
        code: "VALIDATION_ERROR",
      });
      return c.json(problem, 400, {
        "Content-Type": "application/problem+json",
      });
    }

    const swap = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        const currentEmp = await employeeRepo.findByUserId(tx, user.id);
        if (!currentEmp) {
          throw new Error("NO_EMPLOYEE_PROFILE");
        }

        return shiftRepo.createShiftSwap(tx, {
          requesterId: currentEmp.id,
          targetEmployeeId: parsed.data.targetEmployeeId,
          requesterDate: parsed.data.requesterDate,
          targetDate: parsed.data.targetDate,
          reason: parsed.data.reason,
        });
      },
    ).catch((err: Error) => {
      if (err.message === "NO_EMPLOYEE_PROFILE") {
        return null;
      }
      throw err;
    });

    if (!swap) {
      const problem = createProblemDetails({
        status: 400,
        title: "Bad Request",
        detail: "User is not linked to an employee profile",
        code: "NO_EMPLOYEE_PROFILE",
      });
      return c.json(problem, 400, {
        "Content-Type": "application/problem+json",
      });
    }

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

    const id = c.req.param("id");
    const body = await c.req.json();
    const parsed = DecideShiftSwapRequestSchema.safeParse(body);
    if (!parsed.success) {
      const problem = createProblemDetails({
        status: 400,
        title: "Validation Error",
        detail: parsed.error.issues[0]?.message ?? "Invalid decision payload",
        code: "VALIDATION_ERROR",
      });
      return c.json(problem, 400, {
        "Content-Type": "application/problem+json",
      });
    }

    const updated = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        const currentEmp = await employeeRepo.findByUserId(tx, user.id);
        return shiftRepo.decideShiftSwap(tx, id, {
          status: parsed.data.status,
          approverId: currentEmp ? currentEmp.id : user.id,
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
