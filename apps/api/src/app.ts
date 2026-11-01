import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import type { Sql } from "postgres";
import type { AuthPort } from "./ports/auth.js";
import { requestIdMiddleware } from "./middleware/request-id.js";
import { loggerMiddleware } from "./middleware/logger.js";
import { securityHeadersMiddleware } from "./middleware/security-headers.js";
import { createAuthMiddleware } from "./middleware/auth.js";
import { tenantContextMiddleware } from "./middleware/tenant-context.js";
import { errorHandler } from "./middleware/error-handler.js";
import { createHealthRoutes } from "./routes/health.js";
import { createAuthRoutes } from "./routes/auth.js";
import { createMeRoutes } from "./routes/me.js";
import { createOrgRoutes } from "./routes/org.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface AppDependencies {
  sql: Sql;
  authPort: AuthPort;
}

export function createApp(deps: AppDependencies) {
  const app = new Hono();

  // 1. Global Middleware Pipeline (per ARCHITECTURE.md 3.2)
  app.use("*", requestIdMiddleware);
  app.use("*", loggerMiddleware);
  app.use("*", securityHeadersMiddleware);
  app.use("*", createAuthMiddleware(deps.authPort));
  app.use("*", tenantContextMiddleware);

  // 2. Health & Readiness
  const healthRoutes = createHealthRoutes(deps.sql);
  app.route("/", healthRoutes);

  // 3. OpenAPI 3.1 Spec Endpoint
  app.get("/v1/openapi.json", (c) => {
    try {
      const openApiPath = path.resolve(
        __dirname,
        "../../packages/contracts/generated/openapi.json",
      );
      if (fs.existsSync(openApiPath)) {
        const spec = JSON.parse(fs.readFileSync(openApiPath, "utf-8"));
        return c.json(spec);
      }
    } catch {
      // Fallback if path resolution varies in test environment
    }
    return c.json({
      openapi: "3.1.0",
      info: { title: "OpenHR API", version: "0.1.0" },
    });
  });

  // 4. API v1 Modules
  app.route("/v1/auth", createAuthRoutes(deps.authPort));
  app.route("/v1", createMeRoutes(deps.sql));
  app.route("/v1", createOrgRoutes(deps.sql));

  // 5. RFC 9457 Problem Details Error Handler
  app.onError(errorHandler);

  return app;
}
