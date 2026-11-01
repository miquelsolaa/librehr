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
