import { Hono } from "hono";
import type { Sql } from "postgres";
import {
  type AuthUser,
  createProblemDetails,
  CreateLocationRequestSchema,
} from "@openhr/contracts";
import { withTenant, LocationRepository } from "@openhr/db";
import { requireAuth } from "../middleware/auth.js";
import { can } from "../policies/can.js";

export function createLocationRoutes(sql: Sql) {
  const router = new Hono();
  const locationRepo = new LocationRepository();

  router.get("/org/locations", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;

    const list = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        return locationRepo.findMany(tx);
      },
    );

    return c.json(list);
  });

  router.post("/org/locations", requireAuth, async (c) => {
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
        detail: "You do not have permission to create locations",
        code: "FORBIDDEN",
      });
      return c.json(problem, 403, {
        "Content-Type": "application/problem+json",
      });
    }

    const body = await c.req.json();
    const parse = CreateLocationRequestSchema.safeParse(body);
    if (!parse.success) {
      const problem = createProblemDetails({
        status: 400,
        title: "Validation Failed",
        detail: parse.error.errors.map((e) => e.message).join(", "),
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
        return locationRepo.create(tx, parse.data);
      },
    );

    return c.json(created, 201);
  });

  return router;
}
