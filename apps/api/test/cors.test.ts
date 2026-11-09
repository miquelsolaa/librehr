import type { Sql } from "postgres";
import type { AuthPort } from "../src/ports/auth.js";
import { describe, it, expect } from "vitest";
import { createApp, resolveAppConfig, type AppConfig } from "../src/app.js";

function appWith(config: Partial<AppConfig>) {
  return createApp({
    sql: {} as unknown as Sql,
    authPort: {} as unknown as AuthPort,
    config,
  });
}

function preflight(app: ReturnType<typeof createApp>, origin: string) {
  return app.request("/v1/auth/sign-in", {
    method: "OPTIONS",
    headers: {
      Origin: origin,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "Content-Type",
    },
  });
}

describe("CORS middleware", () => {
  describe("outside production", () => {
    const app = appWith({ nodeEnv: "development" });

    it("handles preflight OPTIONS request with Access-Control-Allow-Origin", async () => {
      const res = await preflight(app, "http://localhost:3000");

      expect(res.status).toBe(204);
      expect(res.headers.get("access-control-allow-origin")).toBe(
        "http://localhost:3000",
      );
      expect(res.headers.get("access-control-allow-methods")).toContain("POST");
      expect(res.headers.get("access-control-allow-credentials")).toBe("true");
    });

    it("includes CORS headers in regular requests", async () => {
      const res = await app.request("/healthz", {
        method: "GET",
        headers: { Origin: "http://localhost:3000" },
      });

      expect(res.headers.get("access-control-allow-origin")).toBe(
        "http://localhost:3000",
      );
    });

    it("exposes the TIM-006 export id and content hash headers", async () => {
      const res = await app.request("/healthz", {
        method: "GET",
        headers: { Origin: "http://localhost:3000" },
      });
      const exposed = res.headers.get("access-control-expose-headers") ?? "";
      expect(exposed).toContain("X-Export-Id");
      expect(exposed).toContain("X-Content-SHA256");
    });

    it("allows local dev servers on any port", async () => {
      for (const origin of ["http://localhost:5173", "http://127.0.0.1:3000"]) {
        const res = await preflight(app, origin);
        expect(res.headers.get("access-control-allow-origin")).toBe(origin);
      }
    });

    it("rejects look-alike and unknown origins", async () => {
      for (const origin of [
        "http://localhost.evil.example",
        "http://localhost:3000.evil.example",
        "https://evil.example",
        "null",
      ]) {
        const res = await preflight(app, origin);
        expect(res.headers.get("access-control-allow-origin")).toBeNull();
      }
    });
  });

  describe("in production", () => {
    const app = appWith({
      nodeEnv: "production",
      appUrl: "https://hr.example.com",
      corsOrigins: ["https://admin.example.com"],
    });

    it("rejects localhost and 127.0.0.1 origins", async () => {
      for (const origin of [
        "http://localhost:3000",
        "http://localhost:5173",
        "http://127.0.0.1:3000",
      ]) {
        const res = await preflight(app, origin);
        expect(res.headers.get("access-control-allow-origin")).toBeNull();
      }
    });

    it("allows APP_URL and the configured CORS_ORIGINS", async () => {
      for (const origin of [
        "https://hr.example.com",
        "https://admin.example.com",
      ]) {
        const res = await preflight(app, origin);
        expect(res.headers.get("access-control-allow-origin")).toBe(origin);
      }
    });

    it("rejects other origins and does not default one in", async () => {
      const res = await preflight(app, "https://evil.example");
      expect(res.headers.get("access-control-allow-origin")).toBeNull();

      const noOrigin = await app.request("/healthz");
      expect(noOrigin.headers.get("access-control-allow-origin")).toBeNull();
    });
  });

  it("treats an unknown NODE_ENV as production", () => {
    const previous = process.env["NODE_ENV"];
    process.env["NODE_ENV"] = "staging";
    try {
      const config = resolveAppConfig({ webhooksAllowPrivate: true });
      expect(config.nodeEnv).toBe("production");
      expect(config.webhooksAllowPrivate).toBe(false);
      expect(config.ssoEnabled).toBe(false);
    } finally {
      process.env["NODE_ENV"] = previous;
    }
  });
});
