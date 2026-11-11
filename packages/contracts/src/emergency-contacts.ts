import { z } from "zod";

export const EmergencyContactSchema = z.object({
  id: z.guid(),
  organizationId: z.guid(),
  employeeId: z.guid(),
  fullName: z.string().min(1, "Full name is required"),
  relationship: z.string().min(1, "Relationship is required"),
  phonePrimary: z.string().min(1, "Primary phone is required"),
  phoneSecondary: z.string().nullable(),
  isPrimary: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type EmergencyContact = z.infer<typeof EmergencyContactSchema>;

export const CreateEmergencyContactSchema = z.object({
  fullName: z.string().min(1, "Full name is required"),
  relationship: z.string().min(1, "Relationship is required"),
  phonePrimary: z.string().min(1, "Primary phone is required"),
  phoneSecondary: z.string().nullable().optional(),
  isPrimary: z.boolean().optional(),
});
export type CreateEmergencyContact = z.infer<
  typeof CreateEmergencyContactSchema
>;

export const UpdateEmergencyContactSchema = z.object({
  fullName: z.string().min(1).optional(),
  relationship: z.string().min(1).optional(),
  phonePrimary: z.string().min(1).optional(),
  phoneSecondary: z.string().nullable().optional(),
  isPrimary: z.boolean().optional(),
});
export type UpdateEmergencyContact = z.infer<
  typeof UpdateEmergencyContactSchema
>;
