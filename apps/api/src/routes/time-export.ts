import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import type { Sql } from "postgres";
import {
  type AuthUser,
  type OfficialExportResponse,
  OfficialExportQuerySchema,
} from "@librehr/contracts";
import {
  createInspectionExport,
  inspectionExportLabels,
  inspectionRowCells,
  renderInspectionPdf,
} from "@librehr/core";
import {
  withTenant,
  AuditRepository,
  EmployeeRepository,
  OrganizationRepository,
} from "@librehr/db";
import { requireAuth } from "../middleware/auth.js";
import { can } from "../policies/can.js";
import { canOnEmployee, resolvePolicyContext } from "../policies/context.js";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "../errors/index.js";
import { resolveBusinessTimeZone } from "../lib/business-date.js";
import { parseQuery } from "../lib/validate.js";
import {
  collectExportEmployee,
  type CollectedEmployee,
  type ExportSubject,
} from "../lib/time-export.js";

/** Response headers that browsers may read on a cross-origin export. */
export const TIME_EXPORT_EXPOSED_HEADERS = ["X-Export-Id", "X-Content-SHA256"];

/**
 * TIM-006: official working-time record for the Labour Inspectorate
 * (ET art. 34.9), as JSON, CSV or PDF, for one employee or the whole
 * organization. Every successful export is audited (ADM-002).
 */
export function createTimeExportRoutes(
  sql: Sql,
  options: { timeChainKey: string },
) {
  const router = new Hono();
  const employeeRepo = new EmployeeRepository();
  const orgRepo = new OrganizationRepository();
  const auditRepo = new AuditRepository();

  router.get("/time/export", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;
    const query = parseQuery(c, OfficialExportQuerySchema);
    const { startDate, endDate, scope, format, locale } = query;
    const exportId = randomUUID();
    const generatedAt = new Date().toISOString();

    const doc = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        const ctx = await resolvePolicyContext(c, tx);
        let subjects: ExportSubject[];
        let timeZone: string;
        let subjectEmployeeId: string | undefined;

        if (scope === "organization") {
          // Organization scope only: a manager's "reports" scope is not enough.
          if (!can(ctx, "time.record.read")) {
            throw new ForbiddenError({
              detail:
                "Exporting the whole organization requires organization-wide access to time records",
            });
          }
          // One zone for the whole document: the header and every row agree.
          timeZone = await resolveBusinessTimeZone(c, tx, null);
          subjects = await employeeRepo.listEmployedDuring(
            tx,
            startDate,
            endDate,
          );
        } else {
          const employee = query.employeeId
            ? await employeeRepo.findById(tx, query.employeeId)
            : await employeeRepo.findByUserId(tx, user.id);
          if (!employee) {
            throw new NotFoundError({
              detail: "Employee not found",
              code: "EMPLOYEE_NOT_FOUND",
            });
          }
          if (!canOnEmployee(ctx, "time.record.read", employee)) {
            throw new ForbiddenError({
              detail:
                "You do not have permission to export this employee's time records",
            });
          }
          timeZone = await resolveBusinessTimeZone(c, tx, employee.locationId);
          subjects = [employee];
          subjectEmployeeId = employee.id;
        }

        const collected: CollectedEmployee[] = [];
        for (const subject of subjects) {
          collected.push(
            await collectExportEmployee(
              c,
              tx,
              subject,
              { startDate, endDate, timeZone },
              options.timeChainKey,
            ),
          );
        }
        if (scope === "employee" && collected[0]?.input.days === null) {
          throw new ConflictError({
            code: "SCHEDULE_NOT_CONFIGURED",
            detail:
              "Configure a schedule rule for every day in the requested period.",
          });
        }

        const org = await orgRepo.findById(tx, user.organizationId);
        if (!org) throw new NotFoundError({ detail: "Organization not found" });

        const input = {
          exportId,
          locale,
          scope,
          organizationName: org.name,
          periodStart: startDate,
          periodEnd: endDate,
          timeZone,
          generatedAt,
          generatedBy: { name: user.name, role: user.role },
          employees: collected.map((e) => e.input),
        };
        const result = createInspectionExport(input);
        const labels = inspectionExportLabels(locale);
        // Rendered before the audit entry: a failed render records nothing.
        const pdf =
          format === "pdf" ? renderInspectionPdf(result, input) : null;

        await auditRepo.log(tx, {
          actorId: user.id,
          action: "time.export",
          resourceType: "time_export",
          resourceId: exportId,
          // Ids, period and hash only: never names or emails (no PII).
          metadata: {
            scope,
            format,
            locale,
            periodStart: startDate,
            periodEnd: endDate,
            employeeCount: collected.length,
            contentHash: result.contentHash,
            ...(subjectEmployeeId ? { employeeId: subjectEmployeeId } : {}),
          },
        });

        const json: OfficialExportResponse = {
          exportId,
          contentHash: result.contentHash,
          scope,
          locale,
          periodStart: startDate,
          periodEnd: endDate,
          timeZone,
          generatedAt,
          organizationName: org.name,
          generatedBy: input.generatedBy,
          metadataLines: result.metadataLines,
          columns: result.columns,
          rows: result.rows.map((row) => inspectionRowCells(row, labels)),
          employees: collected.map((e) => ({
            employeeId: e.input.employeeId,
            name: e.input.name,
            scheduleConfigured: e.input.days !== null,
            chainStatus: e.input.chainStatus ?? null,
            totalWorkedMinutes: e.totalWorkedMinutes,
            totalOvertimeMinutes: e.totalOvertimeMinutes,
          })),
        };
        return { json, csv: result.csv, pdf, subjectEmployeeId };
      },
    );

    const headers: Record<string, string> = {
      "Cache-Control": "no-store",
      "X-Export-Id": doc.json.exportId,
      "X-Content-SHA256": doc.json.contentHash,
    };
    const suffix = doc.subjectEmployeeId
      ? `-${doc.subjectEmployeeId.slice(0, 8)}`
      : "";
    const filename = (ext: string) =>
      `registro-jornada-${startDate}-${endDate}${suffix}.${ext}`;

    if (format === "csv") {
      // The BOM makes spreadsheet software read UTF-8; it is not hashed.
      return c.body(`\uFEFF${doc.csv}`, 200, {
        ...headers,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename("csv")}"`,
      });
    }
    if (format === "pdf" && doc.pdf) {
      return c.body(new Uint8Array(doc.pdf), 200, {
        ...headers,
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename("pdf")}"`,
      });
    }
    return c.json(doc.json, 200, headers);
  });

  return router;
}
