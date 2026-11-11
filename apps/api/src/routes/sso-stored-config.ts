import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import type { Sql } from "postgres";
import type { AuthUser } from "@librehr/contracts";
import {
  withTenant,
  SsoRepository,
  AuditRepository,
  type SsoConfigRow,
} from "@librehr/db";
import { ForbiddenError, NotFoundError } from "../errors/index.js";

function toResponse(config: SsoConfigRow) {
  return {
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
  };
}

/**
 * What stays in Community when single sign-on is not licensed (LIC-003):
 * data stored by a Business feature is never hidden when the licence lapses.
 * Administrators can still read the stored configuration and switch it off;
 * creating or changing it needs the licence. The client secret is never
 * returned. Mounted only while the `sso` feature is unlicensed.
 */
export function createStoredSsoConfigRoutes(
  sql: Sql,
  requireAuth: MiddlewareHandler,
) {
  const router = new Hono();
  const ssoRepo = new SsoRepository();
  const auditRepo = new AuditRepository();

  router.get("/sso/config", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;
    if (user.role !== "admin" && user.role !== "hr_admin") {
      throw new ForbiddenError({
        detail: "Only administrators can view SSO configuration",
      });
    }
    const config = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      (tx) => ssoRepo.getConfig(tx),
    );
    return c.json(config ? toResponse(config) : null);
  });

  router.post("/sso/config/disable", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;
    if (user.role !== "admin") {
      throw new ForbiddenError({
        detail: "Only organization admins can disable SSO",
      });
    }
    const config = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        const disabled = await ssoRepo.disableConfig(tx);
        if (!disabled) return null;
        await auditRepo.log(tx, {
          actorId: user.id,
          action: "sso_config.disabled",
          resourceType: "sso_configurations",
          resourceId: disabled.id,
          metadata: { reason: "license_required" },
        });
        return disabled;
      },
    );
    if (!config)
      throw new NotFoundError({ detail: "No SSO configuration is stored" });
    return c.json(toResponse(config));
  });

  return router;
}
