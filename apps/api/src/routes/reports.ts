import { Hono, type Context } from "hono";
import type { Sql } from "postgres";
import {
  type AuthUser,
  createProblemDetails,
  HeadcountReportQuerySchema,
} from "@librehr/contracts";
import { calculateHeadcountMetrics } from "@librehr/core";
import { AuditRepository, ReportRepository, withTenant } from "@librehr/db";
import { requireAuth } from "../middleware/auth.js";

export function createReportRoutes(sql: Sql) {
  const router = new Hono();

  const headcountHandler = (exportCsv: boolean) => async (c: Context) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;
    // Personal access tokens are not authorized until report-specific scopes exist.
    if (user.role !== "admin" || (c.get as (key: string) => unknown)("patId")) {
      return c.json(
        createProblemDetails({
          status: 403,
          title: "Forbidden",
          detail: "Administrator session required",
          code: "FORBIDDEN",
        }),
        403,
        { "Content-Type": "application/problem+json" },
      );
    }
    const parsed = HeadcountReportQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json(
        createProblemDetails({
          status: 400,
          title: "Validation failed",
          detail: "A valid start and end date are required",
          code: "VALIDATION_ERROR",
        }),
        400,
        { "Content-Type": "application/problem+json" },
      );
    }
    const report = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        const rows = await new ReportRepository().getHeadcountSource(tx);
        if (
          rows.some(
            (row) =>
              row.employmentCount !== 1 ||
              !row.startDate ||
              (row.endDate && row.endDate < row.startDate) ||
              (row.terminationDate && row.terminationDate < row.startDate) ||
              (row.status === "terminated" && !row.terminationDate) ||
              (row.endDate &&
                row.terminationDate &&
                row.endDate !== row.terminationDate),
          )
        )
          return null;
        const headcount = calculateHeadcountMetrics(
          rows.map((row) => ({
            id: row.id,
            hireDate: row.startDate!,
            terminationDate: row.endDate ?? row.terminationDate,
          })),
          parsed.data.startDate,
          parsed.data.endDate,
        );
        if (exportCsv)
          await new AuditRepository().log(tx, {
            actorId: user.id,
            action: "report.headcount_export",
            resourceType: "report",
            metadata: {
              startDate: parsed.data.startDate,
              endDate: parsed.data.endDate,
            },
          });
        return headcount;
      },
    );
    if (!report) {
      return c.json(
        createProblemDetails({
          status: 409,
          title: "Report unavailable",
          detail: "Complete and consistent employment dates are required",
          code: "REPORT_DATA_INCOMPLETE",
        }),
        409,
        { "Content-Type": "application/problem+json" },
      );
    }
    if (exportCsv) {
      const header =
        "period_start,period_end,starting_headcount,ending_headcount,joiners,leavers,net_change,turnover_rate_percent";
      const row = [
        parsed.data.startDate,
        parsed.data.endDate,
        report.startingHeadcount,
        report.endingHeadcount,
        report.joinersCount,
        report.leaversCount,
        report.netChange,
        report.turnoverRatePercent,
      ].join(",");
      return c.body(`${header}\r\n${row}\r\n`, 200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="headcount-${parsed.data.startDate}-${parsed.data.endDate}.csv"`,
        "Cache-Control": "no-store",
      });
    }
    return c.json({
      periodStart: parsed.data.startDate,
      periodEnd: parsed.data.endDate,
      headcount: report,
    });
  };
  router.get("/reports/headcount", requireAuth, headcountHandler(false));
  router.get("/reports/headcount/export", requireAuth, headcountHandler(true));

  // 1. GET /reports/summary - HR Summary Dashboard (RPT-001)
  router.get("/reports/summary", requireAuth, (c) => {
    return c.json(
      createProblemDetails({
        status: 503,
        title: "Service unavailable",
        detail:
          "Report calculations are unavailable while their data sources are corrected.",
        code: "REPORT_UNAVAILABLE",
      }),
      503,
      { "Content-Type": "application/problem+json" },
    );
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

    return c.json(
      createProblemDetails({
        status: 503,
        title: "Service unavailable",
        detail: "The export is unavailable while its source data is corrected.",
        code: "REPORT_UNAVAILABLE",
      }),
      503,
      { "Content-Type": "application/problem+json" },
    );
  });

  return router;
}
