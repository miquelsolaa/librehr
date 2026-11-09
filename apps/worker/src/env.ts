import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

/** Local-only defaults. Never applied when NODE_ENV=production. */
const DEV_DEFAULTS = {
  DATABASE_URL:
    "postgres://librehr_owner:librehr_dev_password@localhost:5432/librehr",
  SMTP_HOST: "localhost",
  // Public: matches the API's development default so local chains verify.
  TIME_CHAIN_KEY: "dev_time_chain_key_must_be_changed_in_production_32",
} as const;

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v === "" ? undefined : v));

const RawEnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  // The worker owns pg-boss's schema, so it connects with the migration role when available.
  DATABASE_MIGRATION_URL: optionalString,
  DATABASE_URL: optionalString,
  LOG_LEVEL: z.string().default("info"),
  SMTP_HOST: optionalString,
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_USER: optionalString,
  SMTP_PASS: optionalString,
  SMTP_FROM: z.string().default("LibreHR <noreply@librehr.local>"),
  // Same key as the API: the audit.verify-chain job recomputes the HMACs.
  TIME_CHAIN_KEY: optionalString,
  TIME_CHAIN_KEY_FILE: optionalString,
});

export interface SmtpConfig {
  host: string;
  port: number;
  user?: string;
  pass?: string;
  from: string;
}

export interface WorkerEnv {
  NODE_ENV: "development" | "test" | "production";
  DATABASE_URL: string;
  LOG_LEVEL: string;
  /** HMAC key of the time-event chain (TIM-002); required in production. */
  TIME_CHAIN_KEY: string;
  /** null when SMTP is not configured: email jobs then fail instead of being dropped. */
  SMTP: SmtpConfig | null;
}

function tryLoadEnvFile(): void {
  if (typeof process.loadEnvFile !== "function") return;
  for (const c of [
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "../../.env"),
  ]) {
    if (fs.existsSync(c)) {
      try {
        process.loadEnvFile(c);
        return;
      } catch {
        // An unparseable file is ignored; the schema below still validates the result.
      }
    }
  }
}

/**
 * Parses and validates the worker environment. In production every dev default is disabled
 * and any value that still contains `dev_password` is rejected, so a misconfigured deployment
 * refuses to start instead of running against development credentials.
 * Error messages name variables only, never their values.
 */
export function loadWorkerEnv(
  envInput?: Record<string, string | undefined>,
): WorkerEnv {
  if (!envInput) tryLoadEnvFile();
  const parsed = RawEnvSchema.parse(envInput ?? process.env);
  const isProd = parsed.NODE_ENV === "production";

  let timeChainKey = parsed.TIME_CHAIN_KEY;
  if (parsed.TIME_CHAIN_KEY_FILE) {
    if (!fs.existsSync(parsed.TIME_CHAIN_KEY_FILE)) {
      throw new Error(
        "Invalid worker environment: TIME_CHAIN_KEY_FILE points to a file that does not exist",
      );
    }
    timeChainKey = fs.readFileSync(parsed.TIME_CHAIN_KEY_FILE, "utf-8").trim();
  }

  if (isProd) {
    const problems: string[] = [];
    if (!parsed.DATABASE_MIGRATION_URL && !parsed.DATABASE_URL) {
      problems.push("DATABASE_URL (or DATABASE_MIGRATION_URL) is required");
    }
    for (const key of [
      "DATABASE_MIGRATION_URL",
      "DATABASE_URL",
      "SMTP_USER",
      "SMTP_PASS",
    ] as const) {
      if (parsed[key]?.includes("dev_password")) {
        problems.push(`${key} contains a development password (dev_password)`);
      }
    }
    if (!timeChainKey || timeChainKey === DEV_DEFAULTS.TIME_CHAIN_KEY) {
      problems.push(
        "TIME_CHAIN_KEY (or TIME_CHAIN_KEY_FILE) is required and must not be the development default",
      );
    } else if (timeChainKey.length < 32) {
      problems.push("TIME_CHAIN_KEY must be at least 32 characters");
    }
    if (problems.length > 0) {
      throw new Error(`Invalid worker environment: ${problems.join("; ")}`);
    }
  }

  const databaseUrl =
    parsed.DATABASE_MIGRATION_URL ??
    parsed.DATABASE_URL ??
    DEV_DEFAULTS.DATABASE_URL;
  const smtpHost =
    parsed.SMTP_HOST ?? (isProd ? undefined : DEV_DEFAULTS.SMTP_HOST);

  return {
    NODE_ENV: parsed.NODE_ENV,
    DATABASE_URL: databaseUrl,
    LOG_LEVEL: parsed.LOG_LEVEL,
    TIME_CHAIN_KEY: timeChainKey ?? DEV_DEFAULTS.TIME_CHAIN_KEY,
    SMTP: smtpHost
      ? {
          host: smtpHost,
          port: parsed.SMTP_PORT,
          from: parsed.SMTP_FROM,
          ...(parsed.SMTP_USER ? { user: parsed.SMTP_USER } : {}),
          ...(parsed.SMTP_PASS ? { pass: parsed.SMTP_PASS } : {}),
        }
      : null,
  };
}
