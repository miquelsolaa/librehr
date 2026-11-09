import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

function tryLoadEnv(): void {
  if (typeof process.loadEnvFile === "function") {
    const candidates = [
      path.resolve(process.cwd(), ".env"),
      path.resolve(process.cwd(), "../../.env"),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) {
        try {
          process.loadEnvFile(c);
          break;
        } catch {
          // ignore unparseable env file
        }
      }
    }
  }
}

// Development-only defaults. They are public (they live in the repo), so
// production must never run with them; see the superRefine below.
const DEV_DATABASE_URL =
  "postgres://librehr_app:librehr_dev_password@localhost:5432/librehr";
const DEV_DATABASE_MIGRATION_URL =
  "postgres://librehr_owner:librehr_dev_password@localhost:5432/librehr";
const DEV_BETTER_AUTH_SECRET =
  "dev_auth_secret_must_be_changed_in_production_min_32_chars";
const DEV_ENVELOPE_MASTER_KEY =
  "ZGV2X2VudmVsb3BlX21hc3Rlcl9rZXlfZm9yX2xvY2FsX2Rldg==";
const DEV_SESSION_SECRET =
  "dev_session_secret_must_be_changed_in_production_32";
const DEV_TIME_CHAIN_KEY =
  "dev_time_chain_key_must_be_changed_in_production_32";

/** Secrets that may also be provided as `<NAME>_FILE` (Docker secrets). */
const FILE_SECRETS = [
  "BETTER_AUTH_SECRET",
  "ENVELOPE_MASTER_KEY",
  "SESSION_SECRET",
  "TIME_CHAIN_KEY",
] as const;

const DEV_SECRET_VALUES: Record<(typeof FILE_SECRETS)[number], string> = {
  BETTER_AUTH_SECRET: DEV_BETTER_AUTH_SECRET,
  ENVELOPE_MASTER_KEY: DEV_ENVELOPE_MASTER_KEY,
  SESSION_SECRET: DEV_SESSION_SECRET,
  TIME_CHAIN_KEY: DEV_TIME_CHAIN_KEY,
};

const PROD_HINT = "generate one with `openssl rand -base64 32`";

const DEV_BETTER_AUTH_URL = "http://localhost:3001";
const DEV_APP_URL = "http://localhost:3000";

/**
 * Roles that must never serve requests: the migration/owner role and the
 * usual name of the bootstrap superuser. The API runs as librehr_app so RLS
 * applies to every request.
 */
const NON_RUNTIME_DB_USERS = ["librehr_owner", "postgres"];

/** The URL's user name, or null when it does not parse as a Postgres URL. */
function databaseUser(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
      return null;
    }
    return decodeURIComponent(parsed.username);
  } catch {
    return null;
  }
}

function isLocalhostUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  } catch {
    return false;
  }
}

// Compose often passes `VAR=` for unset values; treat empty as missing so
// the dev default (or the production check) applies.
const optionalString = z.preprocess(
  (v) => (v === "" ? undefined : v),
  z.string().optional(),
);
const secret = (devDefault: string) =>
  z.preprocess(
    (v) => (v === "" ? undefined : v),
    z
      .string()
      .min(32, { message: "must be at least 32 characters" })
      .default(devDefault),
  );

const RawEnvSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    PORT: z.coerce.number().default(3001),
    DATABASE_URL: z.string().min(1).default(DEV_DATABASE_URL),
    DATABASE_MIGRATION_URL: z
      .string()
      .min(1)
      .default(DEV_DATABASE_MIGRATION_URL),
    BETTER_AUTH_SECRET: secret(DEV_BETTER_AUTH_SECRET),
    BETTER_AUTH_URL: z.string().default(DEV_BETTER_AUTH_URL),
    APP_URL: z.string().default(DEV_APP_URL),
    // Only used to recognise the bootstrap superuser in DATABASE_URL.
    POSTGRES_USER: optionalString,
    ENVELOPE_MASTER_KEY: secret(DEV_ENVELOPE_MASTER_KEY),
    ENVELOPE_KEY_ID: z.string().default("v1"),
    SESSION_SECRET: secret(DEV_SESSION_SECRET),
    TIME_CHAIN_KEY: secret(DEV_TIME_CHAIN_KEY),
    SMTP_HOST: z.string().default("localhost"),
    SMTP_PORT: z.coerce.number().default(1025),
    SMTP_USER: optionalString,
    SMTP_PASS: optionalString,
    SMTP_FROM: z.string().default("LibreHR <noreply@librehr.local>"),
    LOG_LEVEL: z.string().default("info"),
  })
  .superRefine((env, ctx) => {
    for (const key of ["DATABASE_URL", "DATABASE_MIGRATION_URL"] as const) {
      if (databaseUser(env[key]) === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message:
            "is not a valid postgres:// URL; URL-encode special characters in the user name and password (e.g. `/` as %2F, `+` as %2B, `@` as %40)",
        });
      }
    }
    if (env.NODE_ENV !== "production") return;
    for (const key of FILE_SECRETS) {
      if (env[key] === DEV_SECRET_VALUES[key]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `is missing or uses the public development default; set ${key} (or ${key}_FILE) to a unique value in production (${PROD_HINT})`,
        });
      }
    }
    for (const key of ["DATABASE_URL", "DATABASE_MIGRATION_URL"] as const) {
      if (env[key].includes("dev_password")) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `is missing or contains a development password; set ${key} with a real password in production`,
        });
      }
    }
    const runtimeUser = databaseUser(env.DATABASE_URL);
    const forbiddenUsers = new Set(NON_RUNTIME_DB_USERS);
    if (env.POSTGRES_USER) forbiddenUsers.add(env.POSTGRES_USER);
    const migrationUser = databaseUser(env.DATABASE_MIGRATION_URL);
    if (migrationUser) forbiddenUsers.add(migrationUser);
    if (runtimeUser !== null && forbiddenUsers.has(runtimeUser)) {
      // Never echo the user name: name the variable and the expected role.
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["DATABASE_URL"],
        message:
          "connects as the owner/migration or bootstrap role; the API must connect as the runtime role (librehr_app) so row-level security applies",
      });
    }
    for (const key of ["BETTER_AUTH_URL", "APP_URL"] as const) {
      if (isLocalhostUrl(env[key])) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `is missing or points to localhost; set ${key} to the public URL in production`,
        });
      }
    }
  });

export interface ApiEnv {
  NODE_ENV: "development" | "test" | "production";
  PORT: number;
  DATABASE_URL: string;
  DATABASE_MIGRATION_URL: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  APP_URL: string;
  ENVELOPE_MASTER_KEY: string;
  ENVELOPE_KEY_ID: string;
  SESSION_SECRET: string;
  TIME_CHAIN_KEY: string;
  SMTP_HOST: string;
  SMTP_PORT: number;
  SMTP_USER?: string | undefined;
  SMTP_PASS?: string | undefined;
  SMTP_FROM: string;
  LOG_LEVEL: string;
}

/**
 * Replaces `<NAME>` with the contents of `<NAME>_FILE` when the latter is set.
 * A `_FILE` that points nowhere is a deployment error, so it fails loudly
 * instead of silently falling back to a default.
 */
function resolveFileSecrets(
  input: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const resolved = { ...input };
  for (const key of FILE_SECRETS) {
    const filePath = input[`${key}_FILE`];
    if (!filePath) continue;
    if (!fs.existsSync(filePath)) {
      throw new Error(
        `Invalid API environment configuration: ${key}_FILE points to a file that does not exist`,
      );
    }
    resolved[key] = fs.readFileSync(filePath, "utf-8").trim();
  }
  return resolved;
}

export function loadEnv(envInput?: Record<string, string | undefined>): ApiEnv {
  if (!envInput) {
    tryLoadEnv();
  }
  const input = resolveFileSecrets(envInput ?? process.env);
  const result = RawEnvSchema.safeParse(input);
  if (!result.success) {
    // Only paths and our own messages: never echo the offending values.
    const details = result.error.issues
      .map((issue) => `- ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid API environment configuration:\n${details}`);
  }
  const parsed = result.data;

  return {
    NODE_ENV: parsed.NODE_ENV,
    PORT: parsed.PORT,
    DATABASE_URL: parsed.DATABASE_URL,
    DATABASE_MIGRATION_URL: parsed.DATABASE_MIGRATION_URL,
    BETTER_AUTH_SECRET: parsed.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: parsed.BETTER_AUTH_URL,
    APP_URL: parsed.APP_URL,
    ENVELOPE_MASTER_KEY: parsed.ENVELOPE_MASTER_KEY,
    ENVELOPE_KEY_ID: parsed.ENVELOPE_KEY_ID,
    SESSION_SECRET: parsed.SESSION_SECRET,
    TIME_CHAIN_KEY: parsed.TIME_CHAIN_KEY,
    SMTP_HOST: parsed.SMTP_HOST,
    SMTP_PORT: parsed.SMTP_PORT,
    ...(parsed.SMTP_USER ? { SMTP_USER: parsed.SMTP_USER } : {}),
    ...(parsed.SMTP_PASS ? { SMTP_PASS: parsed.SMTP_PASS } : {}),
    SMTP_FROM: parsed.SMTP_FROM,
    LOG_LEVEL: parsed.LOG_LEVEL,
  };
}
