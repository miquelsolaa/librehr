import { z } from "zod";

/**
 * ORG-007: optional breakdown on the period's end date. `groupBy=group`
 * (projects and areas) only has the membership basis; `basis` defaults to
 * "primary" for departments and "membership" for groups.
 */
export const HeadcountBreakdownGroupBySchema = z.enum(["department", "group"]);
export const HeadcountBreakdownBasisSchema = z.enum(["primary", "membership"]);

export const HeadcountReportQuerySchema = z
  .object({
    startDate: z.string().date(),
    endDate: z.string().date(),
    groupBy: HeadcountBreakdownGroupBySchema.optional(),
    basis: HeadcountBreakdownBasisSchema.optional(),
  })
  .refine((value) => value.startDate <= value.endDate)
  .refine((value) => !value.basis || value.groupBy, {
    message: "basis requires groupBy",
    path: ["basis"],
  })
  .refine(
    (value) => !(value.groupBy === "group" && value.basis === "primary"),
    {
      message: "Groups have no primary members",
      path: ["basis"],
    },
  );
export type HeadcountReportQuery = z.infer<typeof HeadcountReportQuerySchema>;

export const HeadcountMetricsSchema = z.object({
  startingHeadcount: z.number().int(),
  endingHeadcount: z.number().int(),
  joinersCount: z.number().int(),
  leaversCount: z.number().int(),
  netChange: z.number().int(),
  turnoverRatePercent: z.number(),
});
export type HeadcountMetrics = z.infer<typeof HeadcountMetricsSchema>;

export const HeadcountBreakdownRowSchema = z.object({
  type: z.enum(["department", "project", "area"]),
  id: z.guid(),
  name: z.string(),
  headcount: z.number().int(),
  /** Primary members count 1; secondaries their allocation (null = 100%). */
  fte: z.number(),
});
export type HeadcountBreakdownRow = z.infer<typeof HeadcountBreakdownRowSchema>;

export const HeadcountBreakdownSchema = z.object({
  groupBy: HeadcountBreakdownGroupBySchema,
  basis: HeadcountBreakdownBasisSchema,
  /** The period end date: memberships and employment on that day. */
  asOf: z.string().date(),
  /** True on the membership basis: one person can count in several rows. */
  totalsOverlap: z.boolean(),
  rows: z.array(HeadcountBreakdownRowSchema),
});
export type HeadcountBreakdown = z.infer<typeof HeadcountBreakdownSchema>;

export const HeadcountReportResponseSchema = z.object({
  periodStart: z.string().date(),
  periodEnd: z.string().date(),
  headcount: HeadcountMetricsSchema,
  /** Present only when the query has groupBy. */
  breakdown: HeadcountBreakdownSchema.optional(),
});
export type HeadcountReportResponse = z.infer<
  typeof HeadcountReportResponseSchema
>;

export const AbsenceMetricsSchema = z.object({
  totalAbsentDays: z.number(),
  totalPlannedWorkingDays: z.number(),
  absenceRatePercent: z.number(),
  byCategory: z.record(z.string(), z.number()),
});
export type AbsenceMetrics = z.infer<typeof AbsenceMetricsSchema>;

export const ReportsSummaryResponseSchema = z.object({
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  headcount: HeadcountMetricsSchema,
  absences: AbsenceMetricsSchema,
});
export type ReportsSummaryResponse = z.infer<
  typeof ReportsSummaryResponseSchema
>;

export const GestoriaExportQuerySchema = z.object({
  periodYearMonth: z.string().regex(/^\d{4}-\d{2}$/), // YYYY-MM
});
export type GestoriaExportQuery = z.infer<typeof GestoriaExportQuerySchema>;
