import { Hono } from "hono";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { errorHandler } from "../src/middleware/error-handler.js";
import {
  IdParamSchema,
  parseJsonBody,
  parseParams,
  parseQuery,
} from "../src/lib/validate.js";

const BodySchema = z.object({ name: z.string().min(1) });
const QuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

function buildApp() {
  const app = new Hono();
  app.post("/body", async (c) => c.json(await parseJsonBody(c, BodySchema)));
  app.post("/body-422", async (c) =>
    c.json(await parseJsonBody(c, BodySchema, { status: 422 })),
  );
  app.get("/query", (c) => c.json(parseQuery(c, QuerySchema)));
  app.get("/items/:id", (c) => c.json(parseParams(c, IdParamSchema)));
  app.onError(errorHandler);
  return app;
}

const post = (path: string, body: string) =>
  buildApp().request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });

describe("parseJsonBody", () => {
  it("returns the parsed data for a valid body", async () => {
    const res = await post("/body", JSON.stringify({ name: "x" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: "x" });
  });

  it("rejects malformed JSON with 400 problem+json", async () => {
    const res = await post("/body", "{not json");
    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toContain(
      "application/problem+json",
    );
    expect(await res.json()).toMatchObject({ code: "MALFORMED_JSON" });
  });

  it("rejects an empty body with 400", async () => {
    const res = await post("/body", "");
    expect(res.status).toBe(400);
  });

  it("rejects a schema mismatch with 400 and field issues", async () => {
    const res = await post("/body", JSON.stringify({ name: "" }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string; errors: unknown[] };
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.errors).toHaveLength(1);
  });

  it("honours a 422 status for routes that already use it", async () => {
    const res = await post("/body-422", JSON.stringify({}));
    expect(res.status).toBe(422);
  });
});

describe("parseQuery", () => {
  it("coerces valid query values", async () => {
    const res = await buildApp().request("/query?limit=5");
    expect(await res.json()).toEqual({ limit: 5 });
  });

  it("rejects non-numeric values with 400 instead of passing NaN", async () => {
    const res = await buildApp().request("/query?limit=abc");
    expect(res.status).toBe(400);
  });
});

describe("parseParams", () => {
  it("accepts a UUID id", async () => {
    const id = "6f1c2a4e-8b3d-4c5e-9f7a-1b2c3d4e5f60";
    const res = await buildApp().request(`/items/${id}`);
    expect(await res.json()).toEqual({ id });
  });

  it("returns 404 for a malformed id, matching the existing convention", async () => {
    const res = await buildApp().request("/items/not-a-uuid");
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain(
      "application/problem+json",
    );
  });
});
