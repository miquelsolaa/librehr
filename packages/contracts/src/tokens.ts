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

/** Scopes enforced by the API for token-authenticated requests (ADM-006). */
export const PersonalAccessTokenScopeSchema = z.enum([
  "read",
  "write",
  "admin",
]);
export type PersonalAccessTokenScope = z.infer<
  typeof PersonalAccessTokenScopeSchema
>;

export const CreatePersonalAccessTokenSchema = z.object({
  name: z.string().min(1, "Token name is required"),
  scopes: z
    .array(PersonalAccessTokenScopeSchema)
    .min(1, "At least one scope is required"),
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
