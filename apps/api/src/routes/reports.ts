import { Hono } from "hono";
import type { Sql } from "postgres";
import { type AuthUser, createProblemDetails } from "@librehr/contracts";
import { requireAuth } from "../middleware/auth.js";

export function createReportRoutes(sql: Sql) {
  void sql;
  const router = new Hono();

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
