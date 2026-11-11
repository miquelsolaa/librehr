import { Hono } from "hono";
import type { BusinessFeature } from "@librehr/contracts";
import { LicenseRequiredError } from "../errors/index.js";
import { createStoredSsoConfigRoutes } from "../routes/sso-stored-config.js";
import type { ApiExtension, ExtensionContext } from "./types.js";

/**
 * Route prefix (under `/v1`) owned by each Business feature. A prefix whose
 * feature is not licensed answers 403 LICENSE_REQUIRED (LIC-003), also in a
 * Community build without `ee/`.
 */
export const BUSINESS_ROUTE_PREFIXES: Record<BusinessFeature, string> = {
  sso: "/sso",
};

/**
 * Mounts each licensed extension under its own prefix, so an extension can
 * never answer a route outside it, and a LICENSE_REQUIRED guard on every
 * other Business prefix. Call after the core routes.
 */
export function mountBusinessRoutes(
  app: Hono,
  extensions: readonly ApiExtension[],
  context: ExtensionContext,
): void {
  const mounted = new Set<BusinessFeature>();
  for (const extension of extensions) {
    const router = new Hono();
    extension.register(router, context);
    app.route(`/v1${BUSINESS_ROUTE_PREFIXES[extension.feature]}`, router);
    mounted.add(extension.feature);
  }

  for (const [feature, prefix] of Object.entries(BUSINESS_ROUTE_PREFIXES) as [
    BusinessFeature,
    string,
  ][]) {
    if (mounted.has(feature)) continue;
    // LIC-003: what a lapsed licence leaves behind stays readable.
    if (feature === "sso") {
      app.route(
        "/v1",
        createStoredSsoConfigRoutes(context.sql, context.requireAuth),
      );
    }
    const guard = () => {
      throw new LicenseRequiredError();
    };
    app.all(`/v1${prefix}`, guard);
    app.all(`/v1${prefix}/*`, guard);
  }
}
