import { z } from "zod";

export const SignInRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});
export type SignInRequest = z.infer<typeof SignInRequestSchema>;

export const AuthUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string(),
  role: z.string(),
  organizationId: z.string().uuid(),
});
export type AuthUser = z.infer<typeof AuthUserSchema>;

export const SessionResponseSchema = z.object({
  user: AuthUserSchema,
  expiresAt: z.string().datetime(),
});
export type SessionResponse = z.infer<typeof SessionResponseSchema>;

export const MeResponseSchema = z.object({
  user: AuthUserSchema,
  organization: z.object({
    id: z.string().uuid(),
    name: z.string(),
    slug: z.string(),
    defaultLocale: z.string(),
    timezone: z.string(),
  }),
  permissions: z.array(z.string()),
});
export type MeResponse = z.infer<typeof MeResponseSchema>;
