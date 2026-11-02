import { Hono } from "hono";
import type { Sql } from "postgres";
import type { AuthUser } from "@librehr/contracts";
import { ROLE_PERMISSIONS, createProblemDetails } from "@librehr/contracts";
import { requireAuth } from "../middleware/auth.js";

export function createMeRoutes(sql: Sql) {
  const router = new Hono();

  router.get("/me", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;

    // Load active organization details
    const orgs = await sql<
      {
        id: string;
        name: string;
        slug: string;
        default_locale: string;
        timezone: string;
        require_two_factor: boolean;
      }[]
    >`
      SELECT id, name, slug, default_locale, timezone, COALESCE(require_two_factor, false) as require_two_factor
      FROM organizations
      WHERE id = ${user.organizationId}
      LIMIT 1
    `;

    const org = orgs[0];
    if (!org) {
      const problem = createProblemDetails({
        status: 404,
        title: "Not Found",
        detail: "Organization not found",
        code: "ORG_NOT_FOUND",
      });
      return c.json(problem, 404, {
        "Content-Type": "application/problem+json",
      });
    }

    const permissions = (ROLE_PERMISSIONS[user.role] ?? []).map(
      (p) => p.permission,
    );

    return c.json({
      user,
      organization: {
        id: org.id,
        name: org.name,
        slug: org.slug,
        defaultLocale: org.default_locale,
        timezone: org.timezone,
        requireTwoFactor: org.require_two_factor,
      },
      permissions,
    });
  });

  return router;
}
