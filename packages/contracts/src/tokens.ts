import { z } from "zod";

/** Scopes a personal access token can be granted (ADM-006). */
export const PAT_SCOPES = ["read", "write", "admin"] as const;
export const PatScopeSchema = z.enum(PAT_SCOPES);
export type PatScope = z.infer<typeof PatScopeSchema>;

/**
 * Reads a stored scopes value (jsonb array, or a JSON-encoded string written
 * by older code). Unknown or non-string elements are dropped, never cast:
 * dropping a scope can only reduce what a token may do (fail closed), while
 * new tokens with unknown scopes are rejected at creation.
 */
export function parsePatScopes(value: unknown): PatScope[] {
  let raw = value;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];
  const scopes: PatScope[] = [];
  for (const item of raw) {
    const parsed = PatScopeSchema.safeParse(item);
    if (parsed.success && !scopes.includes(parsed.data)) {
      scopes.push(parsed.data);
    }
  }
  return scopes;
}

export const PersonalAccessTokenSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1, "Token name is required"),
  prefix: z.string(),
  scopes: z.array(PatScopeSchema),
  expiresAt: z.string().datetime().nullable(),
  lastUsedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type PersonalAccessTokenItem = z.infer<typeof PersonalAccessTokenSchema>;

export const CreatePersonalAccessTokenSchema = z.object({
  name: z.string().min(1, "Token name is required"),
  scopes: z.array(PatScopeSchema).min(1, "At least one scope is required"),
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
