import type { MiddlewareHandler } from "hono";
import type { Sql } from "postgres";
import { createProblemDetails, type AuthUser } from "@librehr/contracts";
import { IdentityRepository, TokenRepository, withTenant } from "@librehr/db";
import type { AuthPort } from "../ports/auth.js";

export function createAuthMiddleware(
  authPort: AuthPort,
  sql?: Sql,
): MiddlewareHandler {
  const tokenRepo = new TokenRepository();
  const identityRepo = new IdentityRepository();

  return async (c, next) => {
    let token: string | undefined;

    const authHeader = c.req.header("authorization");
    if (authHeader?.startsWith("Bearer ")) {
      token = authHeader.substring(7);
    } else {
      // Cookie fallback
      const cookieHeader = c.req.header("cookie");
      if (cookieHeader) {
        const match = cookieHeader.match(/librehr_session=([^;]+)/);
        if (match) {
          token = match[1];
        }
      }
    }

    if (token) {
      // Check if this is a personal access token (starts with lhr_)
      if (token.startsWith("lhr_") && sql) {
        // Lookup errors propagate (500); an unknown or expired token simply
        // leaves the request unauthenticated (401 from requireAuth).
        const pat = await identityRepo.personalAccessToken(
          sql,
          TokenRepository.hashToken(token),
        );
        if (pat) {
          const user: AuthUser = {
            id: pat.userId,
            email: pat.email,
            name: pat.userName,
            role: pat.role,
            organizationId: pat.organizationId,
          };
          c.set("user", user);
          c.set("patId", pat.id);
          c.set("patScopes", pat.scopes);

          // Record usage without blocking; a failed timestamp update must not
          // fail an otherwise authenticated request.
          void withTenant(
            sql,
            { organizationId: pat.organizationId, userId: pat.userId },
            (tx) => tokenRepo.recordUsage(tx, pat.id),
          ).catch(() => {});
        }
      } else {
        const session = await authPort.getSession(token);
        if (session) {
          c.set("user", session.user);
          c.set("session", session);
        }
      }
    }

    await next();
  };
}

export const requireAuth: MiddlewareHandler = async (c, next) => {
  const user = c.get("user");
  if (!user) {
    const problem = createProblemDetails({
      status: 401,
      title: "Unauthorized",
      detail: "Authentication is required to access this resource",
      code: "UNAUTHORIZED",
      instance: c.req.path,
    });
    return c.json(problem, 401, {
      "Content-Type": "application/problem+json",
    });
  }

  await next();
};
