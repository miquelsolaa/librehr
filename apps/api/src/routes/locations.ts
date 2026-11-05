import { Hono } from "hono";
import type { Sql } from "postgres";
import {
  type AuthUser,
  createProblemDetails,
  CreateLocationRequestSchema,
  CreateLegalEntityRequestSchema,
} from "@librehr/contracts";
import { withTenant, LocationRepository, AuditRepository } from "@librehr/db";
import { requireAuth } from "../middleware/auth.js";
import { can } from "../policies/can.js";

export function createLocationRoutes(sql: Sql) {
  const router = new Hono();
  const locationRepo = new LocationRepository();
  const auditRepo = new AuditRepository();

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

  router.get("/org/legal-entities", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;
    if (
      !can(
        {
          userId: user.id,
          organizationId: user.organizationId,
          role: user.role,
        },
        "org.read",
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
    const entities = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      (tx) => locationRepo.findLegalEntities(tx),
    );
    return c.json(entities.map(({ id, name }) => ({ id, name })));
  });

  router.post("/org/legal-entities", requireAuth, async (c) => {
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
    const parsed = CreateLegalEntityRequestSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!parsed.success) {
      return c.json(
        createProblemDetails({
          status: 400,
          title: "Validation failed",
          detail: "Invalid legal entity details",
          code: "VALIDATION_FAILED",
        }),
        400,
        { "Content-Type": "application/problem+json" },
      );
    }
    const entity = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        const created = await locationRepo.createLegalEntity(tx, {
          name: parsed.data.name,
          taxId: parsed.data.cif,
          country: parsed.data.country,
        });
        await auditRepo.log(tx, {
          actorId: user.id,
          action: "legal_entity.create",
          resourceType: "legal_entity",
          resourceId: created.id,
        });
        return created;
      },
    );
    return c.json({ id: entity.id, name: entity.name }, 201);
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
        const entities = await locationRepo.findLegalEntities(tx);
        if (!entities.some((entity) => entity.id === parse.data.legalEntityId))
          return null;
        const location = await locationRepo.create(tx, parse.data);
        await auditRepo.log(tx, {
          actorId: user.id,
          action: "location.create",
          resourceType: "location",
          resourceId: location.id,
        });
        return location;
      },
    );

    if (!created) {
      return c.json(
        createProblemDetails({
          status: 404,
          title: "Not found",
          detail: "Legal entity not found",
          code: "NOT_FOUND",
        }),
        404,
        { "Content-Type": "application/problem+json" },
      );
    }
    return c.json(created, 201);
  });

  return router;
}
