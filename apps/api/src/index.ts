import { serve } from "@hono/node-server";
import postgres from "postgres";
import { runMigrations } from "@openhr/db/migrate";
import { loadEnv } from "./env.js";
import { createApp } from "./app.js";
import { BetterAuthAdapter } from "./adapters/better-auth.js";
import { logger } from "./middleware/logger.js";

async function bootstrap() {
  const env = loadEnv();

  logger.info({
    msg: "Bootstrapping OpenHR API...",
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

  // 2. Connect to database using application role
  const sql = postgres(env.DATABASE_URL, { max: 20 });
  const authPort = new BetterAuthAdapter(sql);

  // 3. Create Hono application
  const app = createApp({ sql, authPort });

  // 4. Start HTTP server
  serve(
    {
      fetch: app.fetch,
      port: env.PORT,
    },
    (info) => {
      logger.info({
        msg: `OpenHR API listening on port ${info.port}`,
        url: `http://localhost:${info.port}`,
      });
    },
  );
}

bootstrap().catch((err) => {
  process.stderr.write(`Fatal bootstrap error: ${String(err)}\n`);
  process.exit(1);
});
