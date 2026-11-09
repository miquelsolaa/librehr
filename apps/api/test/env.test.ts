import { describe, it, expect } from "vitest";
import { loadEnv } from "../src/env.js";

// Values are generated for the test only; they are not dev defaults.
const strongProdEnv = {
  NODE_ENV: "production",
  DATABASE_URL: "postgres://librehr_app:Zq8vT2mN4rK7pL1x@db:5432/librehr",
  DATABASE_MIGRATION_URL:
    "postgres://librehr_owner:Hc3wY9bF6jD2sQ5u@db:5432/librehr",
  BETTER_AUTH_SECRET: "prod-auth-secret-7f3a9c1e5b2d8f4a6c0e9b7d",
  BETTER_AUTH_URL: "https://api.example.test",
  APP_URL: "https://hr.example.test",
  ENVELOPE_MASTER_KEY: "q3nJ0m5r8VtZ2yB6cF9hK1pW4sX7uA0dE3gH6jL9nQ8=",
  SESSION_SECRET: "prod-session-secret-4e8b2a6f0c9d3e7a1b5f",
  TIME_CHAIN_KEY: "prod-time-chain-key-9d1c5f3a7e2b6d0c4a8f",
};

function errorMessage(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  throw new Error("expected loadEnv to throw");
}

describe("loadEnv (DOC-004, AUTH-001)", () => {
  it("keeps dev defaults outside production", () => {
    const env = loadEnv({ NODE_ENV: "development" });
    expect(env.BETTER_AUTH_SECRET.length).toBeGreaterThanOrEqual(32);
    expect(env.SESSION_SECRET.length).toBeGreaterThanOrEqual(32);
    expect(env.TIME_CHAIN_KEY.length).toBeGreaterThanOrEqual(32);
    expect(env.DATABASE_URL).toContain("librehr");
  });

  it("accepts strong, explicit values in production", () => {
    const env = loadEnv(strongProdEnv);
    expect(env.NODE_ENV).toBe("production");
    expect(env.SESSION_SECRET).toBe(strongProdEnv.SESSION_SECRET);
    expect(env.TIME_CHAIN_KEY).toBe(strongProdEnv.TIME_CHAIN_KEY);
  });

  it("rejects production when every secret falls back to a dev default", () => {
    const msg = errorMessage(() => loadEnv({ NODE_ENV: "production" }));
    for (const key of [
      "BETTER_AUTH_SECRET",
      "ENVELOPE_MASTER_KEY",
      "SESSION_SECRET",
      "TIME_CHAIN_KEY",
      "DATABASE_URL",
      "DATABASE_MIGRATION_URL",
    ]) {
      expect(msg).toContain(key);
    }
  });

  it("rejects explicitly provided dev defaults in production", () => {
    const dev = loadEnv({ NODE_ENV: "development" });
    const msg = errorMessage(() =>
      loadEnv({
        ...strongProdEnv,
        BETTER_AUTH_SECRET: dev.BETTER_AUTH_SECRET,
        ENVELOPE_MASTER_KEY: dev.ENVELOPE_MASTER_KEY,
      }),
    );
    expect(msg).toContain("BETTER_AUTH_SECRET");
    expect(msg).toContain("ENVELOPE_MASTER_KEY");
    // Never echo secret values back in the error.
    expect(msg).not.toContain(dev.BETTER_AUTH_SECRET);
    expect(msg).not.toContain(dev.ENVELOPE_MASTER_KEY);
  });

  it("rejects database URLs with a dev password in production", () => {
    const msg = errorMessage(() =>
      loadEnv({
        ...strongProdEnv,
        DATABASE_URL: "postgres://librehr_app:my_dev_password@db:5432/librehr",
      }),
    );
    expect(msg).toContain("DATABASE_URL");
    expect(msg).not.toContain("my_dev_password");
  });

  it("rejects a DATABASE_URL that connects as the owner role in production", () => {
    const msg = errorMessage(() =>
      loadEnv({
        ...strongProdEnv,
        DATABASE_URL:
          "postgres://librehr_owner:Zq8vT2mN4rK7pL1x@db:5432/librehr",
      }),
    );
    expect(msg).toContain("DATABASE_URL");
    expect(msg).toContain("librehr_app");
    expect(msg).not.toContain("Zq8vT2mN4rK7pL1x");
  });

  it("rejects a DATABASE_URL that connects as the bootstrap superuser in production", () => {
    for (const [user, extra] of [
      ["postgres", {}],
      ["custom_admin", { POSTGRES_USER: "custom_admin" }],
    ] as const) {
      const msg = errorMessage(() =>
        loadEnv({
          ...strongProdEnv,
          ...extra,
          DATABASE_URL: `postgres://${user}:Zq8vT2mN4rK7pL1x@db:5432/librehr`,
        }),
      );
      expect(msg).toContain("DATABASE_URL");
      expect(msg).not.toContain("Zq8vT2mN4rK7pL1x");
      expect(msg).not.toContain(`${user}:`);
    }
  });

  it("rejects localhost APP_URL and BETTER_AUTH_URL in production", () => {
    const { APP_URL: _a, BETTER_AUTH_URL: _b, ...withoutUrls } = strongProdEnv;
    const msg = errorMessage(() => loadEnv(withoutUrls));
    expect(msg).toContain("APP_URL");
    expect(msg).toContain("BETTER_AUTH_URL");
    const explicit = errorMessage(() =>
      loadEnv({ ...strongProdEnv, APP_URL: "http://127.0.0.1:3000" }),
    );
    expect(explicit).toContain("APP_URL");
  });

  it("rejects an unparseable DATABASE_URL without echoing it", () => {
    // A base64 password with `/` breaks URL parsing unless it is URL-encoded.
    const badUrl = "postgres://librehr_app:ab/cd+ef=@db:5432/librehr";
    const msg = errorMessage(() =>
      loadEnv({ NODE_ENV: "development", DATABASE_URL: badUrl }),
    );
    expect(msg).toContain("DATABASE_URL");
    expect(msg).toContain("URL-encode");
    expect(msg).not.toContain("ab/cd");
    // The same password URL-encoded is accepted.
    const ok = loadEnv({
      NODE_ENV: "development",
      DATABASE_URL: "postgres://librehr_app:ab%2Fcd%2Bef%3D@db:5432/librehr",
    });
    expect(ok.DATABASE_URL).toContain("db:5432");
  });

  it("rejects short secrets in production", () => {
    const msg = errorMessage(() =>
      loadEnv({ ...strongProdEnv, SESSION_SECRET: "short" }),
    );
    expect(msg).toContain("SESSION_SECRET");
    expect(msg).not.toContain('"short"');
  });
});
