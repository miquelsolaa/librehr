import { z } from "zod";

export const SignInRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export const UserSessionSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string(),
  activeOrganizationId: z.string().uuid().nullable(),
});
