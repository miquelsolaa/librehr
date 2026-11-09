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

// Compose often passes `VAR=` for unset values; treat empty as missing so
// the dev default (or the production check) applies.
const optionalString = z.preprocess(
  (v) => (v === "" ? undefined : v),
  z.string().optional(),
);
// Explicit opt-in flags: only "true"/"1" enable them; unset means off.
const booleanFlag = z.preprocess(
  (v) => (typeof v === "string" ? v.trim().toLowerCase() : v),
  z
    .enum(["true", "false", "1", "0", ""])
    .optional()
    .transform((v) => v === "true" || v === "1"),
);
// An origin is scheme://host[:port]. A path never matches the browser's
// Origin header, so it is rejected as a misconfiguration.
function asOrigin(value: string): string | null {
  try {
    const u = new URL(value);
    const ok =
      (u.protocol === "https:" || u.protocol === "http:") &&
      u.origin === value.replace(/\/$/, "");
    return ok ? u.origin : null;
  } catch {
    return null;
  }
}
const origin = z.string().transform((v, ctx) => {
  const parsed = asOrigin(v);
  if (!parsed) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "must be an http(s) origin without a path",
    });
    return z.NEVER;
  }
  return parsed;
});
const originList = z.preprocess(
  (v) =>
    typeof v === "string"
      ? v
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : v,
  z.array(origin).default([]),
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
    BETTER_AUTH_URL: z.string().default("http://localhost:3001"),
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
    /** Public URL of the web app; always an allowed CORS origin. */
    APP_URL: z.preprocess((v) => (v === "" ? undefined : v), origin.optional()),
    /** Further allowed CORS origins, comma-separated. */
    CORS_ORIGINS: originList,
    /** AUTH-004 has no callback yet, so SSO is off unless enabled. */
    SSO_ENABLED: booleanFlag,
    /** Development only: lets webhooks target http:// and private hosts. */
    WEBHOOKS_ALLOW_PRIVATE: booleanFlag,
  })
  .superRefine((env, ctx) => {
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
    if (env.WEBHOOKS_ALLOW_PRIVATE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["WEBHOOKS_ALLOW_PRIVATE"],
        message:
          "must not be enabled in production: webhooks may only target public https URLs",
      });
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
  });

export interface ApiEnv {
  NODE_ENV: "development" | "test" | "production";
  PORT: number;
  DATABASE_URL: string;
  DATABASE_MIGRATION_URL: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
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
  APP_URL?: string | undefined;
  CORS_ORIGINS: string[];
  SSO_ENABLED: boolean;
  WEBHOOKS_ALLOW_PRIVATE: boolean;
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
    ...(parsed.APP_URL ? { APP_URL: parsed.APP_URL } : {}),
    CORS_ORIGINS: parsed.CORS_ORIGINS,
    SSO_ENABLED: parsed.SSO_ENABLED,
    WEBHOOKS_ALLOW_PRIVATE: parsed.WEBHOOKS_ALLOW_PRIVATE,
  };
}
