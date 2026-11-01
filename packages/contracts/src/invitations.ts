import { z } from "zod";

export const CreateInvitationRequestSchema = z.object({
  email: z.string().email("Valid email is required"),
  role: z.enum(["admin", "manager", "employee"]).default("employee"),
  departmentId: z.string().uuid().nullable().optional(),
});
export type CreateInvitationRequest = z.infer<
  typeof CreateInvitationRequestSchema
>;

export const InvitationResponseSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  role: z.string(),
  expiresAt: z.string().datetime(),
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
