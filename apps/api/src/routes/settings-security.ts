import { Hono } from "hono";
import type { Sql } from "postgres";
import {
  type AuthUser,
  UpdateOrgSecuritySettingsSchema,
  createProblemDetails,
} from "@librehr/contracts";
import {
  withTenant,
  OrganizationRepository,
  AuditRepository,
} from "@librehr/db";
import { requireAuth } from "../middleware/auth.js";
import { can } from "../policies/can.js";

export function createSettingsSecurityRoutes(sql: Sql) {
  const router = new Hono();
  const orgRepo = new OrganizationRepository();
  const auditRepo = new AuditRepository();

  // 1. GET /v1/settings/security - Get organization security settings
  router.get("/settings/security", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;

    const org = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        return orgRepo.findById(tx, user.organizationId);
      },
    );

    if (!org) {
      return c.json(
        createProblemDetails({
          status: 404,
          title: "Not Found",
          detail: "Organization not found",
          code: "ORG_NOT_FOUND",
        }),
        404,
        { "Content-Type": "application/problem+json" },
      );
    }

    return c.json({
      requireTwoFactor: org.requireTwoFactor,
      auditorAccessMaxDays: org.auditorAccessMaxDays,
    });
  });

  // 2. PATCH /v1/settings/security - Update organization security settings (admin only)
  router.patch("/settings/security", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;

    if (
      !can(
        {
          userId: user.id,
          role: user.role,
          organizationId: user.organizationId,
        },
        "org.write",
      )
    ) {
      return c.json(
        createProblemDetails({
          status: 403,
          title: "Forbidden",
          detail: "Only organization admins can update security settings",
          code: "FORBIDDEN",
        }),
        403,
        { "Content-Type": "application/problem+json" },
      );
    }

    const body = await c.req.json();
    const parsed = UpdateOrgSecuritySettingsSchema.safeParse(body);

    if (!parsed.success) {
      return c.json(
        createProblemDetails({
          status: 400,
          title: "Validation Error",
          detail: "Invalid security settings payload",
          code: "VALIDATION_ERROR",
        }),
        400,
        { "Content-Type": "application/problem+json" },
      );
    }

    const stored = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        const updated = await orgRepo.updateSecuritySettings(
          tx,
          user.organizationId,
          {
            requireTwoFactor: parsed.data.requireTwoFactor,
            auditorAccessMaxDays: parsed.data.auditorAccessMaxDays,
          },
        );
        // Only the settings sent are logged (TIM-008: the auditor access
        // maximum is one of them).
        const metadata: Record<string, unknown> = {};
        if (parsed.data.requireTwoFactor !== undefined)
          metadata["requireTwoFactor"] = parsed.data.requireTwoFactor;
        if (parsed.data.auditorAccessMaxDays !== undefined)
          metadata["auditorAccessMaxDays"] = parsed.data.auditorAccessMaxDays;
        await auditRepo.log(tx, {
          actorId: user.id,
          action: "organization.security_updated",
          resourceType: "organizations",
          resourceId: user.organizationId,
          metadata,
        });
        return updated;
      },
    );

    if (!stored) {
      return c.json(
        createProblemDetails({
          status: 404,
          title: "Not Found",
          detail: "Organization not found",
          code: "ORG_NOT_FOUND",
        }),
        404,
        { "Content-Type": "application/problem+json" },
      );
    }

    return c.json(stored);
  });

  return router;
}
