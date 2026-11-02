import { z } from "zod";

export const HeadcountMetricsSchema = z.object({
  startingHeadcount: z.number().int(),
  endingHeadcount: z.number().int(),
  joinersCount: z.number().int(),
  leaversCount: z.number().int(),
  netChange: z.number().int(),
  turnoverRatePercent: z.number(),
});
export type HeadcountMetrics = z.infer<typeof HeadcountMetricsSchema>;

export const AbsenceMetricsSchema = z.object({
  totalAbsentDays: z.number(),
  totalPlannedWorkingDays: z.number(),
  absenceRatePercent: z.number(),
  byCategory: z.record(z.number()),
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
