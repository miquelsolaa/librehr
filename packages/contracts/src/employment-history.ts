import { z } from "zod";

/**
 * LEA-002 (#131): weekly contract hours of an employment period. At most 40,
 * the ordinary maximum week (ET art. 34.1), with up to two decimals (the
 * column is numeric(5,2)).
 */
export const WeeklyContractHoursSchema = z
  .number()
  .positive("Must be greater than 0")
  .max(40, "Must be at most 40 hours (ET art. 34.1)")
  .multipleOf(0.01, "At most two decimals");

export const EmploymentPeriodSchema = z.object({
  id: z.guid(),
  jobTitle: z.string(),
  employmentType: z.string(),
  workingHoursPerWeek: z.number(),
  startDate: z.string().date(),
  endDate: z.string().date().nullable(),
});
export type EmploymentPeriod = z.infer<typeof EmploymentPeriodSchema>;

/**
 * A new period. When it starts after the start of the open-ended current
 * period, that period is closed the day before (a change of contract hours,
 * job or type), so earlier periods keep their values. Any other overlap is
 * refused.
 */
export const CreateEmploymentPeriodSchema = z
  .object({
    jobTitle: z.string().trim().min(1).max(200),
    employmentType: z.string().trim().min(1).max(100),
    /** Omitted: 40 h (full time). */
    workingHoursPerWeek: WeeklyContractHoursSchema.optional(),
    startDate: z.string().date(),
    endDate: z.string().date().nullable().optional(),
  })
  .refine((period) => !period.endDate || period.endDate >= period.startDate, {
    message: "End date must not precede start date",
    path: ["endDate"],
  });
export type CreateEmploymentPeriod = z.infer<
  typeof CreateEmploymentPeriodSchema
>;
