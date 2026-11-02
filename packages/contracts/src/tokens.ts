import { z } from "zod";

export const PersonalAccessTokenSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1, "Token name is required"),
  prefix: z.string(),
  scopes: z.array(z.string()),
  expiresAt: z.string().datetime().nullable(),
  lastUsedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type PersonalAccessTokenItem = z.infer<typeof PersonalAccessTokenSchema>;

export const CreatePersonalAccessTokenSchema = z.object({
  name: z.string().min(1, "Token name is required"),
  scopes: z.array(z.string()).min(1, "At least one scope is required"),
  expiresInDays: z.number().int().positive().optional(),
});
export type CreatePersonalAccessToken = z.infer<
  typeof CreatePersonalAccessTokenSchema
>;

export const TokenCreatedResponseSchema = z.object({
  token: PersonalAccessTokenSchema,
  plainToken: z.string(), // Revealed once
});
export type TokenCreatedResponse = z.infer<typeof TokenCreatedResponseSchema>;
