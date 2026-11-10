import { z } from "zod";

/**
 * TIM-008: an auditor invitation must carry the instant the auditor's access
 * ends; other roles must not (their access has no end date). The API also
 * checks the date is in the future and within the organization's
 * `auditorAccessMaxDays`.
 */
export const CreateInvitationRequestSchema = z
  .object({
    email: z.string().email("Valid email is required"),
    role: z
      .enum(["admin", "manager", "employee", "auditor"])
      .default("employee"),
    departmentId: z.string().uuid().nullable().optional(),
    accessExpiresAt: z.string().datetime({ offset: true }).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.role === "auditor" && value.accessExpiresAt === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["accessExpiresAt"],
        message: "An access end date is required for auditors",
      });
    }
    if (value.role !== "auditor" && value.accessExpiresAt !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["accessExpiresAt"],
        message: "An access end date is only allowed for auditors",
      });
    }
  });
export type CreateInvitationRequest = z.infer<
  typeof CreateInvitationRequestSchema
>;

export const InvitationResponseSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  role: z.string(),
  expiresAt: z.string().datetime(),
  /** TIM-008: auditors only; null for every other role. */
  accessExpiresAt: z.string().datetime().nullable(),
  acceptedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type InvitationResponse = z.infer<typeof InvitationResponseSchema>;

export const AcceptInvitationRequestSchema = z.object({
  token: z.string().min(10, "Valid token is required"),
  name: z.string().min(1, "Name is required"),
  password: z.string().min(8, "Password must have at least 8 characters"),
});
export type AcceptInvitationRequest = z.infer<
  typeof AcceptInvitationRequestSchema
>;

export const InvitationDetailsSchema = z.object({
  email: z.string().email(),
  role: z.string(),
  orgName: z.string(),
  expiresAt: z.string().datetime(),
});
export type InvitationDetails = z.infer<typeof InvitationDetailsSchema>;
