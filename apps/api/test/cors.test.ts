import type { Sql } from "postgres";
import type { AuthPort } from "@librehr/core";
import { describe, it, expect } from "vitest";
import { createApp } from "../src/app.js";

describe("CORS middleware", () => {
  const app = createApp({
    sql: {} as unknown as Sql,
    authPort: {} as unknown as AuthPort,
  });

  it("handles preflight OPTIONS request with Access-Control-Allow-Origin", async () => {
    const res = await app.request("/v1/auth/sign-in", {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:3000",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "Content-Type",
      },
    });

    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:3000",
    );
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
  });

  it("includes CORS headers in regular requests", async () => {
    const res = await app.request("/healthz", {
      method: "GET",
      headers: {
        Origin: "http://localhost:3000",
      },
    });

    expect(res.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:3000",
    );
  });
});
