import crypto from "node:crypto";
import type { Hono } from "hono";
import {
  type AuthUser,
  SaveSsoConfigRequestSchema,
  SsoAuthorizeRequestSchema,
  createProblemDetails,
} from "@librehr/contracts";
import {
  withTenant,
  SsoRepository,
  AuditRepository,
  IdentityRepository,
  SsoClientSecretRequiredError,
} from "@librehr/db";
import type { EeApiExtension, EeExtensionContext } from "../extension.js";
import { buildOidcAuthorizationUrl, isAllowedEmailDomain } from "./oidc.js";

/**
 * AUTH-004 OIDC single sign-on (Business edition, LIC-003). Mounted by the
 * API only when the licence grants `sso`; SSO_ENABLED still gates it because
 * the callback is not built yet.
 */
export const ssoExtension: EeApiExtension = {
  feature: "sso",
  register: registerSsoRoutes,
};

function registerSsoRoutes(router: Hono, context: EeExtensionContext): void {
  const { sql, requireAuth, createError } = context;
  const ssoRepo = new SsoRepository();
  const auditRepo = new AuditRepository();
  const identityRepo = new IdentityRepository();

  if (!context.ssoEnabled) {
    const disabled = () => {
      throw createError({
        status: 404,
        title: "Not Found",
        code: "SSO_DISABLED",
        detail: "Single sign-on is not available on this instance",
      });
    };
    router.all("/sso", disabled);
    router.all("/sso/*", disabled);
    return;
  }

  const redirectUri = new URL(
    "/v1/sso/callback",
    context.publicApiUrl,
  ).toString();

  // 1. GET /v1/sso/config - View organization SSO configuration (admin/hr)
  router.get("/sso/config", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;

    if (user.role !== "admin" && user.role !== "hr_admin") {
      return c.json(
        createProblemDetails({
          status: 403,
          title: "Forbidden",
          detail: "Only administrators can view SSO configuration",
          code: "FORBIDDEN",
        }),
        403,
        { "Content-Type": "application/problem+json" },
      );
    }

    const config = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        return ssoRepo.getConfig(tx);
      },
    );

    if (!config) {
      return c.json(null);
    }

    return c.json({
      id: config.id,
      organizationId: config.organizationId,
      provider: config.provider,
      clientId: config.clientId,
      issuerUrl: config.issuerUrl,
      enabled: config.enabled,
      enforceSso: config.enforceSso,
      allowedDomains: config.allowedDomains,
      createdAt: config.createdAt.toISOString(),
      updatedAt: config.updatedAt.toISOString(),
    });
  });

  // 2. POST /v1/sso/config - Configure or update SSO settings (admin only)
  router.post("/sso/config", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;

    if (user.role !== "admin") {
      return c.json(
        createProblemDetails({
          status: 403,
          title: "Forbidden",
          detail: "Only organization admins can configure SSO",
          code: "FORBIDDEN",
        }),
        403,
        { "Content-Type": "application/problem+json" },
      );
    }

    const body = await c.req.json();
    const parsed = SaveSsoConfigRequestSchema.safeParse(body);

    if (!parsed.success) {
      return c.json(
        createProblemDetails({
          status: 400,
          title: "Validation Error",
          detail: "Invalid SSO configuration payload",
          code: "VALIDATION_ERROR",
          errors: parsed.error.errors.map((e) => ({
            field: e.path.join("."),
            message: e.message,
          })),
        }),
        400,
        { "Content-Type": "application/problem+json" },
      );
    }

    const saved = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        const result = await ssoRepo
          .saveConfig(tx, parsed.data)
          .catch((err: unknown) => {
            if (err instanceof SsoClientSecretRequiredError) {
              throw createError({
                status: 400,
                title: "Validation Error",
                code: "VALIDATION_ERROR",
                detail: "Invalid SSO configuration payload",
                errors: [
                  {
                    field: "clientSecret",
                    message: "Client Secret is required",
                  },
                ],
              });
            }
            throw err;
          });
        await auditRepo.log(tx, {
          actorId: user.id,
          action: "sso_config.updated",
          resourceType: "sso_configurations",
          resourceId: result.id,
          metadata: {
            provider: parsed.data.provider,
            enabled: parsed.data.enabled,
            enforceSso: parsed.data.enforceSso,
            allowedDomains: parsed.data.allowedDomains,
          },
        });
        return result;
      },
    );

    return c.json({
      id: saved.id,
      organizationId: saved.organizationId,
      provider: saved.provider,
      clientId: saved.clientId,
      issuerUrl: saved.issuerUrl,
      enabled: saved.enabled,
      enforceSso: saved.enforceSso,
      allowedDomains: saved.allowedDomains,
      createdAt: saved.createdAt.toISOString(),
      updatedAt: saved.updatedAt.toISOString(),
    });
  });

  // 3. POST /v1/sso/authorize - Initiate SSO flow
  router.post("/sso/authorize", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = SsoAuthorizeRequestSchema.safeParse(body);

    if (!parsed.success) {
      return c.json(
        createProblemDetails({
          status: 400,
          title: "Validation Error",
          detail: "Invalid SSO authorize request",
          code: "VALIDATION_ERROR",
        }),
        400,
        { "Content-Type": "application/problem+json" },
      );
    }

    const email = parsed.data.email;
    const domain =
      parsed.data.domain ?? (email ? email.split("@")[1] : undefined);

    if (!domain) {
      return c.json(
        createProblemDetails({
          status: 400,
          title: "Missing Domain",
          detail:
            "Email or company domain is required to discover SSO provider",
          code: "MISSING_DOMAIN",
        }),
        400,
        { "Content-Type": "application/problem+json" },
      );
    }

    // Discovery runs before any tenant context: the identity lookup returns
    // only the matching enabled configuration, never the client secret.
    const config = await identityRepo.ssoConfigForDomain(sql, domain);
    const match =
      config && isAllowedEmailDomain(`user@${domain}`, config.allowedDomains)
        ? config
        : null;

    if (!match) {
      return c.json(
        createProblemDetails({
          status: 404,
          title: "SSO Not Configured",
          detail: `No active SSO configuration found for domain '${domain}'`,
          code: "SSO_NOT_FOUND",
        }),
        404,
        { "Content-Type": "application/problem+json" },
      );
    }

    const state = crypto.randomBytes(16).toString("hex");

    const authorizationUrl = buildOidcAuthorizationUrl({
      issuerUrl: match.issuerUrl,
      clientId: match.clientId,
      redirectUri,
      state,
    });

    return c.json({
      authorizationUrl,
      state,
    });
  });
}
