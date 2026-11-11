import { Hono } from "hono";
import type {
  AuthUser,
  EditionResponse,
  LicenseState,
} from "@librehr/contracts";
import { requireAuth } from "../middleware/auth.js";

/**
 * LIC-001: `GET /v1/edition`. Every signed-in user may see the edition and
 * features (the UI needs them); the licensee and expiry are admin-only.
 */
export function createEditionRoutes(license: LicenseState) {
  const router = new Hono();

  router.get("/edition", requireAuth, (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;
    const body: EditionResponse = {
      edition: license.edition,
      licenseStatus: license.licenseStatus,
      features: [...license.features],
    };
    if (user.role === "admin") {
      if (license.licensee !== undefined) body.licensee = license.licensee;
      if (license.expiresAt !== undefined) body.expiresAt = license.expiresAt;
    }
    return c.json(body);
  });

  return router;
}
