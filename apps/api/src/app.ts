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
import { createCsrfMiddleware } from "./middleware/csrf.js";
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
import { createOrgGroupRoutes } from "./routes/org-groups.js";
import { createMembershipRoutes } from "./routes/memberships.js";
import { createLocationRoutes } from "./routes/locations.js";
import { createInvitationRoutes } from "./routes/invitations.js";
import { createSetupRoutes } from "./routes/setup.js";
import { createAuditRoutes } from "./routes/audit.js";
import { createLeaveRoutes } from "./routes/leave.js";
import { createLeavePolicyRoutes } from "./routes/leave-policies.js";
import { createCalendarRoutes } from "./routes/calendar.js";
import { createNotificationRoutes } from "./routes/notifications.js";
import { createTimeRoutes } from "./routes/time.js";
import {
  createTimeExportRoutes,
  TIME_EXPORT_EXPOSED_HEADERS,
} from "./routes/time-export.js";
import { createTimeExportEmployeesRoutes } from "./routes/time-export-employees.js";
import { createTimeExportJobRoutes } from "./routes/time-export-jobs.js";
import { createTimeCorrectionRoutes } from "./routes/time-corrections.js";
import { createTimeClosureRoutes } from "./routes/time-closures.js";
import { createApprovalRoutes } from "./routes/approvals.js";
import { createTimeKioskRoutes } from "./routes/time-kiosk.js";
import {
  createTimeChainSigner,
  resolveTimeChainKey,
} from "./lib/time-chain.js";
import {
  resolveTimeTrackingConfig,
  type TimeTrackingConfigInput,
} from "./lib/time-tracking-config.js";
import type { TwoFactorConfigInput } from "./lib/two-factor-config.js";
import type { EmailVerificationOptions } from "./lib/email-verification.js";
import { createScheduleRoutes } from "./routes/schedules.js";
import { createDocumentRoutes } from "./routes/documents.js";
import { createChecklistRoutes } from "./routes/checklists.js";
import { createEmployeeImportRoutes } from "./routes/employee-import.js";
import { createDsrRoutes } from "./routes/dsr.js";
import { createReportRoutes } from "./routes/reports.js";
import { createTokenRoutes } from "./routes/tokens.js";
import { createCustomFieldRoutes } from "./routes/custom-fields.js";
import { createSettingsSecurityRoutes } from "./routes/settings-security.js";
import { createAuditorAccessRoutes } from "./routes/auditor-access.js";
import { createWebhookRoutes } from "./routes/webhooks.js";
import { createShiftRoutes } from "./routes/shifts.js";
import { createEditionRoutes } from "./routes/edition.js";
import { mountBusinessRoutes } from "./extensions/business-routes.js";
import { communityLicense } from "./extensions/community.js";
import type { ApiExtension } from "./extensions/types.js";
import { requireAuth } from "./middleware/auth.js";
import { AppError } from "./errors/index.js";
import type { LicenseState } from "@librehr/contracts";
import { createCorsOriginMatcher } from "./lib/cors-origin.js";
import type { HostResolver } from "./lib/outbound-url.js";
import type { OutboundSender } from "./lib/outbound-request.js";
import { createOidcHttpClient, type OidcHttpClient } from "./lib/oidc-http.js";
import { createCompleteSignIn } from "./lib/complete-sign-in.js";
import { challengeSecret } from "./lib/two-factor-challenge.js";
import { createRateLimiter } from "./middleware/rate-limit.js";
import { UserRepository } from "@librehr/db";
import {
  createPostgresRateLimitStore,
  type RateLimitStore,
} from "./lib/rate-limit-store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface AppDependencies {
  sql: Sql;
  authPort: AuthPort;
  /**
   * Edition resolved at boot by `loadEdition` (LIC-001/002). Defaults to
   * Community with no Business extensions.
   */
  license?: LicenseState | undefined;
  /** Business extensions unlocked by `license` (ADR 0004). */
  extensions?: readonly ApiExtension[] | undefined;
  mailPort?: MailPort | undefined;
  storagePort?: StoragePort | undefined;
  /** From the validated env; 2FA challenges are refused without it. */
  sessionSecret?: string | undefined;
  /**
   * HMAC key of the time-event chain (TIM-002), from the validated env.
   * Required in production; tests and local runs fall back to the dev key.
   */
  timeChainKey?: string | undefined;
  /** Overrides of the time-tracking policy defaults (clock window, kiosk lockout). */
  timeTracking?: TimeTrackingConfigInput | undefined;
  /**
   * Overrides of the TIM-006 export limits (tests): the employee-days cap
   * (default OFFICIAL_EXPORT_MAX_EMPLOYEE_DAYS) and the rate limit (default
   * 10 per minute per user), and the employee picker's rate limit (default
   * 60 per minute per user).
   */
  timeExport?:
    | {
        maxEmployeeDays?: number | undefined;
        rateLimit?: { windowMs: number; max: number } | undefined;
        pickerRateLimit?: { windowMs: number; max: number } | undefined;
        /** Background export cap (default OFFICIAL_EXPORT_ASYNC_MAX_EMPLOYEE_DAYS). */
        asyncMaxEmployeeDays?: number | undefined;
        /** Rate limit of /v1/time/exports (default 30 per minute per user). */
        jobsRateLimit?: { windowMs: number; max: number } | undefined;
      }
    | undefined;
  /** Overrides of the password reset limits (AUTH-001, tests). */
  passwordReset?:
    { maxLinksPerAccountPerHour?: number | undefined } | undefined;
  /**
   * Overrides of the email verification defaults (AUTH-001): links per
   * account per hour (3) and link lifetime (24 h); see
   * lib/email-verification.ts.
   */
  emailVerification?: EmailVerificationOptions | undefined;
  /**
   * Store of rate limits and lockouts. Defaults to the shared Postgres store
   * on `sql`, keyed with `sessionSecret`; tests inject one with its own key
   * prefix or clock.
   */
  rateLimitStore?: RateLimitStore | undefined;
  /** Overrides of the 2FA defaults (AUTH-003); see lib/two-factor-config.ts. */
  twoFactor?: TwoFactorConfigInput | undefined;
  /** NODE_ENV from the validated env: production always sets Secure cookies. */
  nodeEnv?: "development" | "test" | "production" | undefined;
  /** TRUST_PROXY from the validated env (trusted reverse-proxy hops). */
  trustProxy?: number | undefined;
  /** Edge settings from the validated env; see `resolveAppConfig`. */
  config?: Partial<AppConfig> | undefined;
}

export interface AppConfig {
  nodeEnv: "development" | "test" | "production";
  /** Public web app URL (APP_URL); always an allowed CORS origin. */
  appUrl: string | undefined;
  /** CORS_ORIGINS. */
  corsOrigins: string[];
  /** Public API base URL (BETTER_AUTH_URL), used for the SSO redirect URI. */
  publicApiUrl: string;
  /** WEBHOOKS_ALLOW_PRIVATE (never true in production; env.ts refuses it). */
  webhooksAllowPrivate: boolean;
  /** DNS resolver for outbound URL checks; tests inject a fake. */
  resolveHost: HostResolver | undefined;
  /** Sender for outbound webhook requests; tests inject a fake. */
  sendWebhook: OutboundSender | undefined;
  /**
   * HTTP client for identity providers (AUTH-004); tests inject an
   * in-process fake. Defaults to the guarded client of lib/oidc-http.ts.
   */
  oidcHttp: OidcHttpClient | undefined;
}

/**
 * Fills unset settings with closed defaults: an unknown NODE_ENV is treated
 * as production and webhooks must target public https URLs.
 * `fallbackNodeEnv` is the top-level `nodeEnv` dependency, when given.
 */
export function resolveAppConfig(
  config: Partial<AppConfig> = {},
  fallbackNodeEnv?: AppConfig["nodeEnv"],
): AppConfig {
  const envNode = process.env["NODE_ENV"];
  const nodeEnv =
    config.nodeEnv ??
    fallbackNodeEnv ??
    (envNode === "development" || envNode === "test" ? envNode : "production");
  return {
    nodeEnv,
    appUrl: config.appUrl,
    corsOrigins: config.corsOrigins ?? [],
    publicApiUrl: config.publicApiUrl ?? "http://localhost:3001",
    webhooksAllowPrivate:
      nodeEnv !== "production" && (config.webhooksAllowPrivate ?? false),
    resolveHost: config.resolveHost,
    sendWebhook: config.sendWebhook,
    oidcHttp: config.oidcHttp,
  };
}

export function createApp(deps: AppDependencies) {
  const app = new Hono();
  const timeChainKey = resolveTimeChainKey(deps.timeChainKey);
  const signTimeEvent = createTimeChainSigner(timeChainKey);
  const timeTracking = resolveTimeTrackingConfig(deps.timeTracking);
  const config = resolveAppConfig(deps.config, deps.nodeEnv);
  const rateLimitStore =
    deps.rateLimitStore ??
    createPostgresRateLimitStore(deps.sql, {
      secret: deps.sessionSecret,
      // Fail at startup rather than hash keys with the public dev key.
      requireSecret: config.nodeEnv === "production",
    });

  // 1. Global Middleware Pipeline (per ARCHITECTURE.md 3.2)
  app.use(
    "*",
    cors({
      origin: createCorsOriginMatcher({
        nodeEnv: config.nodeEnv,
        allowedOrigins: [
          ...(config.appUrl ? [config.appUrl] : []),
          ...config.corsOrigins,
        ],
      }),
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: [
        "Content-Type",
        "Authorization",
        "X-Request-ID",
        "X-Tenant-ID",
      ],
      exposeHeaders: [
        "Content-Length",
        "X-Request-ID",
        ...TIME_EXPORT_EXPOSED_HEADERS,
      ],
      maxAge: 600,
      credentials: true,
    }),
  );
  app.use("*", requestIdMiddleware);
  app.use("*", loggerMiddleware);
  app.use("*", securityHeadersMiddleware);
  app.use("*", createAuthMiddleware(deps.authPort, deps.sql));
  app.use(
    "*",
    // The resolved config: an unset NODE_ENV is production (closed), and the
    // CORS_ORIGINS cookie clients are trusted by CORS and CSRF alike.
    createCsrfMiddleware({
      appUrl: config.appUrl,
      allowedOrigins: config.corsOrigins,
      nodeEnv: config.nodeEnv,
    }),
  );
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
      rateLimitStore,
      sessionSecret: deps.sessionSecret,
      nodeEnv: deps.nodeEnv,
      trustProxy: deps.trustProxy,
      twoFactor: deps.twoFactor,
      mailPort: deps.mailPort,
      appUrl: config.appUrl,
      passwordReset: deps.passwordReset,
      emailVerification: deps.emailVerification,
    }),
  );
  app.route("/v1", createMeRoutes(deps.sql));
  app.route("/v1", createOrgRoutes(deps.sql));
  app.route(
    "/v1",
    createEmployeeRoutes(deps.sql, { trustProxy: deps.trustProxy }),
  );
  app.route("/v1", createEmploymentHistoryRoutes(deps.sql));
  app.route("/v1", createDepartmentRoutes(deps.sql));
  app.route("/v1", createOrgGroupRoutes(deps.sql));
  app.route("/v1", createMembershipRoutes(deps.sql));
  app.route("/v1", createLocationRoutes(deps.sql));
  app.route(
    "/v1",
    createInvitationRoutes(deps.sql, deps.authPort, deps.mailPort, {
      nodeEnv: deps.nodeEnv,
      trustProxy: deps.trustProxy,
      appUrl: config.appUrl,
    }),
  );
  app.route(
    "/v1",
    createSetupRoutes(deps.sql, {
      rateLimitStore,
      trustProxy: deps.trustProxy,
      mailPort: deps.mailPort,
      appUrl: config.appUrl,
      emailVerification: deps.emailVerification,
    }),
  );
  app.route("/v1", createAuditRoutes(deps.sql));
  app.route("/v1", createLeaveRoutes(deps.sql, deps.mailPort));
  app.route("/v1", createLeavePolicyRoutes(deps.sql));
  app.route("/v1", createApprovalRoutes(deps.sql));
  app.route("/v1", createCalendarRoutes(deps.sql));
  app.route("/v1", createNotificationRoutes(deps.sql));
  app.route(
    "/v1",
    createTimeRoutes(deps.sql, { sign: signTimeEvent, config: timeTracking }),
  );
  app.route(
    "/v1",
    createTimeExportRoutes(deps.sql, {
      rateLimitStore,
      timeChainKey,
      trustProxy: deps.trustProxy,
      maxEmployeeDays: deps.timeExport?.maxEmployeeDays,
      asyncMaxEmployeeDays: deps.timeExport?.asyncMaxEmployeeDays,
      rateLimit: deps.timeExport?.rateLimit,
    }),
  );
  app.route(
    "/v1",
    createTimeExportJobRoutes(deps.sql, {
      rateLimitStore,
      trustProxy: deps.trustProxy,
      asyncMaxEmployeeDays: deps.timeExport?.asyncMaxEmployeeDays,
      rateLimit: deps.timeExport?.jobsRateLimit,
    }),
  );
  app.route(
    "/v1",
    createTimeExportEmployeesRoutes(deps.sql, {
      rateLimitStore,
      trustProxy: deps.trustProxy,
      rateLimit: deps.timeExport?.pickerRateLimit,
    }),
  );
  app.route(
    "/v1",
    createTimeKioskRoutes(deps.sql, {
      rateLimitStore,
      sign: signTimeEvent,
      config: timeTracking,
      trustProxy: deps.trustProxy,
    }),
  );
  app.route(
    "/v1",
    createTimeCorrectionRoutes(deps.sql, { sign: signTimeEvent }),
  );
  app.route("/v1", createTimeClosureRoutes(deps.sql));
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
  app.route("/v1", createSettingsSecurityRoutes(deps.sql));
  app.route("/v1", createAuditorAccessRoutes(deps.sql));
  app.route(
    "/v1",
    createWebhookRoutes(
      deps.sql,
      {
        allowPrivate: config.webhooksAllowPrivate,
        resolve: config.resolveHost,
      },
      config.sendWebhook,
    ),
  );
  app.route("/v1", createShiftRoutes(deps.sql));

  // 4b. Edition and Business extensions (ADR 0004, LIC-001..003)
  app.route("/v1", createEditionRoutes(deps.license ?? communityLicense()));
  const userRepo = new UserRepository();
  mountBusinessRoutes(app, deps.extensions ?? [], {
    sql: deps.sql,
    requireAuth,
    publicApiUrl: config.publicApiUrl,
    createError: (init) => new AppError(init),
    appUrl: config.appUrl,
    rateLimit: (name, limit) =>
      createRateLimiter({
        name: `ext.${name}`,
        store: rateLimitStore,
        windowMs: limit.windowMs,
        max: limit.max,
        trustProxy: deps.trustProxy,
        account: limit.account,
      }),
    oidcHttp:
      config.oidcHttp ??
      // Same development escape hatch as webhooks (never in production).
      createOidcHttpClient({
        allowPrivate: config.webhooksAllowPrivate,
        resolve: config.resolveHost,
      }),
    completeSignIn: createCompleteSignIn({
      authPort: deps.authPort,
      findUser: (userId) => userRepo.findById(deps.sql, userId),
      challengeSecret: challengeSecret(deps.sessionSecret),
      cookie: { nodeEnv: deps.nodeEnv, trustProxy: deps.trustProxy },
    }),
  });

  // 5. RFC 9457 Problem Details Error Handler
  app.onError(errorHandler);

  return app;
}
