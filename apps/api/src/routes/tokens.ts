import { Hono } from "hono";
import type { Sql } from "postgres";
import {
  type AuthUser,
  createProblemDetails,
  CreatePersonalAccessTokenSchema,
} from "@librehr/contracts";
import { withTenant, TokenRepository, AuditRepository } from "@librehr/db";
import { requireAuth } from "../middleware/auth.js";

export function createTokenRoutes(sql: Sql) {
  const router = new Hono();
  const tokenRepo = new TokenRepository();
  const auditRepo = new AuditRepository();

  // 1. GET /tokens - List PATs for current user (ADM-006)
  router.get("/tokens", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;

    const tokens = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        return tokenRepo.listByUser(tx, user.id);
      },
    );

    return c.json(
      tokens.map((t) => ({
        ...t,
        expiresAt: t.expiresAt ? t.expiresAt.toISOString() : null,
        lastUsedAt: t.lastUsedAt ? t.lastUsedAt.toISOString() : null,
        createdAt: t.createdAt.toISOString(),
      })),
    );
  });

  // 2. POST /tokens - Generate a new PAT (ADM-006)
  router.post("/tokens", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;

    const body = await c.req.json();
    const parsed = CreatePersonalAccessTokenSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        createProblemDetails({
          status: 422,
          title: "Validation Error",
          detail: "Invalid token creation payload",
          code: "VALIDATION_ERROR",
        }),
        422,
        { "Content-Type": "application/problem+json" },
      );
    }

    const { name, scopes, expiresInDays } = parsed.data;
    const expiresAt = expiresInDays
      ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
      : null;

    const result = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        const created = await tokenRepo.createToken(tx, {
          userId: user.id,
          name,
          scopes,
          expiresAt,
        });

        await auditRepo.log(tx, {
          actorId: user.id,
          action: "token.create",
          resourceType: "personal_access_token",
          resourceId: created.token.id,
          metadata: { name, prefix: created.token.prefix, scopes },
        });

        return created;
      },
    );

    return c.json(
      {
        token: {
          ...result.token,
          expiresAt: result.token.expiresAt
            ? result.token.expiresAt.toISOString()
            : null,
          lastUsedAt: null,
          createdAt: result.token.createdAt.toISOString(),
        },
        plainToken: result.plainToken,
      },
      201,
    );
  });

  // 3. DELETE /tokens/:id - Revoke a PAT
  router.delete("/tokens/:id", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;
    const id = c.req.param("id");

    const deleted = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        const success = await tokenRepo.delete(tx, id, user.id);
        if (success) {
          await auditRepo.log(tx, {
            actorId: user.id,
            action: "token.revoke",
            resourceType: "personal_access_token",
            resourceId: id,
          });
        }
        return success;
      },
    );

    if (!deleted) {
      return c.json(
        createProblemDetails({
          status: 404,
          title: "Not Found",
          detail: "Token not found or not owned by user",
          code: "NOT_FOUND",
        }),
        404,
        { "Content-Type": "application/problem+json" },
      );
    }

    return c.json({ success: true });
  });

  return router;
}
