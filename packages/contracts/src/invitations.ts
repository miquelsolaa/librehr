import { z } from "zod";
import { AccessUntilSchema } from "./auditor-access.js";

/**
 * TIM-008: an auditor invitation must carry the last day of access
 * (`accessUntil`, in the organization's time zone); other roles must not
 * (their access has no end date). The API also checks the day is today or
 * later and at most `auditorAccessMaxDays` days ahead.
 */
export const CreateInvitationRequestSchema = z
  .object({
    email: z.string().email("Valid email is required"),
    role: z
      .enum(["admin", "manager", "employee", "auditor"])
      .default("employee"),
    /**
     * ORG-007 (ADR 0008 decision 13): primary department of the employee
     * created on accept. Required for every role but auditors, who get no
     * employee record and must not carry one.
     */
    departmentId: z.guid().optional(),
    /** TIM-008: last day of access, in the organization's time zone. */
    accessUntil: AccessUntilSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.role === "auditor" && value.accessUntil === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["accessUntil"],
        message: "An access end date is required for auditors",
      });
    }
    if (value.role !== "auditor" && value.departmentId === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["departmentId"],
        message: "A primary department is required",
      });
    }
    if (value.role === "auditor" && value.departmentId !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["departmentId"],
        message: "Auditors do not belong to a department",
      });
    }
    if (value.role !== "auditor" && value.accessUntil !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["accessUntil"],
        message: "An access end date is only allowed for auditors",
      });
    }
  });
export type CreateInvitationRequest = z.infer<
  typeof CreateInvitationRequestSchema
>;

export const InvitationResponseSchema = z.object({
  id: z.guid(),
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
