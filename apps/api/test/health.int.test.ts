import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Sql } from "postgres";
import { getTestDatabase, type TestDatabase } from "@librehr/testing";
import { createApp } from "../src/app.js";
import { BetterAuthAdapter } from "../src/adapters/better-auth.js";

describe("Health & OpenAPI Endpoints", () => {
  let db: TestDatabase | null = null;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    db = await getTestDatabase();
    const sql = db?.sql ?? ((async () => []) as unknown as Sql);
    const authPort = new BetterAuthAdapter(sql);
    app = createApp({ sql, authPort });
  });

  afterAll(async () => {
    if (db) await db.close();
  });

  it("GET /healthz returns 200 ok", async () => {
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("ok");
  });

  it("GET /readyz returns readiness status", async () => {
    const res = await app.request("/readyz");
    expect([200, 503]).toContain(res.status);
  });

  it("GET /v1/openapi.json returns valid OpenAPI 3.1 schema", async () => {
    const res = await app.request("/v1/openapi.json");
    expect(res.status).toBe(200);
    const spec = (await res.json()) as {
      openapi: string;
      info: { title: string };
    };
    expect(spec.openapi).toMatch(/^3\./);
    expect(spec.info.title).toBeDefined();
  });
});
