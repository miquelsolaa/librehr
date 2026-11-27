import type { Hono } from "hono";
import {
  type AuthUser,
  SaveSsoConfigRequestSchema,
  createProblemDetails,
} from "@librehr/contracts";
import {
  withTenant,
  IdentityRepository,
  SsoRepository,
  AuditRepository,
  SsoClientSecretRequiredError,
  type SsoConfigRow,
} from "@librehr/db";
import type { EeApiExtension, EeExtensionContext } from "../extension.js";
import { registerAuthorizeRoute } from "./authorize.js";
import { registerCallbackRoute } from "./callback.js";
import { createOidcDiscovery, type OidcDiscovery } from "./discovery.js";
import { OidcError } from "./errors.js";

/**
 * AUTH-004 OIDC single sign-on (Business edition, LIC-003). Mounted by the
 * API only when the licence grants `sso`; SSO_ENABLED still gates it until
 * the web app finishes the sign-in.
 */
export const ssoExtension: EeApiExtension = {
  feature: "sso",
  register: registerSsoRoutes,
};

function registerSsoRoutes(router: Hono, context: EeExtensionContext): void {
  const { sql, requireAuth, createError } = context;
  const ssoRepo = new SsoRepository();
  const identityRepo = new IdentityRepository();
  const auditRepo = new AuditRepository();

  if (!context.ssoEnabled) {
    const disabled = () => {
      throw createError({
        status: 404,
        title: "Not Found",
        code: "SSO_DISABLED",
        detail: "Single sign-on is not available on this instance",
      });
    };
    router.all("/", disabled);
    router.all("/*", disabled);
    return;
  }

  const redirectUri = new URL(
    "/v1/sso/callback",
    context.publicApiUrl,
  ).toString();
  // Per process; discovery documents and key sets are cached for an hour.
  const discovery = createOidcDiscovery(context.oidcHttp);
  const toResponse = (config: SsoConfigRow) => ({
    id: config.id,
    organizationId: config.organizationId,
    provider: config.provider,
    clientId: config.clientId,
    issuerUrl: config.issuerUrl,
    enabled: config.enabled,
    enforceSso: config.enforceSso,
    allowedDomains: config.allowedDomains,
    redirectUri,
    createdAt: config.createdAt.toISOString(),
    updatedAt: config.updatedAt.toISOString(),
  });

  // 1. GET /v1/sso/config - View organization SSO configuration (admin/hr)
  router.get("/config", requireAuth, async (c) => {
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

    return c.json(config ? toResponse(config) : null);
  });

  // 2. POST /v1/sso/config - Configure or update SSO settings (admin only)
  router.post("/config", requireAuth, async (c) => {
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
          errors: parsed.error.issues.map((e) => ({
            field: e.path.join("."),
            message: e.message,
          })),
        }),
        400,
        { "Content-Type": "application/problem+json" },
      );
    }

    // A disabled configuration may be saved while the provider is down, and
    // claims no domain.
    if (parsed.data.enabled) {
      // Authorize resolves a domain to one organization: refuse to claim a
      // domain another organization already signs in with, so a tenant
      // cannot send another tenant's people to its own provider.
      const taken = await withTenant(
        sql,
        { organizationId: user.organizationId, userId: user.id },
        (tx) => identityRepo.ssoDomainsTaken(tx, parsed.data.allowedDomains),
      );
      if (taken.length > 0) {
        throw createError({
          status: 400,
          title: "Validation Error",
          code: "VALIDATION_ERROR",
          detail: "Invalid SSO configuration payload",
          errors: [
            {
              field: "allowedDomains",
              message: `Already used for single sign-on by another organization: ${taken.join(", ")}`,
            },
          ],
        });
      }
      await assertUsableIssuer(discovery, parsed.data.issuerUrl, createError);
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

    return c.json(toResponse(saved));
  });

  registerAuthorizeRoute(router, { context, discovery, redirectUri });
  registerCallbackRoute(router, { context, discovery, redirectUri });
}

/**
 * Refuses an issuer sign-in could not use: not https, a Microsoft
 * multi-tenant endpoint, or no valid discovery document reachable through
 * the outbound guard (which also refuses internal addresses).
 */
async function assertUsableIssuer(
  discovery: OidcDiscovery,
  issuerUrl: string,
  createError: EeExtensionContext["createError"],
): Promise<void> {
  try {
    await discovery.discover(issuerUrl);
  } catch (error) {
    if (!(error instanceof OidcError)) throw error;
    throw createError({
      status: 400,
      title: "Validation Error",
      code: "VALIDATION_ERROR",
      detail: "Invalid SSO configuration payload",
      errors: [
        {
          field: "issuerUrl",
          message:
            error.reason === "issuer_not_supported"
              ? "Use an https issuer; Microsoft needs a tenant-specific issuer"
              : "The issuer's discovery document could not be read",
        },
      ],
    });
  }
}
