import { serve } from "@hono/node-server";
import postgres from "postgres";
import { runMigrations } from "@librehr/db/migrate";
import { configureEnvelopeKey } from "@librehr/db";
import { loadEnv } from "./env.js";
import { createApp } from "./app.js";
import { BetterAuthAdapter } from "./adapters/better-auth.js";
import { SmtpMailAdapter } from "./adapters/mail-smtp.js";
import { logger } from "./middleware/logger.js";

async function bootstrap() {
  const env = loadEnv();
  // loadEnv resolves ENVELOPE_MASTER_KEY_FILE into env only; hand the key to
  // the crypto layer instead of letting it read process.env.
  configureEnvelopeKey(env.ENVELOPE_MASTER_KEY);

  logger.info({
    msg: "Bootstrapping LibreHR API...",
    env: env.NODE_ENV,
    port: env.PORT,
  });

  // 1. Run migrations automatically with advisory lock
  try {
    await runMigrations(env.DATABASE_MIGRATION_URL);
  } catch (err) {
    logger.error({
      msg: "Database migration failed during bootstrap",
      err: String(err),
    });
    // In production we exit if migrations fail
    if (env.NODE_ENV === "production") {
      process.exit(1);
    }
  }

  // 2. Every request, including identity lookups, runs on the restricted
  // runtime role (librehr_app, NOBYPASSRLS). The owner role in
  // DATABASE_MIGRATION_URL is only used for migrations above.
  const sql = postgres(env.DATABASE_URL, { max: 20 });
  const authPort = new BetterAuthAdapter(sql);
  const mailPort = new SmtpMailAdapter({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
    from: env.SMTP_FROM,
  });

  // 3. Create Hono application
  const app = createApp({
    sql,
    authPort,
    mailPort,
    sessionSecret: env.SESSION_SECRET,
    nodeEnv: env.NODE_ENV,
    trustProxy: env.TRUST_PROXY,
    config: {
      nodeEnv: env.NODE_ENV,
      appUrl: env.APP_URL,
      corsOrigins: env.CORS_ORIGINS,
      publicApiUrl: env.BETTER_AUTH_URL,
      ssoEnabled: env.SSO_ENABLED,
      webhooksAllowPrivate: env.WEBHOOKS_ALLOW_PRIVATE,
    },
  });

  // 4. Start HTTP server
  serve(
    {
      fetch: app.fetch,
      port: env.PORT,
    },
    (info) => {
      logger.info({
        msg: `LibreHR API listening on port ${info.port}`,
        url: `http://localhost:${info.port}`,
      });
    },
  );
}

bootstrap().catch((err) => {
  process.stderr.write(`Fatal bootstrap error: ${String(err)}\n`);
  process.exit(1);
});
