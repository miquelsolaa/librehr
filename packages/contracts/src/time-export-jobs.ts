// Background organization exports (TIM-006, issue #38): split from time.ts to
// keep it under the max-lines limit.
import { z } from "zod";
import { refineExportPeriod } from "./time.js";

/**
 * Largest background organization export (TIM-006, issue #38), in employees ×
 * days: about 1,370 employees for a full year. Above
 * OFFICIAL_EXPORT_MAX_EMPLOYEE_DAYS the synchronous export answers 422 and
 * the client may queue it with POST /v1/time/exports instead.
 */
export const OFFICIAL_EXPORT_ASYNC_MAX_EMPLOYEE_DAYS = 500_000;

/**
 * Queues a background organization export (TIM-006). Organization scope only
 * (an employee export is always synchronous) and csv or pdf only (the JSON
 * preview is synchronous).
 */
export const TimeExportJobRequestSchema = z
  .strictObject({
    format: z.enum(["csv", "pdf"]),
    startDate: z.string().date(),
    endDate: z.string().date(),
    locale: z.enum(["ca", "es", "en"]).default("es"),
  })
  .superRefine(refineExportPeriod);
export type TimeExportJobRequest = z.input<typeof TimeExportJobRequestSchema>;

/**
 * A background export as its requester sees it. `contentHash`, `employeeCount`
 * and `byteSize` are set once it is ready; `expiresAt` is when the file is
 * deleted (the record stays). `errorCode` is a coarse code of a failed run
 * (EXPORT_FAILED, EXPORT_TOO_LARGE, EXPORT_STALLED, FORBIDDEN).
 */
export const TimeExportJobSchema = z.object({
  exportId: z.guid(),
  status: z.enum(["queued", "running", "ready", "failed", "expired"]),
  scope: z.literal("organization"),
  format: z.enum(["csv", "pdf"]),
  locale: z.enum(["ca", "es", "en"]),
  periodStart: z.string().date(),
  periodEnd: z.string().date(),
  employeeDays: z.number().int(),
  contentHash: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .nullable(),
  employeeCount: z.number().int().nullable(),
  byteSize: z.number().int().nullable(),
  errorCode: z.string().nullable(),
  createdAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  expiresAt: z.string().datetime().nullable(),
});
export type TimeExportJob = z.infer<typeof TimeExportJobSchema>;

/** The caller's own background exports, newest first. */
export const TimeExportJobListResponseSchema = z.object({
  items: z.array(TimeExportJobSchema),
});
export type TimeExportJobListResponse = z.infer<
  typeof TimeExportJobListResponseSchema
>;
