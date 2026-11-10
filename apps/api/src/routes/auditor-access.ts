import { Hono } from "hono";
import type { Context } from "hono";
import type { Sql } from "postgres";
import { z } from "zod";
import {
  type AuthUser,
  type Auditor,
  UpdateAuditorAccessRequestSchema,
} from "@librehr/contracts";
import {
  withTenant,
  AuditRepository,
  AuditorAccessRepository,
  type AuditorRow,
} from "@librehr/db";
import { ForbiddenError, NotFoundError } from "../errors/index.js";
import { assertAuditorAccessEnd } from "../lib/auditor-access.js";
import { parseJsonBody, parseParams } from "../lib/validate.js";
import { requireAuth } from "../middleware/auth.js";
import { can } from "../policies/can.js";

const UserIdParamSchema = z.object({ userId: z.string().uuid() });

function toAuditor(row: AuditorRow): Auditor {
  return {
    userId: row.userId,
    name: row.name,
    email: row.email,
    accessExpiresAt: row.accessExpiresAt
      ? new Date(row.accessExpiresAt).toISOString()
      : null,
  };
}

/**
 * TIM-008: time-boxed inspector/auditor access. Managing it is an
 * organization setting, so it needs the same permission as the other
 * organization settings (`org.write`, admins only). A user who is not an
 * auditor of the caller's organization (including another organization's
 * auditor) is a 404.
 */
export function createAuditorAccessRoutes(sql: Sql) {
  const router = new Hono();
  const auditorRepo = new AuditorAccessRepository();
  const auditRepo = new AuditRepository();

  const requireAdmin = (c: Context): AuthUser => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;
    const allowed = can(
      {
        userId: user.id,
        organizationId: user.organizationId,
        role: user.role,
      },
      "org.write",
    );
    if (!allowed) {
      throw new ForbiddenError({
        detail: "Only organization admins can manage auditor access",
      });
    }
    return user;
  };

  router.get("/auditors", requireAuth, async (c) => {
    const user = requireAdmin(c);
    const rows = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      (tx) => auditorRepo.list(tx),
    );
    return c.json({ items: rows.map(toAuditor) });
  });

  router.patch("/auditors/:userId/access", requireAuth, async (c) => {
    const user = requireAdmin(c);
    const { userId } = parseParams(c, UserIdParamSchema, {
      detail: "Auditor not found",
    });
    const body = await parseJsonBody(c, UpdateAuditorAccessRequestSchema);

    const updated = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        const current = await auditorRepo.findForUpdate(tx, userId);
        if (!current) throw new NotFoundError({ detail: "Auditor not found" });

        const previousExpiresAt =
          current.accessExpiresAt?.toISOString() ?? null;
        let newExpiresAt: Date;
        const revoked = "revoke" in body;
        if (revoked) {
          // Ends access now and deletes this organization's sessions and
          // tokens of the auditor, in this same transaction.
          newExpiresAt = (await auditorRepo.revoke(tx, userId)).accessExpiresAt;
        } else {
          const requested = new Date(body.accessExpiresAt);
          assertAuditorAccessEnd(requested, await auditorRepo.window(tx));
          newExpiresAt = await auditorRepo.setAccessExpiry(
            tx,
            userId,
            requested,
          );
        }

        // No PII: the resource id (the user id) identifies the auditor.
        await auditRepo.log(tx, {
          actorId: user.id,
          action: "membership.access_update",
          resourceType: "membership",
          resourceId: userId,
          metadata: {
            previousExpiresAt,
            newExpiresAt: newExpiresAt.toISOString(),
            revoked,
          },
        });

        return { ...current, accessExpiresAt: newExpiresAt };
      },
    );

    return c.json(toAuditor(updated));
  });

  return router;
}
