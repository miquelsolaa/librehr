import { Hono } from "hono";
import type { Sql } from "postgres";
import type { AuthUser } from "@openhr/contracts";
import { createProblemDetails } from "@openhr/contracts";
import { requireAuth } from "../middleware/auth.js";

export function createOrgRoutes(sql: Sql) {
  const router = new Hono();

  router.get("/org", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;

    const orgs = await sql<
      {
        id: string;
        name: string;
        slug: string;
        default_locale: "ca" | "es" | "en";
        timezone: string;
        created_at: Date;
        updated_at: Date;
      }[]
    >`
      SELECT id, name, slug, default_locale, timezone, created_at, updated_at
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

    return c.json({
      id: org.id,
      name: org.name,
      slug: org.slug,
      defaultLocale: org.default_locale,
      timezone: org.timezone,
      createdAt: new Date(org.created_at).toISOString(),
      updatedAt: new Date(org.updated_at).toISOString(),
    });
  });

  return router;
}
