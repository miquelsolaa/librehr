import type { MiddlewareHandler } from "hono";
import { createProblemDetails } from "@openhr/contracts";
import type { AuthPort } from "../ports/auth.js";

export function createAuthMiddleware(authPort: AuthPort): MiddlewareHandler {
  return async (c, next) => {
    let token: string | undefined;

    const authHeader = c.req.header("authorization");
    if (authHeader?.startsWith("Bearer ")) {
      token = authHeader.substring(7);
    } else {
      // Cookie fallback
      const cookieHeader = c.req.header("cookie");
      if (cookieHeader) {
        const match = cookieHeader.match(/openhr_session=([^;]+)/);
        if (match) {
          token = match[1];
        }
      }
    }

    if (token) {
      const session = await authPort.getSession(token);
      if (session) {
        c.set("user", session.user);
        c.set("session", session);
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
