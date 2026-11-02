import { Hono } from "hono";
import type { Sql } from "postgres";
import { type AuthUser, createProblemDetails } from "@librehr/contracts";
import {
  withTenant,
  EmployeeRepository,
  DsrRepository,
  AuditRepository,
} from "@librehr/db";
import { requireAuth } from "../middleware/auth.js";

export function createDsrRoutes(sql: Sql) {
  const router = new Hono();
  const empRepo = new EmployeeRepository();
  const dsrRepo = new DsrRepository();
  const auditRepo = new AuditRepository();

  // GET /employees/:id/dsr-export - GDPR Art. 15/20 Machine-readable DSR Export (ADM-004)
  router.get("/employees/:id/dsr-export", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;
    const employeeId = c.req.param("id");

    const data = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        const currentEmp = await empRepo.findByUserId(tx, user.id);

        // Must be either an admin or the employee themselves requesting their own DSR dump
        if (
          user.role !== "admin" &&
          (!currentEmp || currentEmp.id !== employeeId)
        ) {
          return "FORBIDDEN";
        }

        const dump = await dsrRepo.exportEmployeeData(tx, employeeId);
        if (dump) {
          await auditRepo.log(tx, {
            actorId: user.id,
            action: "employee.dsr_export",
            resourceType: "employee",
            resourceId: employeeId,
          });
        }
        return dump;
      },
    );

    if (data === "FORBIDDEN") {
      return c.json(
        createProblemDetails({
          status: 403,
          title: "Forbidden",
          detail: "Cannot access other employee's DSR export",
          code: "FORBIDDEN",
        }),
        403,
        { "Content-Type": "application/problem+json" },
      );
    }

    if (!data) {
      return c.json(
        createProblemDetails({
          status: 404,
          title: "Not Found",
          detail: "Employee not found",
          code: "NOT_FOUND",
        }),
        404,
        { "Content-Type": "application/problem+json" },
      );
    }

    return c.json(data);
  });

  return router;
}
