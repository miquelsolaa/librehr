import { Hono, type Context } from "hono";
import type { Sql } from "postgres";
import {
  type AuthUser,
  createProblemDetails,
  type HeadcountBreakdown,
  HeadcountReportQuerySchema,
} from "@librehr/contracts";
import {
  calculateHeadcountMetrics,
  calculateMembershipBreakdown,
  csvCell,
} from "@librehr/core";
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
          detail:
            "Valid, ordered start and end dates and a valid groupBy and basis are required",
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
        const snapshots = rows.map((row) => ({
          id: row.id,
          hireDate: row.startDate!,
          terminationDate: row.endDate ?? row.terminationDate,
        }));
        const headcount = calculateHeadcountMetrics(
          snapshots,
          parsed.data.startDate,
          parsed.data.endDate,
        );
        const { groupBy, endDate } = parsed.data;
        // ORG-007: per department or group on the period's end date.
        let breakdown: HeadcountBreakdown | undefined;
        if (groupBy) {
          const basis =
            parsed.data.basis ??
            (groupBy === "department" ? "primary" : "membership");
          const links = await new ReportRepository().getHeadcountBreakdownLinks(
            tx,
            endDate,
          );
          breakdown = {
            groupBy,
            basis,
            asOf: endDate,
            totalsOverlap: basis === "membership",
            rows: calculateMembershipBreakdown(snapshots, links, endDate, {
              groupBy,
              basis,
            }),
          };
        }
        if (exportCsv)
          await new AuditRepository().log(tx, {
            actorId: user.id,
            action: "report.headcount_export",
            resourceType: "report",
            metadata: {
              startDate: parsed.data.startDate,
              endDate: parsed.data.endDate,
              ...(breakdown
                ? { groupBy: breakdown.groupBy, basis: breakdown.basis }
                : {}),
            },
          });
        return { headcount, breakdown };
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
    const { headcount, breakdown } = report;
    if (exportCsv && breakdown) {
      // totals_overlap: on the membership basis one person can count in
      // several rows, so the rows do not add up to the headcount.
      const header =
        "as_of,basis,totals_overlap,group_type,group_id,group_name,headcount,fte";
      const lines = breakdown.rows.map((row) =>
        [
          breakdown.asOf,
          breakdown.basis,
          breakdown.totalsOverlap,
          row.type,
          row.id,
          csvCell(row.name),
          row.headcount,
          row.fte,
        ].join(","),
      );
      return c.body([header, ...lines, ""].join("\r\n"), 200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="headcount-${breakdown.groupBy}-${parsed.data.startDate}-${parsed.data.endDate}.csv"`,
        "Cache-Control": "no-store",
      });
    }
    if (exportCsv) {
      const header =
        "period_start,period_end,starting_headcount,ending_headcount,joiners,leavers,net_change,turnover_rate_percent";
      const row = [
        parsed.data.startDate,
        parsed.data.endDate,
        headcount.startingHeadcount,
        headcount.endingHeadcount,
        headcount.joinersCount,
        headcount.leaversCount,
        headcount.netChange,
        headcount.turnoverRatePercent,
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
      headcount,
      ...(breakdown ? { breakdown } : {}),
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
