import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { Sql } from "postgres";
import type { AuthPort } from "../src/ports/auth.js";
import { createApp, type AppConfig } from "../src/app.js";
import {
  createCsrfMiddleware,
  type CsrfOptions,
} from "../src/middleware/csrf.js";
import { errorHandler } from "../src/middleware/error-handler.js";

// AUTH-002: CSRF defence must fail closed when the environment is unknown and
// agree with CORS on which cross-origin clients may use the cookie.
function postFrom(options: CsrfOptions, origin: string) {
  const app = new Hono();
  app.use("*", createCsrfMiddleware(options));
  app.post("/x", (c) => c.text("ok"));
  app.onError(errorHandler);
  return app.request("/x", { method: "POST", headers: { Origin: origin } });
}

describe("CSRF middleware", () => {
  it("rejects a localhost origin when nodeEnv is not given", async () => {
    expect((await postFrom({}, "http://localhost:3000")).status).toBe(403);
    expect((await postFrom({}, "http://127.0.0.1:3000")).status).toBe(403);
  });

  it("trusts localhost only in development and test", async () => {
    for (const nodeEnv of ["development", "test"] as const) {
      expect(
        (await postFrom({ nodeEnv }, "http://localhost:3000")).status,
      ).toBe(200);
    }
    expect(
      (await postFrom({ nodeEnv: "production" }, "http://localhost:3000"))
        .status,
    ).toBe(403);
  });

  it("trusts the app URL and the configured cross-origin clients", async () => {
    const options: CsrfOptions = {
      nodeEnv: "production",
      appUrl: "https://hr.example.com",
      allowedOrigins: ["https://mobile.example.com"],
    };
    expect((await postFrom(options, "https://hr.example.com")).status).toBe(
      200,
    );
    expect((await postFrom(options, "https://mobile.example.com")).status).toBe(
      200,
    );
    expect((await postFrom(options, "https://evil.example")).status).toBe(403);
  });
});

describe("CSRF wiring in createApp", () => {
  const signOutFrom = (config: Partial<AppConfig>, origin: string) =>
    createApp({
      sql: {} as unknown as Sql,
      authPort: {} as unknown as AuthPort,
      // No top-level nodeEnv: CSRF must use the resolved config.
      config,
    }).request("/v1/auth/sign-out", {
      method: "POST",
      headers: { Origin: origin },
    });

  it("uses the resolved nodeEnv, not the raw dependency", async () => {
    const res = await signOutFrom(
      { nodeEnv: "production" },
      "http://localhost:3000",
    );
    expect(res.status).toBe(403);
  });

  it("accepts the CORS_ORIGINS clients", async () => {
    const config: Partial<AppConfig> = {
      nodeEnv: "production",
      corsOrigins: ["https://mobile.example.com"],
    };
    expect(
      (await signOutFrom(config, "https://mobile.example.com")).status,
    ).toBe(200);
    expect((await signOutFrom(config, "https://evil.example")).status).toBe(
      403,
    );
  });
});
