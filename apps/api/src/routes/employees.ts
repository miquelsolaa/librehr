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
} from "@librehr/contracts";
import { validateSpanishId, validateIban, buildOrgChart } from "@librehr/core";
import {
  withTenant,
  EmployeeRepository,
  AuditRepository,
  EmergencyContactRepository,
} from "@librehr/db";
import { requireAuth } from "../middleware/auth.js";
import { can } from "../policies/can.js";

export function createEmployeeRoutes(sql: Sql) {
  const router = new Hono();
  const employeeRepo = new EmployeeRepository();
  const auditRepo = new AuditRepository();
  const emergencyRepo = new EmergencyContactRepository();

  router.get("/employees", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;

    const allowed = can(
      {
        userId: user.id,
        organizationId: user.organizationId,
        role: user.role,
      },
      "employee.read",
    );

    if (!allowed) {
      const problem = createProblemDetails({
        status: 403,
        title: "Forbidden",
        detail: "You do not have permission to view employees",
        code: "FORBIDDEN",
      });
      return c.json(problem, 403, {
        "Content-Type": "application/problem+json",
      });
    }

    const queryParse = ListEmployeesQuerySchema.safeParse(c.req.query());
    if (!queryParse.success) {
      const problem = createProblemDetails({
        status: 400,
        title: "Bad Request",
        detail: queryParse.error.errors.map((e) => e.message).join(", "),
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
        return employeeRepo.list(tx, filters);
      },
    );

    return c.json({
      items: result.items,
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
        detail: parse.error.errors.map((e) => e.message).join(", "),
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

    return c.json(created, 201);
  });

  router.get("/employees/:id", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;
    const id = c.req.param("id");

    const allowed = can(
      {
        userId: user.id,
        organizationId: user.organizationId,
        role: user.role,
      },
      "employee.read",
      {
        organizationId: user.organizationId,
        employeeId: id,
      },
    );

    if (!allowed) {
      const problem = createProblemDetails({
        status: 403,
        title: "Forbidden",
        detail: "Access denied to this employee record",
        code: "FORBIDDEN",
      });
      return c.json(problem, 403, {
        "Content-Type": "application/problem+json",
      });
    }

    const emp = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        return employeeRepo.findById(tx, id);
      },
    );

    if (!emp) {
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

    return c.json(emp);
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
        detail: parse.error.errors.map((e) => e.message).join(", "),
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

    return c.json(updated);
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
        detail: parse.error.errors.map((e) => e.message).join(", "),
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
        const result = await employeeRepo.terminate(tx, id, parse.data);
        await auditRepo.log(tx, {
          actorId: user.id,
          action: "employee.terminate",
          resourceType: "employee",
          resourceId: id,
          metadata: {
            reason: parse.data.terminationReason,
            date: parse.data.terminationDate,
          },
        });
        return result;
      },
    );

    return c.json(terminated);
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
        detail: parse.error.errors.map((e) => e.message).join(", "),
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
        const revealed = await employeeRepo.revealSensitiveField(tx, id, field);

        // Immutable audit log recording who revealed the sensitive field
        await auditRepo.log(tx, {
          actorId: user.id,
          action: "employee.reveal_sensitive",
          resourceType: "employee",
          resourceId: id,
          metadata: {
            field,
            ip: c.req.header("x-forwarded-for") ?? "127.0.0.1",
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
    const allowed = can(
      {
        userId: user.id,
        organizationId: user.organizationId,
        role: user.role,
      },
      "employee.read",
    );

    if (!allowed) {
      const problem = createProblemDetails({
        status: 403,
        title: "Forbidden",
        detail: "You do not have permission to view the org chart",
        code: "FORBIDDEN",
      });
      return c.json(problem, 403, {
        "Content-Type": "application/problem+json",
      });
    }

    const orgChart = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        const flatItems = await employeeRepo.findOrgChartItems(tx);
        return buildOrgChart(flatItems);
      },
    );

    return c.json(orgChart);
  };

  router.get("/employees/org-chart", requireAuth, handleOrgChart);
  router.get("/people/org-chart", requireAuth, handleOrgChart);

  // Emergency Contacts endpoints (EMP-002)
  router.get("/people/:id/emergency-contacts", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;
    const employeeId = c.req.param("id");

    const contacts = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        return emergencyRepo.findByEmployeeId(tx, employeeId);
      },
    );

    return c.json(contacts);
  });

  router.post("/people/:id/emergency-contacts", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;
    const employeeId = c.req.param("id");

    const body = await c.req.json();
    const parse = CreateEmergencyContactSchema.safeParse(body);
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

    const contact = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        const created = await emergencyRepo.create(tx, {
          employeeId,
          ...parse.data,
        });

        await auditRepo.log(tx, {
          actorId: user.id,
          action: "employee.emergency_contact_created",
          resourceType: "emergency_contact",
          resourceId: created.id,
          metadata: { employeeId, fullName: created.fullName },
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
      const contactId = c.req.param("contactId");

      await withTenant(
        sql,
        { organizationId: user.organizationId, userId: user.id },
        async (tx) => {
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
        detail: parse.error.errors.map((e) => e.message).join(", "),
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
        const isAdminOrHr = user.role === "admin" || user.role === "hr";

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
          metadata: {
            changes: parse.data,
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

    return c.json(updated);
  });

  return router;
}
