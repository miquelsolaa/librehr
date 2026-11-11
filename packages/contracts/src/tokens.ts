import { z } from "zod";

/** Scopes enforced by the API for token-authenticated requests (ADM-006). */
export const PAT_SCOPES = ["read", "write", "admin"] as const;
export const PersonalAccessTokenScopeSchema = z.enum(PAT_SCOPES);
export type PersonalAccessTokenScope = z.infer<
  typeof PersonalAccessTokenScopeSchema
>;

/**
 * Reads a stored scopes value (jsonb array, or a JSON-encoded string written
 * by older code). Unknown or non-string elements are dropped, never cast:
 * dropping a scope can only reduce what a token may do (fail closed), while
 * new tokens with unknown scopes are rejected at creation.
 */
export function parsePatScopes(value: unknown): PersonalAccessTokenScope[] {
  let raw = value;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];
  const scopes: PersonalAccessTokenScope[] = [];
  for (const item of raw) {
    const parsed = PersonalAccessTokenScopeSchema.safeParse(item);
    if (parsed.success && !scopes.includes(parsed.data)) {
      scopes.push(parsed.data);
    }
  }
  return scopes;
}

export const PersonalAccessTokenSchema = z.object({
  id: z.guid(),
  name: z.string().min(1, "Token name is required"),
  prefix: z.string(),
  scopes: z.array(PersonalAccessTokenScopeSchema),
  expiresAt: z.string().datetime().nullable(),
  lastUsedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type PersonalAccessTokenItem = z.infer<typeof PersonalAccessTokenSchema>;

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
