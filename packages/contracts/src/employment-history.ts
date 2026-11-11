import { z } from "zod";

export const EmploymentPeriodSchema = z.object({
  id: z.guid(),
  jobTitle: z.string(),
  employmentType: z.string(),
  startDate: z.string().date(),
  endDate: z.string().date().nullable(),
});
export type EmploymentPeriod = z.infer<typeof EmploymentPeriodSchema>;

export const CreateEmploymentPeriodSchema = z
  .object({
    jobTitle: z.string().trim().min(1).max(200),
    employmentType: z.string().trim().min(1).max(100),
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
