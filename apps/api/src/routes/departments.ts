import { Hono } from "hono";
import type { Sql } from "postgres";
import { z } from "zod";
import {
  type AuthUser,
  createProblemDetails,
  CreateDepartmentRequestSchema,
  DepartmentCoverageSchema,
} from "@librehr/contracts";
import { withTenant, DepartmentRepository, AuditRepository } from "@librehr/db";
import { requireAuth } from "../middleware/auth.js";
import { can } from "../policies/can.js";

export function createDepartmentRoutes(sql: Sql) {
  const router = new Hono();
  const departmentRepo = new DepartmentRepository();
  const auditRepo = new AuditRepository();

  router.get("/org/departments", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;

    const list = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        return departmentRepo.findMany(tx);
      },
    );

    return c.json(list);
  });

  router.post("/org/departments", requireAuth, async (c) => {
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
        detail: "You do not have permission to create departments",
        code: "FORBIDDEN",
      });
      return c.json(problem, 403, {
        "Content-Type": "application/problem+json",
      });
    }

    const body = await c.req.json();
    const parse = CreateDepartmentRequestSchema.safeParse(body);
    if (!parse.success) {
      const problem = createProblemDetails({
        status: 400,
        title: "Validation Failed",
        detail: parse.error.issues.map((e) => e.message).join(", "),
        code: "VALIDATION_FAILED",
      });
      return c.json(problem, 400, {
        "Content-Type": "application/problem+json",
      });
    }

    const created = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        return departmentRepo.create(tx, parse.data);
      },
    );

    return c.json(created, 201);
  });

  router.put("/org/departments/:id/coverage", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;
    if (
      !can(
        {
          userId: user.id,
          organizationId: user.organizationId,
          role: user.role,
        },
        "org.write",
      )
    ) {
      return c.json(
        createProblemDetails({
          status: 403,
          title: "Forbidden",
          detail: "Permission denied",
          code: "FORBIDDEN",
        }),
        403,
        { "Content-Type": "application/problem+json" },
      );
    }
    const id = z.guid().safeParse(c.req.param("id"));
    const body = DepartmentCoverageSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!id.success || !body.success) {
      return c.json(
        createProblemDetails({
          status: 400,
          title: "Validation failed",
          detail: "Invalid department coverage",
          code: "VALIDATION_FAILED",
        }),
        400,
        { "Content-Type": "application/problem+json" },
      );
    }
    const updated = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        const result = await departmentRepo.setCoverage(
          tx,
          id.data,
          body.data.minPresencePercent,
        );
        if (result)
          await auditRepo.log(tx, {
            actorId: user.id,
            action: "department.coverage.update",
            resourceType: "department",
            resourceId: id.data,
            metadata: { minPresencePercent: body.data.minPresencePercent },
          });
        return result;
      },
    );
    if (!updated)
      return c.json(
        createProblemDetails({
          status: 404,
          title: "Not found",
          detail: "Department not found",
          code: "NOT_FOUND",
        }),
        404,
        { "Content-Type": "application/problem+json" },
      );
    return c.json(body.data);
  });

  return router;
}
