import type { MiddlewareHandler } from "hono";
import type { Sql } from "postgres";
import { createProblemDetails, type AuthUser } from "@librehr/contracts";
import { IdentityRepository, TokenRepository, withTenant } from "@librehr/db";
import type { AuthPort } from "../ports/auth.js";
import { readSessionCookie } from "../lib/session-cookie.js";

export function createAuthMiddleware(
  authPort: AuthPort,
  sql?: Sql,
): MiddlewareHandler {
  const tokenRepo = new TokenRepository();
  const identityRepo = new IdentityRepository();

  return async (c, next) => {
    // Personal access tokens (lhr_...) and, for non-browser clients, session
    // tokens arrive as `Authorization: Bearer`. Browsers use the httpOnly
    // session cookie, which only ever carries a session token. When a Bearer
    // header is present the cookie is ignored, even if the header is invalid.
    let token: string | undefined;
    let fromCookie = false;

    const authHeader = c.req.header("authorization");
    if (authHeader?.startsWith("Bearer ")) {
      token = authHeader.substring(7);
    } else if (!authHeader) {
      token = readSessionCookie(c);
      fromCookie = token !== undefined;
    }

    if (token) {
      // Check if this is a personal access token (starts with lhr_)
      if (token.startsWith("lhr_") && !fromCookie && sql) {
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
      } else if (!token.startsWith("lhr_")) {
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
