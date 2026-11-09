import { z } from "zod";

export const SignInRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  twoFactorCode: z.string().optional(),
});
export type SignInRequest = z.infer<typeof SignInRequestSchema>;

export const AuthUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string(),
  role: z.string(),
  organizationId: z.string().uuid(),
  twoFactorEnabled: z.boolean().optional(),
});
export type AuthUser = z.infer<typeof AuthUserSchema>;

export const SessionResponseSchema = z.object({
  user: AuthUserSchema,
  expiresAt: z.string().datetime(),
  token: z.string().optional(),
});
export type SessionResponse = z.infer<typeof SessionResponseSchema>;

export const SignInResultSchema = z.union([
  SessionResponseSchema,
  z.object({
    requiresTwoFactor: z.literal(true),
    challengeToken: z.string(),
  }),
]);
export type SignInResult = z.infer<typeof SignInResultSchema>;

export const MeResponseSchema = z.object({
  user: AuthUserSchema,
  organization: z.object({
    id: z.string().uuid(),
    name: z.string(),
    slug: z.string(),
    defaultLocale: z.string(),
    timezone: z.string(),
    requireTwoFactor: z.boolean().optional(),
  }),
  permissions: z.array(z.string()),
});
export type MeResponse = z.infer<typeof MeResponseSchema>;

// AUTH-003: 2FA TOTP Schemas
export const TwoFactorSetupResponseSchema = z.object({
  secret: z.string(),
  qrUri: z.string(),
  recoveryCodes: z.array(z.string()),
});
export type TwoFactorSetupResponse = z.infer<
  typeof TwoFactorSetupResponseSchema
>;

export const TwoFactorEnableRequestSchema = z.object({
  code: z.string().min(6).max(6),
  secret: z.string().min(16),
  recoveryCodes: z.array(z.string()),
});
export type TwoFactorEnableRequest = z.infer<
  typeof TwoFactorEnableRequestSchema
>;

export const TwoFactorVerifyRequestSchema = z.object({
  challengeToken: z.string().min(1),
  code: z.string().min(6), // 6-digit TOTP or xxxx-xxxx recovery code
});
export type TwoFactorVerifyRequest = z.infer<
  typeof TwoFactorVerifyRequestSchema
>;

export const TwoFactorDisableRequestSchema = z.object({
  code: z.string().optional(),
});
export type TwoFactorDisableRequest = z.infer<
  typeof TwoFactorDisableRequestSchema
>;

export const OrgSecuritySettingsSchema = z.object({
  requireTwoFactor: z.boolean(),
});
export type OrgSecuritySettings = z.infer<typeof OrgSecuritySettingsSchema>;

export const UpdateOrgSecuritySettingsSchema = z.object({
  requireTwoFactor: z.boolean(),
});
export type UpdateOrgSecuritySettings = z.infer<
  typeof UpdateOrgSecuritySettingsSchema
>;

// AUTH-004: SSO OIDC Schemas
export const SsoProviderSchema = z.enum([
  "google",
  "microsoft",
  "generic_oidc",
]);
export type SsoProvider = z.infer<typeof SsoProviderSchema>;

export const SsoConfigSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  provider: SsoProviderSchema,
  clientId: z.string(),
  issuerUrl: z.string(),
  enabled: z.boolean(),
  enforceSso: z.boolean(),
  allowedDomains: z.array(z.string()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type SsoConfig = z.infer<typeof SsoConfigSchema>;

export const SaveSsoConfigRequestSchema = z.object({
  provider: SsoProviderSchema,
  clientId: z.string().min(1, "Client ID is required"),
  /**
   * Write-only. Omit it to keep the stored secret; required for the first
   * configuration. It is stored encrypted and never returned.
   */
  clientSecret: z.string().min(1, "Client Secret is required").optional(),
  issuerUrl: z.string().min(1, "Issuer URL is required"),
  enabled: z.boolean().default(true),
  enforceSso: z.boolean().default(false),
  allowedDomains: z.array(z.string()).min(1, "At least one domain is required"),
});
export type SaveSsoConfigRequest = z.infer<typeof SaveSsoConfigRequestSchema>;

export const SsoAuthorizeRequestSchema = z.object({
  email: z.string().email().optional(),
  domain: z.string().optional(),
});
export type SsoAuthorizeRequest = z.infer<typeof SsoAuthorizeRequestSchema>;

export const SsoAuthorizeResponseSchema = z.object({
  authorizationUrl: z.string().url(),
  state: z.string(),
});
export type SsoAuthorizeResponse = z.infer<typeof SsoAuthorizeResponseSchema>;
