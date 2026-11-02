import { Hono } from "hono";
import type { Sql } from "postgres";
import {
  type AuthUser,
  createProblemDetails,
  GestoriaExportQuerySchema,
} from "@librehr/contracts";
import {
  calculateHeadcountMetrics,
  calculateAbsenceMetrics,
  generateGestoriaCsv,
} from "@librehr/core";
import {
  withTenant,
  ReportRepository,
  EmployeeRepository,
  LeaveRepository,
} from "@librehr/db";
import { requireAuth } from "../middleware/auth.js";

export function createReportRoutes(sql: Sql) {
  const router = new Hono();
  const reportRepo = new ReportRepository();
  const empRepo = new EmployeeRepository();
  const leaveRepo = new LeaveRepository();

  // 1. GET /reports/summary - HR Summary Dashboard (RPT-001)
  router.get("/reports/summary", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;

    const now = new Date();
    const periodStart =
      c.req.query("periodStart") ??
      new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10);
    const periodEnd =
      c.req.query("periodEnd") ?? now.toISOString().slice(0, 10);

    const summary = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        const empResult = await empRepo.list(tx, { pageSize: 1000 });
        const employees = empResult.items.map((e) => ({
          id: e.id,
          hireDate: "2025-01-01", // Default if not detailed
          terminationDate: e.status === "terminated" ? "2026-01-01" : null,
        }));

        const headcount = calculateHeadcountMetrics(
          employees,
          periodStart,
          periodEnd,
        );

        const leaveRequests = await leaveRepo.getLeaveRequests(tx, {});
        const absences = leaveRequests
          .filter((r) => r.status === "approved")
          .map((r) => ({
            employeeId: r.employeeId,
            category: "vacation" as const,
            workingDays: r.workingDays,
          }));

        const absencesMetrics = calculateAbsenceMetrics(
          absences,
          Math.max(1, headcount.endingHeadcount),
          120, // Approx working days in standard 6-month period
        );

        return {
          periodStart,
          periodEnd,
          headcount,
          absences: absencesMetrics,
        };
      },
    );

    return c.json(summary);
  });

  // 2. GET /reports/gestoria/export - Monthly Gestoría Payroll CSV Export (RPT-002)
  router.get("/reports/gestoria/export", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;

    if (user.role !== "admin") {
      return c.json(
        createProblemDetails({
          status: 403,
          title: "Forbidden",
          detail: "Gestoría export requires administrator permissions",
          code: "FORBIDDEN",
        }),
        403,
        { "Content-Type": "application/problem+json" },
      );
    }

    const query = GestoriaExportQuerySchema.safeParse(c.req.query());
    const periodYearMonth = query.success
      ? query.data.periodYearMonth
      : new Date().toISOString().slice(0, 7);

    const [year, month] = periodYearMonth.split("-").map(Number);
    const periodStart = `${periodYearMonth}-01`;
    const periodEnd = new Date(Date.UTC(year!, month!, 0))
      .toISOString()
      .slice(0, 10);

    const csvContent = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        const payrollData = await reportRepo.getGestoriaPayrollData(
          tx,
          periodStart,
          periodEnd,
        );

        return generateGestoriaCsv(
          periodYearMonth,
          payrollData.map((d) => ({
            taxId: d.taxId,
            socialSecurityNumber: d.socialSecurityNumber,
            firstName: d.firstName,
            lastName: d.lastName,
            contractType: d.contractType,
            workedDays: d.workedDays,
            vacationDays: d.vacationDays,
            sickLeaveDays: d.sickLeaveDays,
            maternityPaternityDays: d.maternityPaternityDays,
            unpaidLeaveDays: d.unpaidLeaveDays,
            overtimeHours: Number(d.overtimeHours),
          })),
        );
      },
    );

    return new Response(csvContent, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="gestoria_payroll_${periodYearMonth}.csv"`,
      },
    });
  });

  return router;
}
