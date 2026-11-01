import { z } from "zod";

export const OrganizationResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  defaultLocale: z.enum(["ca", "es", "en"]),
  timezone: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type OrganizationResponse = z.infer<typeof OrganizationResponseSchema>;

export const UpdateOrganizationSchema = z.object({
  name: z.string().min(2).optional(),
  defaultLocale: z.enum(["ca", "es", "en"]).optional(),
  timezone: z.string().optional(),
});
export type UpdateOrganization = z.infer<typeof UpdateOrganizationSchema>;

export const DepartmentSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  name: z.string(),
  parentId: z.string().uuid().nullable(),
  leadEmployeeId: z.string().uuid().nullable(),
  parentName: z.string().nullable().optional(),
  leadName: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Department = z.infer<typeof DepartmentSchema>;

export const CreateDepartmentRequestSchema = z.object({
  name: z.string().min(1, "Department name is required"),
  parentId: z.string().uuid().nullable().optional(),
  leadEmployeeId: z.string().uuid().nullable().optional(),
});
export type CreateDepartmentRequest = z.infer<
  typeof CreateDepartmentRequestSchema
>;

export const LocationSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  legalEntityId: z.string().uuid(),
  name: z.string(),
  country: z.string(),
  region: z.string(),
  city: z.string(),
  timezone: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Location = z.infer<typeof LocationSchema>;

export const CreateLocationRequestSchema = z.object({
  legalEntityId: z.string().uuid(),
  name: z.string().min(1, "Location name is required"),
  country: z.string().default("ES"),
  region: z.string().min(1, "Region / Autonomous community is required"),
  city: z.string().min(1, "City is required"),
  timezone: z.string().default("Europe/Madrid"),
});
export type CreateLocationRequest = z.infer<typeof CreateLocationRequestSchema>;

export const LegalEntitySchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  name: z.string(),
  cif: z.string(),
  country: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type LegalEntity = z.infer<typeof LegalEntitySchema>;

export const CreateLegalEntityRequestSchema = z.object({
  name: z.string().min(1, "Legal entity name is required"),
  cif: z.string().min(1, "Tax ID / CIF is required"),
  country: z.string().default("ES"),
});
export type CreateLegalEntityRequest = z.infer<
  typeof CreateLegalEntityRequestSchema
>;

export const SetupWizardRequestSchema = z.object({
  orgName: z
    .string()
    .min(2, "Organization name must have at least 2 characters"),
  orgSlug: z
    .string()
    .min(2, "Slug must have at least 2 characters")
    .regex(
      /^[a-z0-9-]+$/,
      "Slug must only contain lowercase letters, numbers, and dashes",
    ),
  adminName: z.string().min(1, "Admin name is required"),
  adminEmail: z.string().email("Valid admin email is required"),
  adminPassword: z.string().min(8, "Password must have at least 8 characters"),
  defaultLocale: z.enum(["ca", "es", "en"]).default("es"),
  timezone: z.string().default("Europe/Madrid"),
  legalEntityName: z.string().min(2, "Legal entity name is required"),
  legalEntityCif: z.string().min(8, "Valid CIF is required"),
  locationName: z.string().min(2, "Location name is required"),
  locationCity: z.string().min(2, "City is required"),
  locationRegion: z
    .string()
    .min(2, "Autonomous community / region is required"),
});
export type SetupWizardRequest = z.infer<typeof SetupWizardRequestSchema>;
