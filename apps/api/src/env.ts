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

function resolveSecret(val?: string, fileVal?: string): string | undefined {
  if (fileVal && fs.existsSync(fileVal)) {
    return fs.readFileSync(fileVal, "utf-8").trim();
  }
  return val;
}

const RawEnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z
    .string()
    .default(
      "postgres://librehr_app:librehr_dev_password@localhost:5432/librehr",
    ),
  DATABASE_MIGRATION_URL: z
    .string()
    .default(
      "postgres://librehr_owner:librehr_dev_password@localhost:5432/librehr",
    ),
  BETTER_AUTH_SECRET: z
    .string()
    .default("dev_auth_secret_must_be_changed_in_production_min_32_chars"),
  BETTER_AUTH_SECRET_FILE: z.string().optional(),
  BETTER_AUTH_URL: z.string().default("http://localhost:3001"),
  ENVELOPE_MASTER_KEY: z
    .string()
    .default("ZGV2X2VudmVsb3BlX21hc3Rlcl9rZXlfZm9yX2xvY2FsX2Rldg=="),
  ENVELOPE_MASTER_KEY_FILE: z.string().optional(),
  ENVELOPE_KEY_ID: z.string().default("v1"),
  SMTP_HOST: z.string().default("localhost"),
  SMTP_PORT: z.coerce.number().default(1025),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().default("LibreHR <noreply@librehr.local>"),
  LOG_LEVEL: z.string().default("info"),
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
  SMTP_HOST: string;
  SMTP_PORT: number;
  SMTP_USER?: string | undefined;
  SMTP_PASS?: string | undefined;
  SMTP_FROM: string;
  LOG_LEVEL: string;
}

export function loadEnv(envInput?: Record<string, string | undefined>): ApiEnv {
  if (!envInput) {
    tryLoadEnv();
  }
  const input = envInput ?? process.env;
  const parsed = RawEnvSchema.parse(input);

  const authSecret = resolveSecret(
    parsed.BETTER_AUTH_SECRET,
    parsed.BETTER_AUTH_SECRET_FILE,
  );
  const envelopeKey = resolveSecret(
    parsed.ENVELOPE_MASTER_KEY,
    parsed.ENVELOPE_MASTER_KEY_FILE,
  );

  return {
    NODE_ENV: parsed.NODE_ENV,
    PORT: parsed.PORT,
    DATABASE_URL: parsed.DATABASE_URL,
    DATABASE_MIGRATION_URL:
      parsed.DATABASE_MIGRATION_URL ||
      "postgres://librehr_owner:librehr_dev_password@localhost:5432/librehr",
    BETTER_AUTH_SECRET: authSecret ?? parsed.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: parsed.BETTER_AUTH_URL,
    ENVELOPE_MASTER_KEY: envelopeKey ?? parsed.ENVELOPE_MASTER_KEY,
    ENVELOPE_KEY_ID: parsed.ENVELOPE_KEY_ID,
    SMTP_HOST: parsed.SMTP_HOST,
    SMTP_PORT: parsed.SMTP_PORT,
    ...(parsed.SMTP_USER ? { SMTP_USER: parsed.SMTP_USER } : {}),
    ...(parsed.SMTP_PASS ? { SMTP_PASS: parsed.SMTP_PASS } : {}),
    SMTP_FROM: parsed.SMTP_FROM,
    LOG_LEVEL: parsed.LOG_LEVEL,
  };
}
