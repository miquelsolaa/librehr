import crypto from "node:crypto";
import { Hono } from "hono";
import type { Sql } from "postgres";
import {
  type AuthUser,
  SaveSsoConfigRequestSchema,
  SsoAuthorizeRequestSchema,
  createProblemDetails,
} from "@librehr/contracts";
import { buildOidcAuthorizationUrl, isAllowedEmailDomain } from "@librehr/core";
import { withTenant, SsoRepository, AuditRepository } from "@librehr/db";
import { requireAuth } from "../middleware/auth.js";

export function createSsoRoutes(sql: Sql) {
  const router = new Hono();
  const ssoRepo = new SsoRepository();
  const auditRepo = new AuditRepository();

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
        const result = await ssoRepo.saveConfig(tx, parsed.data);
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

    // Lookup active SSO configuration matching domain across organizations
    const rows = await sql<
      {
        id: string;
        organization_id: string;
        provider: string;
        client_id: string;
        issuer_url: string;
        allowed_domains: string[];
      }[]
    >`
      SELECT id, organization_id, provider, client_id, issuer_url, allowed_domains
      FROM sso_configurations
      WHERE enabled = true
    `;

    const match = rows.find((row) =>
      isAllowedEmailDomain(`user@${domain}`, row.allowed_domains),
    );

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
    const redirectUri = `${c.req.url.split("/v1/")[0]}/v1/sso/callback`;

    const authorizationUrl = buildOidcAuthorizationUrl({
      issuerUrl: match.issuer_url,
      clientId: match.client_id,
      redirectUri,
      state,
    });

    return c.json({
      authorizationUrl,
      state,
    });
  });

  return router;
}
