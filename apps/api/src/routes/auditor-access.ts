import { Hono } from "hono";
import type { Context } from "hono";
import type { Sql } from "postgres";
import { z } from "zod";
import {
  type AuthUser,
  type Auditor,
  UpdateAuditorAccessRequestSchema,
} from "@librehr/contracts";
import { auditorAccessUntilDate } from "@librehr/core";
import {
  withTenant,
  AuditRepository,
  AuditorAccessRepository,
  type AuditorRow,
} from "@librehr/db";
import { ForbiddenError, NotFoundError } from "../errors/index.js";
import {
  auditorAccessBounds,
  resolveAuditorAccessEnd,
} from "../lib/auditor-access.js";
import { IdParamSchema, parseJsonBody, parseParams } from "../lib/validate.js";
import { requireAuth } from "../middleware/auth.js";
import { can } from "../policies/can.js";

const UserIdParamSchema = z.object({ userId: z.guid() });

function toAuditor(row: AuditorRow, timeZone: string): Auditor {
  const expiresAt = new Date(row.accessExpiresAt);
  return {
    userId: row.userId,
    name: row.name,
    email: row.email,
    accessExpiresAt: expiresAt.toISOString(),
    accessUntil: auditorAccessUntilDate(expiresAt, timeZone),
  };
}

/**
 * TIM-008: time-boxed inspector/auditor access. Managing it is an
 * organization setting, so it needs the same permission as the other
 * organization settings (`org.write`, admins only); personal access tokens
 * cannot reach it (pat-scopes.ts). A user who is not an auditor of the
 * caller's organization, including another organization's auditor, is a 404.
 */
export function createAuditorAccessRoutes(sql: Sql) {
  const router = new Hono();
  const auditorRepo = new AuditorAccessRepository();
  const auditRepo = new AuditRepository();

  const requireAdmin = (c: Context): AuthUser => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;
    const allowed = can(
      { userId: user.id, organizationId: user.organizationId, role: user.role },
      "org.write",
    );
    if (!allowed) {
      throw new ForbiddenError({
        detail: "Only organization admins can manage auditor access",
      });
    }
    return user;
  };
  const tenant = (user: AuthUser) => ({
    organizationId: user.organizationId,
    userId: user.id,
  });

  router.get("/auditors", requireAuth, async (c) => {
    const user = requireAdmin(c);
    const body = await withTenant(sql, tenant(user), async (tx) => {
      const window = await auditorRepo.window(tx);
      const rows = await auditorRepo.list(tx);
      const pending = await auditorRepo.listPendingInvitations(tx);
      return {
        items: rows.map((row) => toAuditor(row, window.timeZone)),
        pendingInvitations: pending.map((invite) => ({
          id: invite.id,
          email: invite.email,
          accessExpiresAt: new Date(invite.accessExpiresAt).toISOString(),
          accessUntil: auditorAccessUntilDate(
            new Date(invite.accessExpiresAt),
            window.timeZone,
          ),
          expiresAt: new Date(invite.expiresAt).toISOString(),
        })),
        timeZone: window.timeZone,
        ...auditorAccessBounds(window),
        auditorAccessMaxDays: window.maxDays,
      };
    });
    return c.json(body);
  });

  router.patch("/auditors/:userId/access", requireAuth, async (c) => {
    const user = requireAdmin(c);
    const { userId } = parseParams(c, UserIdParamSchema, {
      detail: "Auditor not found",
    });
    const body = await parseJsonBody(c, UpdateAuditorAccessRequestSchema);

    const updated = await withTenant(sql, tenant(user), async (tx) => {
      const current = await auditorRepo.findForUpdate(tx, userId);
      if (!current) throw new NotFoundError({ detail: "Auditor not found" });
      const window = await auditorRepo.window(tx);

      const previous = new Date(current.accessExpiresAt);
      const revoked = "revoke" in body;
      const next = revoked
        ? // Ends access now and deletes this organization's sessions and
          // tokens of the auditor, in this same transaction.
          (await auditorRepo.revoke(tx, userId)).accessExpiresAt
        : await auditorRepo.setAccessExpiry(
            tx,
            userId,
            resolveAuditorAccessEnd(body.accessUntil, window),
          );

      // A pending invitation for this person would rewrite the membership on
      // acceptance: after a revocation or an earlier end date it could hand
      // the access back, so it is expired here (TIM-008).
      if (revoked || next.getTime() < previous.getTime()) {
        await auditorRepo.expirePendingInvitationsFor(tx, current.email);
      }

      // No PII: the resource id (the user id) identifies the auditor.
      await auditRepo.log(tx, {
        actorId: user.id,
        action: "membership.access_update",
        resourceType: "membership",
        resourceId: userId,
        metadata: {
          previousExpiresAt: previous.toISOString(),
          newExpiresAt: new Date(next).toISOString(),
          revoked,
        },
      });
      return toAuditor({ ...current, accessExpiresAt: next }, window.timeZone);
    });

    return c.json(updated);
  });

  router.delete("/auditors/invitations/:id", requireAuth, async (c) => {
    const user = requireAdmin(c);
    const { id } = parseParams(c, IdParamSchema, {
      detail: "Invitation not found",
    });
    await withTenant(sql, tenant(user), async (tx) => {
      if (!(await auditorRepo.cancelInvitation(tx, id))) {
        throw new NotFoundError({ detail: "Invitation not found" });
      }
      await auditRepo.log(tx, {
        actorId: user.id,
        action: "invitation.cancel",
        resourceType: "invitation",
        resourceId: id,
        metadata: { role: "auditor" },
      });
    });
    return c.json({ success: true });
  });

  return router;
}
