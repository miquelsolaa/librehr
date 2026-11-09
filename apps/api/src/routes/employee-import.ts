import { Hono } from "hono";
import type { Sql } from "postgres";
import {
  type AuthUser,
  createProblemDetails,
  EmployeeImportRequestSchema,
} from "@librehr/contracts";
import { validateEmployeeCsv } from "@librehr/core";
import {
  withTenant,
  EmployeeRepository,
  DepartmentRepository,
  LocationRepository,
  AuditRepository,
} from "@librehr/db";
import { businessToday } from "../lib/business-date.js";
import { parseJsonBody } from "../lib/validate.js";
import { requireAuth } from "../middleware/auth.js";

export function createEmployeeImportRoutes(sql: Sql) {
  const router = new Hono();
  const empRepo = new EmployeeRepository();
  const deptRepo = new DepartmentRepository();
  const locRepo = new LocationRepository();
  const auditRepo = new AuditRepository();

  // POST /employees/import - Atomic CSV Employee Import (EMP-006)
  router.post("/employees/import", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;

    if (user.role !== "admin") {
      return c.json(
        createProblemDetails({
          status: 403,
          title: "Forbidden",
          detail: "Employee bulk import requires admin role",
          code: "FORBIDDEN",
        }),
        403,
        { "Content-Type": "application/problem+json" },
      );
    }

    const body = await parseJsonBody(c, EmployeeImportRequestSchema);
    const validationReport = validateEmployeeCsv(body.csvContent);

    // If invalid or dryRun=true, return report without modifying database
    if (!validationReport.valid || body.dryRun) {
      return c.json({
        valid: validationReport.valid,
        totalRows: validationReport.totalRows,
        validRowsCount: validationReport.validRowsCount,
        errors: validationReport.errors,
        importedCount: 0,
      });
    }

    // Atomic application: if any error occurs during insertion, everything rolls back
    const importedCount = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        const departments = await deptRepo.findMany(tx);
        const locations = await locRepo.findLocations(tx);

        const deptMap = new Map<string, string>(
          departments.map((d) => [d.name.toLowerCase().trim(), d.id]),
        );

        // Rows without a start date start today in the import location's zone.
        const locationId = locations[0]?.id ?? null;
        const today = await businessToday(c, tx, locationId);

        for (const row of validationReport.parsedRows) {
          const deptId = row.departmentName
            ? (deptMap.get(row.departmentName.toLowerCase().trim()) ?? null)
            : null;

          await empRepo.create(tx, {
            firstName: row.firstName,
            lastName: row.lastName,
            email: row.email,
            nationalId: row.nationalId ?? "00000000T",
            iban: row.iban ?? null,
            jobTitle: row.jobTitle ?? "Employee",
            departmentId: deptId,
            locationId,
            startDate: row.startDate ?? today,
            employmentType: "indefinido",
          });
        }

        await auditRepo.log(tx, {
          actorId: user.id,
          action: "employee.bulk_import",
          resourceType: "employee",
          resourceId: user.organizationId,
          metadata: { importedCount: validationReport.parsedRows.length },
        });

        return validationReport.parsedRows.length;
      },
    );

    return c.json({
      valid: true,
      totalRows: validationReport.totalRows,
      validRowsCount: validationReport.validRowsCount,
      errors: [],
      importedCount,
    });
  });

  return router;
}
