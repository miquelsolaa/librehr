import { z } from "zod";
import { AuditorAccessMaxDaysSchema } from "./auditor-access.js";

export const SignInRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  // 6-digit TOTP or recovery code; bounded like /2fa/verify and /2fa/disable.
  twoFactorCode: z.string().trim().min(6).max(64).optional(),
});
export type SignInRequest = z.infer<typeof SignInRequestSchema>;

/**
 * AUTH-001: asks for a password reset link. The API answers 202 whether or
 * not the email belongs to an account. `locale` picks the email language and
 * the web path of the link.
 */
export const PasswordResetRequestSchema = z.object({
  email: z.string().trim().email().max(320),
  locale: z.enum(["ca", "es", "en"]).optional(),
});
export type PasswordResetRequest = z.infer<typeof PasswordResetRequestSchema>;

/** AUTH-001: sets a new password with the token from a reset link. */
export const PasswordResetConfirmSchema = z.object({
  token: z.string().min(20).max(200),
  password: z
    .string()
    .min(8, "Password must have at least 8 characters")
    .max(1024),
});
export type PasswordResetConfirm = z.infer<typeof PasswordResetConfirmSchema>;

export const AuthUserSchema = z.object({
  id: z.guid(),
  email: z.string().email(),
  name: z.string(),
  role: z.string(),
  organizationId: z.guid(),
  twoFactorEnabled: z.boolean().optional(),
});
export type AuthUser = z.infer<typeof AuthUserSchema>;

export const SessionResponseSchema = z.object({
  user: AuthUserSchema,
  expiresAt: z.string().datetime(),
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
    id: z.guid(),
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

/**
 * Confirms the pending setup from /2fa/setup with a current TOTP code. The
 * secret and recovery codes stay on the server; strict, so a client still
 * sending them is refused instead of silently ignored.
 */
export const TwoFactorEnableRequestSchema = z
  .object({
    code: z
      .string()
      .trim()
      .regex(/^\d{6}$/, "Enter the 6-digit code from your authenticator"),
  })
  .strict();
export type TwoFactorEnableRequest = z.infer<
  typeof TwoFactorEnableRequestSchema
>;

/**
 * Enabling 2FA ends the account's other sessions and revokes its personal
 * access tokens in every organization (issue #35): a token created by
 * someone holding only the password must not outlive the second factor.
 */
export const TwoFactorEnableResponseSchema = z.object({
  success: z.literal(true),
  /** Personal access tokens revoked by this change; the UI tells the user. */
  revokedTokens: z.number().int().nonnegative(),
});
export type TwoFactorEnableResponse = z.infer<
  typeof TwoFactorEnableResponseSchema
>;

export const TwoFactorVerifyRequestSchema = z.object({
  challengeToken: z.string().min(1),
  // 6-digit TOTP or recovery code (xxxx-xxxx-xxxx-xxxx; older xxxx-xxxx codes still work)
  code: z.string().trim().min(6).max(64),
});
export type TwoFactorVerifyRequest = z.infer<
  typeof TwoFactorVerifyRequestSchema
>;

// AUTH-003: disabling requires a current TOTP code or an unused recovery code.
export const TwoFactorDisableRequestSchema = z.object({
  code: z.string().trim().min(6).max(64),
});
export type TwoFactorDisableRequest = z.infer<
  typeof TwoFactorDisableRequestSchema
>;

export const OrgSecuritySettingsSchema = z.object({
  requireTwoFactor: z.boolean(),
  /** TIM-008: maximum days ahead an auditor's access end date may be set. */
  auditorAccessMaxDays: AuditorAccessMaxDaysSchema,
});
export type OrgSecuritySettings = z.infer<typeof OrgSecuritySettingsSchema>;

/** Partial update: at least one setting must be present. */
export const UpdateOrgSecuritySettingsSchema = z
  .object({
    requireTwoFactor: z.boolean().optional(),
    auditorAccessMaxDays: AuditorAccessMaxDaysSchema.optional(),
  })
  .refine(
    (value) =>
      value.requireTwoFactor !== undefined ||
      value.auditorAccessMaxDays !== undefined,
    { message: "At least one setting is required" },
  );
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
  id: z.guid(),
  organizationId: z.guid(),
  provider: SsoProviderSchema,
  clientId: z.string(),
  issuerUrl: z.string(),
  enabled: z.boolean(),
  enforceSso: z.boolean(),
  allowedDomains: z.array(z.string()),
  /**
   * The redirect URI to register with the identity provider, derived from
   * the API's configured public URL. Business edition only.
   */
  redirectUri: z.string().url().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type SsoConfig = z.infer<typeof SsoConfigSchema>;

export const SaveSsoConfigRequestSchema = z.object({
  provider: SsoProviderSchema,
  clientId: z.string().min(1, "Client ID is required"),
  /**
   * Write-only. Omit it to keep the stored secret; required for the first
   * configuration and whenever the provider, client id or issuer changes.
   * It is stored encrypted and never returned.
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
  /** Language of the pages the callback redirects to; defaults to ca. */
  locale: z.enum(["ca", "es", "en"]).optional(),
});
export type SsoAuthorizeRequest = z.infer<typeof SsoAuthorizeRequestSchema>;

/**
 * `state` is not returned: the API keeps it server-side and binds the flow
 * to the browser with an HttpOnly cookie read by the callback.
 */
export const SsoAuthorizeResponseSchema = z.object({
  authorizationUrl: z.string().url(),
});
export type SsoAuthorizeResponse = z.infer<typeof SsoAuthorizeResponseSchema>;

/**
 * Why GET /v1/sso/callback sent the browser back to the sign-in page, as
 * the `sso_error` query parameter. Only codes reached after the identity
 * provider authenticated the person name the cause; state and token
 * failures stay generic.
 */
export const SsoErrorCodeSchema = z.enum([
  "SSO_STATE_INVALID",
  "SSO_EXPIRED",
  "SSO_PROVIDER_ERROR",
  "SSO_EXCHANGE_FAILED",
  "SSO_TOKEN_INVALID",
  "SSO_EMAIL_NOT_VERIFIED",
  "SSO_DOMAIN_NOT_ALLOWED",
  "SSO_NO_ACCOUNT",
  "SSO_IDENTITY_CONFLICT",
  "SSO_UNAVAILABLE",
]);
export type SsoErrorCode = z.infer<typeof SsoErrorCodeSchema>;
