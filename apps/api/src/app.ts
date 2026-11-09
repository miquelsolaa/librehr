import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Sql } from "postgres";
import type { AuthPort } from "./ports/auth.js";
import type { MailPort } from "./ports/mail.js";
import type { StoragePort } from "./ports/storage.js";
import { LocalStorageAdapter } from "./adapters/storage-local.js";
import { requestIdMiddleware } from "./middleware/request-id.js";
import { loggerMiddleware } from "./middleware/logger.js";
import { securityHeadersMiddleware } from "./middleware/security-headers.js";
import { createAuthMiddleware } from "./middleware/auth.js";
import { tenantContextMiddleware } from "./middleware/tenant-context.js";
import { patScopeMiddleware } from "./middleware/pat-scopes.js";
import { errorHandler } from "./middleware/error-handler.js";
import { createHealthRoutes } from "./routes/health.js";
import { createAuthRoutes } from "./routes/auth.js";
import { createMeRoutes } from "./routes/me.js";
import { createOrgRoutes } from "./routes/org.js";
import { createEmployeeRoutes } from "./routes/employees.js";
import { createEmploymentHistoryRoutes } from "./routes/employment-history.js";
import { createDepartmentRoutes } from "./routes/departments.js";
import { createLocationRoutes } from "./routes/locations.js";
import { createInvitationRoutes } from "./routes/invitations.js";
import { createSetupRoutes } from "./routes/setup.js";
import { createAuditRoutes } from "./routes/audit.js";
import { createLeaveRoutes } from "./routes/leave.js";
import { createCalendarRoutes } from "./routes/calendar.js";
import { createNotificationRoutes } from "./routes/notifications.js";
import { createTimeRoutes } from "./routes/time.js";
import { createTimeCorrectionRoutes } from "./routes/time-corrections.js";
import { createScheduleRoutes } from "./routes/schedules.js";
import { createDocumentRoutes } from "./routes/documents.js";
import { createChecklistRoutes } from "./routes/checklists.js";
import { createEmployeeImportRoutes } from "./routes/employee-import.js";
import { createDsrRoutes } from "./routes/dsr.js";
import { createReportRoutes } from "./routes/reports.js";
import { createTokenRoutes } from "./routes/tokens.js";
import { createCustomFieldRoutes } from "./routes/custom-fields.js";
import { createSsoRoutes } from "./routes/sso.js";
import { createSettingsSecurityRoutes } from "./routes/settings-security.js";
import { createWebhookRoutes } from "./routes/webhooks.js";
import { createShiftRoutes } from "./routes/shifts.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface AppDependencies {
  sql: Sql;
  authPort: AuthPort;
  mailPort?: MailPort | undefined;
  storagePort?: StoragePort | undefined;
  /** From the validated env; 2FA challenges are refused without it. */
  sessionSecret?: string | undefined;
}

export function createApp(deps: AppDependencies) {
  const app = new Hono();

  // 1. Global Middleware Pipeline (per ARCHITECTURE.md 3.2)
  app.use(
    "*",
    cors({
      origin: (origin) => {
        if (!origin) return "http://localhost:3000";
        const appUrl = process.env["APP_URL"] ?? "http://localhost:3000";
        if (
          origin === "http://localhost:3000" ||
          origin === "http://127.0.0.1:3000" ||
          origin === appUrl ||
          origin.startsWith("http://localhost:") ||
          origin.startsWith("http://127.0.0.1:")
        ) {
          return origin;
        }
        return null;
      },
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: [
        "Content-Type",
        "Authorization",
        "X-Request-ID",
        "X-Tenant-ID",
      ],
      exposeHeaders: ["Content-Length", "X-Request-ID"],
      maxAge: 600,
      credentials: true,
    }),
  );
  app.use("*", requestIdMiddleware);
  app.use("*", loggerMiddleware);
  app.use("*", securityHeadersMiddleware);
  app.use("*", createAuthMiddleware(deps.authPort, deps.sql));
  app.use("*", tenantContextMiddleware);
  app.use("*", patScopeMiddleware);

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
      info: { title: "LibreHR API", version: "0.1.0" },
    });
  });

  // 4. API v1 Modules
  app.route(
    "/v1/auth",
    createAuthRoutes(deps.authPort, deps.sql, {
      sessionSecret: deps.sessionSecret,
    }),
  );
  app.route("/v1", createMeRoutes(deps.sql));
  app.route("/v1", createOrgRoutes(deps.sql));
  app.route("/v1", createEmployeeRoutes(deps.sql));
  app.route("/v1", createEmploymentHistoryRoutes(deps.sql));
  app.route("/v1", createDepartmentRoutes(deps.sql));
  app.route("/v1", createLocationRoutes(deps.sql));
  app.route(
    "/v1",
    createInvitationRoutes(deps.sql, deps.authPort, deps.mailPort),
  );
  app.route("/v1", createSetupRoutes(deps.sql));
  app.route("/v1", createAuditRoutes(deps.sql));
  app.route("/v1", createLeaveRoutes(deps.sql, deps.mailPort));
  app.route("/v1", createCalendarRoutes(deps.sql));
  app.route("/v1", createNotificationRoutes(deps.sql));
  app.route("/v1", createTimeRoutes(deps.sql));
  app.route("/v1", createTimeCorrectionRoutes(deps.sql));
  app.route("/v1", createScheduleRoutes(deps.sql));

  // M4 & M5 Modules
  const storagePort = deps.storagePort ?? new LocalStorageAdapter();
  app.route("/v1", createDocumentRoutes(deps.sql, storagePort));
  app.route("/v1", createChecklistRoutes(deps.sql));
  app.route("/v1", createEmployeeImportRoutes(deps.sql));
  app.route("/v1", createDsrRoutes(deps.sql));
  app.route("/v1", createReportRoutes(deps.sql));
  app.route("/v1", createTokenRoutes(deps.sql));
  app.route("/v1", createCustomFieldRoutes(deps.sql));
  app.route("/v1", createSsoRoutes(deps.sql));
  app.route("/v1", createSettingsSecurityRoutes(deps.sql));
  app.route("/v1", createWebhookRoutes(deps.sql));
  app.route("/v1", createShiftRoutes(deps.sql));

  // 5. RFC 9457 Problem Details Error Handler
  app.onError(errorHandler);

  return app;
}
