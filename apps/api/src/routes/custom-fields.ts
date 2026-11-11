import { Hono } from "hono";
import type { Sql } from "postgres";
import {
  type AuthUser,
  createProblemDetails,
  CreateCustomFieldDefinitionSchema,
  SetCustomFieldValueSchema,
} from "@librehr/contracts";
import {
  withTenant,
  CustomFieldRepository,
  AuditRepository,
  EmployeeRepository,
} from "@librehr/db";
import { ForbiddenError, NotFoundError } from "../errors/index.js";
import { IdParamSchema, parseJsonBody, parseParams } from "../lib/validate.js";
import { requireAuth } from "../middleware/auth.js";
import { resolvePolicyContext } from "../policies/context.js";
import {
  canSeeCustomField,
  canWriteCustomFields,
  customFieldViewer,
} from "../policies/custom-fields.js";

export function createCustomFieldRoutes(sql: Sql) {
  const router = new Hono();
  const cfRepo = new CustomFieldRepository();
  const employeeRepo = new EmployeeRepository();
  const auditRepo = new AuditRepository();

  // List custom field definitions
  router.get("/custom-fields", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;

    const defs = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        return cfRepo.findDefinitions(tx);
      },
    );

    return c.json(defs);
  });

  // Create custom field definition (Admin / HR)
  router.post("/custom-fields", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;
    if (user.role !== "admin" && user.role !== "hr") {
      const problem = createProblemDetails({
        status: 403,
        title: "Forbidden",
        detail: "Only administrators and HR can manage custom fields",
        code: "FORBIDDEN",
      });
      return c.json(problem, 403, {
        "Content-Type": "application/problem+json",
      });
    }

    const body = await c.req.json();
    const parse = CreateCustomFieldDefinitionSchema.safeParse(body);
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

    const def = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        const created = await cfRepo.createDefinition(tx, parse.data);

        await auditRepo.log(tx, {
          actorId: user.id,
          action: "custom_field.created",
          resourceType: "custom_field_definition",
          resourceId: created.id,
          metadata: { name: created.name, code: created.code },
        });

        return created;
      },
    );

    return c.json(def, 201);
  });

  // Delete custom field definition (Admin / HR)
  router.delete("/custom-fields/:id", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;
    if (user.role !== "admin" && user.role !== "hr") {
      const problem = createProblemDetails({
        status: 403,
        title: "Forbidden",
        detail: "Only administrators and HR can manage custom fields",
        code: "FORBIDDEN",
      });
      return c.json(problem, 403, {
        "Content-Type": "application/problem+json",
      });
    }

    const id = c.req.param("id");

    await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        await cfRepo.deleteDefinition(tx, id);

        await auditRepo.log(tx, {
          actorId: user.id,
          action: "custom_field.deleted",
          resourceType: "custom_field_definition",
          resourceId: id,
        });
      },
    );

    return c.json({ success: true });
  });

  // Get custom field values for employee
  router.get("/people/:id/custom-fields", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;
    const { id: employeeId } = parseParams(c, IdParamSchema, {
      detail: "Employee not found",
    });

    const values = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        const employee = await employeeRepo.findById(tx, employeeId);
        if (!employee)
          throw new NotFoundError({ detail: "Employee not found" });
        const viewer = customFieldViewer(
          await resolvePolicyContext(c, tx),
          employee,
        );
        if (!viewer) {
          throw new ForbiddenError({
            detail: "This employee is outside your access scope",
          });
        }
        const all = await cfRepo.findValuesByEmployee(tx, employeeId);
        // ORG-005: each definition's visibility rule decides per field.
        return all.filter((v) => canSeeCustomField(viewer, v.visibility));
      },
    );

    return c.json(values);
  });

  // Set custom field value for employee
  router.post("/people/:id/custom-fields", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;
    const { id: employeeId } = parseParams(c, IdParamSchema, {
      detail: "Employee not found",
    });
    const data = await parseJsonBody(c, SetCustomFieldValueSchema, {
      code: "VALIDATION_FAILED",
    });

    const value = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        const employee = await employeeRepo.findById(tx, employeeId);
        if (!employee)
          throw new NotFoundError({ detail: "Employee not found" });
        if (
          !canWriteCustomFields(await resolvePolicyContext(c, tx), employee)
        ) {
          throw new ForbiddenError({
            detail: "Only HR and administrators can edit custom field values",
          });
        }
        const definition = await cfRepo.findDefinitionById(
          tx,
          data.fieldDefinitionId,
        );
        if (!definition) {
          throw new NotFoundError({ detail: "Custom field not found" });
        }
        const updated = await cfRepo.upsertValue(
          tx,
          data.fieldDefinitionId,
          employeeId,
          data.value,
        );

        await auditRepo.log(tx, {
          actorId: user.id,
          action: "custom_field_value.updated",
          resourceType: "custom_field_value",
          resourceId: updated.id,
          metadata: {
            employeeId,
            fieldDefinitionId: data.fieldDefinitionId,
          },
        });

        return updated;
      },
    );

    return c.json(value);
  });

  return router;
}
