import type { MiddlewareHandler } from "hono";
import type { Sql } from "postgres";
import { createProblemDetails, type AuthUser } from "@librehr/contracts";
import { TokenRepository, withTenant } from "@librehr/db";
import type { AuthPort } from "../ports/auth.js";

export function createAuthMiddleware(
  authPort: AuthPort,
  sql?: Sql,
): MiddlewareHandler {
  const tokenRepo = new TokenRepository();

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
        const tokenHash = TokenRepository.hashToken(token);
        try {
          // Lookup token across all tenants safely using raw sql or admin lookup
          const patRows = await sql<
            {
              id: string;
              organization_id: string;
              user_id: string;
              name: string;
              scopes: string[];
              email: string;
              user_name: string;
              role: string;
            }[]
          >`
            SELECT pat.id, pat.organization_id, pat.user_id, pat.name, pat.scopes,
                   u.email, u.name as user_name, m.role
            FROM personal_access_tokens pat
            JOIN users u ON u.id = pat.user_id
            JOIN memberships m ON m.user_id = pat.user_id AND m.organization_id = pat.organization_id
            WHERE pat.token_hash = ${tokenHash}
              AND (pat.expires_at IS NULL OR pat.expires_at > now())
            LIMIT 1
          `;

          if (patRows[0]) {
            const pat = patRows[0];
            const user: AuthUser = {
              id: pat.user_id,
              email: pat.email,
              name: pat.user_name,
              role: pat.role,
              organizationId: pat.organization_id,
            };
            c.set("user", user);
            c.set("patId", pat.id);
            c.set("patScopes", pat.scopes);

            // Record async usage without blocking
            void withTenant(
              sql,
              { organizationId: pat.organization_id, userId: pat.user_id },
              (tx) => tokenRepo.recordUsage(tx, pat.id),
            ).catch(() => {});
          }
        } catch {
          // Ignore lookup errors in test/disconnected environment
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
