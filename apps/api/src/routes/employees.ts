import { Hono } from "hono";
import type { Sql } from "postgres";
import {
  type AuthUser,
  createProblemDetails,
  ListEmployeesQuerySchema,
  CreateEmployeeRequestSchema,
  UpdateEmployeeRequestSchema,
  TerminateEmployeeRequestSchema,
  RevealFieldRequestSchema,
  SelfServiceUpdateSchema,
  CreateEmergencyContactSchema,
  SetEmployeePinSchema,
} from "@librehr/contracts";
import {
  validateSpanishId,
  validateIban,
  buildOrgChart,
  hashKioskPin,
} from "@librehr/core";
import {
  withTenant,
  EmployeeRepository,
  AuditRepository,
  EmergencyContactRepository,
  AccessRevocationRepository,
  type TenantTx,
} from "@librehr/db";
import { z } from "zod";
import { ForbiddenError, NotFoundError } from "../errors/index.js";
import { IdParamSchema, parseParams } from "../lib/validate.js";
import { clientIp } from "../lib/client-ip.js";
import { requireAuth } from "../middleware/auth.js";
import { can, permissionScope } from "../policies/can.js";
import { canOnEmployee, resolvePolicyContext } from "../policies/context.js";
import {
  canSeeDirectory,
  employeeProfileView,
  toDirectoryEntry,
  toEmployeeProfile,
} from "../policies/employee-visibility.js";

export interface EmployeeRouteOptions {
  /** TRUST_PROXY: hops whose X-Forwarded-For entries are believed. */
  trustProxy?: number | undefined;
}

export function createEmployeeRoutes(
  sql: Sql,
  options: EmployeeRouteOptions = {},
) {
  const trustProxy = options.trustProxy ?? 0;
  const router = new Hono();
  const employeeRepo = new EmployeeRepository();
  const auditRepo = new AuditRepository();
  const emergencyRepo = new EmergencyContactRepository();
  const accessRevocationRepo = new AccessRevocationRepository();

  // EMP-001 directory: visible to anyone holding employee.read at any scope,
  // limited to directory fields whatever the caller's scope.
  router.get("/employees", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;

    const queryParse = ListEmployeesQuerySchema.safeParse(c.req.query());
    if (!queryParse.success) {
      const problem = createProblemDetails({
        status: 400,
        title: "Bad Request",
        detail: queryParse.error.issues.map((e) => e.message).join(", "),
        code: "VALIDATION_FAILED",
      });
      return c.json(problem, 400, {
        "Content-Type": "application/problem+json",
      });
    }

    const filters = queryParse.data;

    const result = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        if (!canSeeDirectory(await resolvePolicyContext(c, tx))) {
          throw new ForbiddenError({
            detail: "You do not have permission to view employees",
          });
        }
        return employeeRepo.list(tx, filters);
      },
    );

    return c.json({
      items: result.items.map(toDirectoryEntry),
      total: result.total,
      page: filters.page,
      pageSize: filters.pageSize,
    });
  });

  router.post("/employees", requireAuth, async (c) => {
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
        detail: "You do not have permission to create employees",
        code: "FORBIDDEN",
      });
      return c.json(problem, 403, {
        "Content-Type": "application/problem+json",
      });
    }

    const body = await c.req.json();
    const parse = CreateEmployeeRequestSchema.safeParse(body);
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

    const data = parse.data;

    // Domain validation for Spanish DNI/NIE and IBAN
    if (data.nationalId && !validateSpanishId(data.nationalId).valid) {
      const problem = createProblemDetails({
        status: 422,
        title: "Unprocessable Entity",
        detail: "Invalid Spanish DNI/NIE number or control letter",
        code: "INVALID_NATIONAL_ID",
      });
      return c.json(problem, 422, {
        "Content-Type": "application/problem+json",
      });
    }

    if (data.iban && !validateIban(data.iban).valid) {
      const problem = createProblemDetails({
        status: 422,
        title: "Unprocessable Entity",
        detail: "Invalid IBAN format or checksum",
        code: "INVALID_IBAN",
      });
      return c.json(problem, 422, {
        "Content-Type": "application/problem+json",
      });
    }

    const created = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        const emp = await employeeRepo.create(tx, {
          firstName: data.firstName,
          lastName: data.lastName,
          email: data.email,
          preferredName: data.preferredName ?? null,
          phone: data.phone ?? null,
          address: data.address ?? null,
          birthDate: data.birthDate ?? null,
          departmentId: data.departmentId ?? null,
          managerId: data.managerId ?? null,
          locationId: data.locationId ?? null,
          jobTitle: data.jobTitle,
          employmentType: data.employmentType,
          startDate: data.startDate,
          nationalId: data.nationalId,
          iban: data.iban,
        });

        await auditRepo.log(tx, {
          actorId: user.id,
          action: "employee.create",
          resourceType: "employee",
          resourceId: emp.id,
        });

        return emp;
      },
    );

    return c.json(toEmployeeProfile(created, "full"), 201);
  });

  // EMP-004: field-level visibility by relationship; never ciphertext.
  router.get("/employees/:id", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;
    const { id } = parseParams(c, IdParamSchema, {
      detail: "Employee not found",
    });

    const profile = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        const emp = await employeeRepo.findById(tx, id);
        if (!emp) throw new NotFoundError({ detail: "Employee not found" });
        const view = employeeProfileView(
          await resolvePolicyContext(c, tx),
          emp,
        );
        if (!view) {
          throw new ForbiddenError({
            detail: "Access denied to this employee record",
          });
        }
        return toEmployeeProfile(emp, view);
      },
    );

    return c.json(profile);
  });

  router.patch("/employees/:id", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;
    const id = c.req.param("id");

    const allowed = can(
      {
        userId: user.id,
        organizationId: user.organizationId,
        role: user.role,
      },
      "employee.write",
      {
        organizationId: user.organizationId,
        employeeId: id,
      },
    );

    if (!allowed) {
      const problem = createProblemDetails({
        status: 403,
        title: "Forbidden",
        detail: "You do not have permission to modify this employee",
        code: "FORBIDDEN",
      });
      return c.json(problem, 403, {
        "Content-Type": "application/problem+json",
      });
    }

    const body = await c.req.json();
    const parse = UpdateEmployeeRequestSchema.safeParse(body);
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

    const data = parse.data;

    if (data.nationalId && !validateSpanishId(data.nationalId).valid) {
      const problem = createProblemDetails({
        status: 422,
        title: "Unprocessable Entity",
        detail: "Invalid Spanish DNI/NIE",
        code: "INVALID_NATIONAL_ID",
      });
      return c.json(problem, 422, {
        "Content-Type": "application/problem+json",
      });
    }

    if (data.iban && !validateIban(data.iban).valid) {
      const problem = createProblemDetails({
        status: 422,
        title: "Unprocessable Entity",
        detail: "Invalid IBAN",
        code: "INVALID_IBAN",
      });
      return c.json(problem, 422, {
        "Content-Type": "application/problem+json",
      });
    }

    const updated = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        if (!(await employeeRepo.findById(tx, id))) {
          throw new NotFoundError({ detail: "Employee not found" });
        }
        const result = await employeeRepo.update(tx, id, data);
        await auditRepo.log(tx, {
          actorId: user.id,
          action: "employee.update",
          resourceType: "employee",
          resourceId: id,
        });
        return result;
      },
    );

    return c.json(toEmployeeProfile(updated, "full"));
  });

  router.post("/employees/:id/terminate", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;
    const id = c.req.param("id");

    const allowed = can(
      {
        userId: user.id,
        organizationId: user.organizationId,
        role: user.role,
      },
      "employee.write",
      {
        organizationId: user.organizationId,
        employeeId: id,
      },
    );

    if (!allowed) {
      const problem = createProblemDetails({
        status: 403,
        title: "Forbidden",
        detail: "You do not have permission to terminate this employee",
        code: "FORBIDDEN",
      });
      return c.json(problem, 403, {
        "Content-Type": "application/problem+json",
      });
    }

    const body = await c.req.json();
    const parse = TerminateEmployeeRequestSchema.safeParse(body);
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

    const terminated = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        if (!(await employeeRepo.findById(tx, id))) {
          throw new NotFoundError({ detail: "Employee not found" });
        }
        const result = await employeeRepo.terminate(tx, id, parse.data);
        // EMP-007: when the date is today or past (org time zone) the user's
        // sessions and tokens in this org go now; a future date is enforced
        // by the identity lookups once it arrives.
        const access = await accessRevocationRepo.revokeIfTerminated(tx, id);
        await auditRepo.log(tx, {
          actorId: user.id,
          action: "employee.terminate",
          resourceType: "employee",
          resourceId: id,
          metadata: {
            reason: parse.data.terminationReason,
            date: parse.data.terminationDate,
            accessRevoked: access.revoked,
            sessionsRevoked: access.sessions,
            tokensRevoked: access.tokens,
          },
        });
        return result;
      },
    );

    return c.json(toEmployeeProfile(terminated, "full"));
  });

  router.post("/employees/:id/reveal", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;
    const id = c.req.param("id");

    const allowed = can(
      {
        userId: user.id,
        organizationId: user.organizationId,
        role: user.role,
      },
      "employee.read_sensitive",
      {
        organizationId: user.organizationId,
        employeeId: id,
      },
    );

    if (!allowed) {
      const problem = createProblemDetails({
        status: 403,
        title: "Forbidden",
        detail: "You do not have permission to reveal sensitive employee data",
        code: "FORBIDDEN",
      });
      return c.json(problem, 403, {
        "Content-Type": "application/problem+json",
      });
    }

    const body = await c.req.json();
    const parse = RevealFieldRequestSchema.safeParse(body);
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

    const field = parse.data.field;

    const value = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        if (!(await employeeRepo.findById(tx, id))) {
          throw new NotFoundError({ detail: "Employee not found" });
        }
        const revealed = await employeeRepo.revealSensitiveField(tx, id, field);

        // Immutable audit log recording who revealed the sensitive field
        await auditRepo.log(tx, {
          actorId: user.id,
          action: "employee.reveal_sensitive",
          resourceType: "employee",
          resourceId: id,
          metadata: {
            field,
            // Resolved like rate limiting: a client-supplied
            // X-Forwarded-For is only believed through trusted proxies.
            ip: clientIp(c, trustProxy),
          },
        });

        return revealed;
      },
    );

    return c.json({ field, value });
  });

  // Org Chart endpoint (ORG-004) - supports /people/org-chart and /employees/org-chart
  const handleOrgChart = async (c: import("hono").Context) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;

    // Org chart nodes carry directory fields only, so it follows the
    // directory rule (EMP-001).
    const orgChart = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        if (!canSeeDirectory(await resolvePolicyContext(c, tx))) {
          throw new ForbiddenError({
            detail: "You do not have permission to view the org chart",
          });
        }
        const flatItems = await employeeRepo.findOrgChartItems(tx);
        return buildOrgChart(flatItems);
      },
    );

    return c.json(orgChart);
  };

  router.get("/employees/org-chart", requireAuth, handleOrgChart);
  router.get("/people/org-chart", requireAuth, handleOrgChart);

  // Emergency contacts (EMP-002) are personal data: the employee themselves
  // and organization-scoped HR/admin only, not managers or colleagues.
  const requireContactAccess = async (
    c: import("hono").Context,
    tx: TenantTx,
    employeeId: string,
    permission: "employee.read" | "employee.write",
  ) => {
    const ctx = await resolvePolicyContext(c, tx);
    const emp = await employeeRepo.findById(tx, employeeId);
    if (!emp) throw new NotFoundError({ detail: "Employee not found" });
    const isSelf = ctx.employeeId === emp.id;
    const isHr =
      permissionScope(ctx, permission) === "organization" &&
      canOnEmployee(ctx, permission, emp);
    if (!isSelf && !isHr) {
      throw new ForbiddenError({
        detail: "You can only manage your own emergency contacts",
      });
    }
  };

  router.get("/people/:id/emergency-contacts", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;
    const { id: employeeId } = parseParams(c, IdParamSchema, {
      detail: "Employee not found",
    });

    const contacts = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        await requireContactAccess(c, tx, employeeId, "employee.read");
        return emergencyRepo.findByEmployeeId(tx, employeeId);
      },
    );

    return c.json(contacts);
  });

  router.post("/people/:id/emergency-contacts", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;
    const { id: employeeId } = parseParams(c, IdParamSchema, {
      detail: "Employee not found",
    });

    const body = await c.req.json();
    const parse = CreateEmergencyContactSchema.safeParse(body);
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

    const contact = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        await requireContactAccess(c, tx, employeeId, "employee.write");
        const created = await emergencyRepo.create(tx, {
          employeeId,
          ...parse.data,
        });

        // Ids only: the contact's name is third-party personal data.
        await auditRepo.log(tx, {
          actorId: user.id,
          action: "employee.emergency_contact_created",
          resourceType: "emergency_contact",
          resourceId: created.id,
          metadata: { employeeId },
        });

        return created;
      },
    );

    return c.json(contact, 201);
  });

  router.delete(
    "/people/:id/emergency-contacts/:contactId",
    requireAuth,
    async (c) => {
      const user = (c.get as (key: string) => unknown)("user") as AuthUser;
      const { id: employeeId, contactId } = parseParams(
        c,
        z.object({ id: z.guid(), contactId: z.guid() }),
        { detail: "Emergency contact not found" },
      );

      await withTenant(
        sql,
        { organizationId: user.organizationId, userId: user.id },
        async (tx) => {
          await requireContactAccess(c, tx, employeeId, "employee.write");
          const existing = await emergencyRepo.findById(tx, contactId);
          if (!existing || existing.employeeId !== employeeId) {
            throw new NotFoundError({ detail: "Emergency contact not found" });
          }
          await emergencyRepo.delete(tx, contactId);
          await auditRepo.log(tx, {
            actorId: user.id,
            action: "employee.emergency_contact_deleted",
            resourceType: "emergency_contact",
            resourceId: contactId,
          });
        },
      );

      return c.json({ success: true });
    },
  );

  // Self-Service Profile Update (EMP-005)
  router.patch("/people/:id/self-service", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;
    const employeeId = c.req.param("id");

    const body = await c.req.json();
    const parse = SelfServiceUpdateSchema.safeParse(body);
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

    const updated = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        const current = await employeeRepo.findById(tx, employeeId);
        if (!current) return null;

        // Verify that the user is editing their own employee profile or is HR/Admin
        const isSelf = current.userId === user.id;
        const isAdminOrHr = canOnEmployee(
          await resolvePolicyContext(c, tx),
          "employee.write",
          current,
        );

        if (!isSelf && !isAdminOrHr) {
          return "FORBIDDEN";
        }

        const res = await employeeRepo.updateSelfService(
          tx,
          employeeId,
          parse.data,
        );

        await auditRepo.log(tx, {
          actorId: user.id,
          action: "employee.self_service_update",
          resourceType: "employee",
          resourceId: employeeId,
          // Field names only: the values are contact data (PII).
          metadata: {
            fields: Object.keys(parse.data),
            isSelf,
          },
        });

        return res;
      },
    );

    if (updated === "FORBIDDEN") {
      const problem = createProblemDetails({
        status: 403,
        title: "Forbidden",
        detail: "You can only update your own employee profile",
        code: "FORBIDDEN",
      });
      return c.json(problem, 403, {
        "Content-Type": "application/problem+json",
      });
    }

    if (!updated) {
      const problem = createProblemDetails({
        status: 404,
        title: "Not Found",
        detail: "Employee not found",
        code: "NOT_FOUND",
      });
      return c.json(problem, 404, {
        "Content-Type": "application/problem+json",
      });
    }

    return c.json(toEmployeeProfile(updated, "full"));
  });

  // TIM-010: Set or update employee Kiosk PIN
  router.patch("/people/:id/pin", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;
    const employeeId = c.req.param("id");
    const body = await c.req.json().catch(() => null);
    const parse = SetEmployeePinSchema.safeParse(body);

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

    // scrypt is deliberately slow: hash before opening the transaction.
    const pinHash = await hashKioskPin(parse.data.pin);

    const result = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        const emp = await employeeRepo.findById(tx, employeeId);
        if (!emp) return null;

        const isSelf = emp.userId === user.id;
        const isAdminOrHr = user.role === "admin" || user.role === "hr";
        if (!isSelf && !isAdminOrHr) {
          return "FORBIDDEN";
        }

        await employeeRepo.setKioskPin(
          tx,
          employeeId,
          pinHash,
          null,
          parse.data.badgeId,
        );

        await auditRepo.log(tx, {
          actorId: user.id,
          action: "employee.kiosk_pin_updated",
          resourceType: "employee",
          resourceId: employeeId,
          metadata: {
            hasBadge: Boolean(parse.data.badgeId),
          },
        });

        return { success: true };
      },
    );

    if (result === "FORBIDDEN") {
      const problem = createProblemDetails({
        status: 403,
        title: "Forbidden",
        detail: "You do not have permission to change this PIN",
        code: "FORBIDDEN",
      });
      return c.json(problem, 403, {
        "Content-Type": "application/problem+json",
      });
    }

    if (!result) {
      const problem = createProblemDetails({
        status: 404,
        title: "Not Found",
        detail: "Employee not found",
        code: "NOT_FOUND",
      });
      return c.json(problem, 404, {
        "Content-Type": "application/problem+json",
      });
    }

    return c.json(result);
  });

  return router;
}
