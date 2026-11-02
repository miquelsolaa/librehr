import { Hono } from "hono";
import { SignInRequestSchema, createProblemDetails } from "@librehr/contracts";
import type { AuthPort } from "../ports/auth.js";
import { createRateLimiter } from "../middleware/rate-limit.js";

export function createAuthRoutes(authPort: AuthPort) {
  const router = new Hono();

  // Rate limit: 10 attempts per minute on sign-in
  const authRateLimiter = createRateLimiter({
    windowMs: 60 * 1000,
    max: 10,
  });

  router.post("/sign-in", authRateLimiter, async (c) => {
    const body = await c.req.json();
    const parsed = SignInRequestSchema.safeParse(body);

    if (!parsed.success) {
      const problem = createProblemDetails({
        status: 400,
        title: "Validation Error",
        detail: "Invalid sign-in request body",
        code: "VALIDATION_ERROR",
        errors: parsed.error.errors.map((e) => ({
          field: e.path.join("."),
          message: e.message,
        })),
      });
      return c.json(problem, 400, {
        "Content-Type": "application/problem+json",
      });
    }

    const user = await authPort.verifyCredentials(
      parsed.data.email,
      parsed.data.password,
    );

    if (!user) {
      const problem = createProblemDetails({
        status: 401,
        title: "Unauthorized",
        detail: "Invalid email or password",
        code: "INVALID_CREDENTIALS",
      });
      return c.json(problem, 401, {
        "Content-Type": "application/problem+json",
      });
    }

    const session = await authPort.createSession(user);

    // Set secure HttpOnly session cookie
    c.header(
      "Set-Cookie",
      `librehr_session=${session.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`,
    );

    return c.json({
      user: session.user,
      expiresAt: session.expiresAt.toISOString(),
    });
  });

  router.post("/sign-out", async (c) => {
    const authHeader = c.req.header("authorization");
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.substring(7);
      await authPort.revokeSession(token);
    }

    c.header(
      "Set-Cookie",
      "librehr_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
    );

    return c.json({ success: true });
  });

  return router;
}
