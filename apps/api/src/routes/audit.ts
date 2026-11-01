import { Hono } from "hono";
import type { Sql } from "postgres";
import { type AuthUser, createProblemDetails } from "@openhr/contracts";
import { withTenant, AuditRepository } from "@openhr/db";
import { requireAuth } from "../middleware/auth.js";
import { can } from "../policies/can.js";

export function createAuditRoutes(sql: Sql) {
  const router = new Hono();
  const auditRepo = new AuditRepository();

  router.get("/audit", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;

    const allowed = can(
      {
        userId: user.id,
        organizationId: user.organizationId,
        role: user.role,
      },
      "audit.read",
    );

    if (!allowed) {
      const problem = createProblemDetails({
        status: 403,
        title: "Forbidden",
        detail: "You do not have permission to view the audit log",
        code: "FORBIDDEN",
      });
      return c.json(problem, 403, {
        "Content-Type": "application/problem+json",
      });
    }

    const query = c.req.query();
    const filters = {
      resourceType: query["resourceType"] || undefined,
      resourceId: query["resourceId"] || undefined,
      actorId: query["actorId"] || undefined,
      limit: query["limit"] ? parseInt(query["limit"], 10) : undefined,
    };

    const logs = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        return auditRepo.list(tx, filters);
      },
    );

    return c.json(logs);
  });

  return router;
}
