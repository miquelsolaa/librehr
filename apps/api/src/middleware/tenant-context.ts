import type { MiddlewareHandler } from "hono";
import type { AuthUser } from "@librehr/contracts";

export const tenantContextMiddleware: MiddlewareHandler = async (c, next) => {
  const user = c.get("user") as AuthUser | undefined;
  if (user?.organizationId) {
    c.set("organizationId", user.organizationId);
  }
  await next();
};
