import { Hono } from "hono";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { errorHandler } from "../src/middleware/error-handler.js";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
  type AppError,
} from "../src/errors/index.js";

function appThrowing(error: unknown) {
  const app = new Hono();
  app.get("/boom", () => {
    throw error;
  });
  app.onError(errorHandler);
  return app;
}

async function problemFor(error: unknown) {
  const res = await appThrowing(error).request("/boom");
  const body = (await res.json()) as Record<string, unknown>;
  return { res, body };
}

describe("errorHandler", () => {
  const cases: Array<[string, AppError, number, string]> = [
    ["NotFoundError", new NotFoundError(), 404, "NOT_FOUND"],
    ["UnauthorizedError", new UnauthorizedError(), 401, "UNAUTHORIZED"],
    ["ForbiddenError", new ForbiddenError(), 403, "FORBIDDEN"],
    ["ConflictError", new ConflictError(), 409, "CONFLICT"],
    ["ValidationError", new ValidationError(), 400, "VALIDATION_ERROR"],
    [
      "ValidationError (422)",
      new ValidationError({ status: 422 }),
      422,
      "VALIDATION_ERROR",
    ],
  ];

  it.each(cases)(
    "maps %s to a problem+json response",
    async (_name, error, status, code) => {
      const { res, body } = await problemFor(error);
      expect(res.status).toBe(status);
      expect(res.headers.get("content-type")).toContain(
        "application/problem+json",
      );
      expect(body).toMatchObject({
        type: "about:blank",
        status,
        code,
        instance: "/boom",
      });
      expect(typeof body["title"]).toBe("string");
      expect(JSON.stringify(body)).not.toContain("error-handler.test");
      expect(body).not.toHaveProperty("stack");
    },
  );

  it("exposes the safe detail and code chosen by the thrower", async () => {
    const { body } = await problemFor(
      new NotFoundError({ detail: "Employee not found", code: "EMP_404" }),
    );
    expect(body).toMatchObject({
      detail: "Employee not found",
      code: "EMP_404",
    });
  });

  it("includes sanitized field issues for ValidationError.fromZod", async () => {
    const parsed = z
      .object({ email: z.string().email() })
      .safeParse({ email: "secret-value" });
    if (parsed.success) throw new Error("expected parse failure");
    const { res, body } = await problemFor(
      ValidationError.fromZod(parsed.error),
    );
    expect(res.status).toBe(400);
    expect(body["errors"]).toEqual([
      { field: "email", message: "Invalid email" },
    ]);
    expect(JSON.stringify(body)).not.toContain("secret-value");
  });

  it("keeps mapping raw ZodErrors to 400", async () => {
    const parsed = z.object({ n: z.number() }).safeParse({});
    if (parsed.success) throw new Error("expected parse failure");
    const { res, body } = await problemFor(parsed.error);
    expect(res.status).toBe(400);
    expect(body).toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("returns a generic 500 for unknown errors without leaking details", async () => {
    const leaky = new Error("duplicate key value violates users_email_key");
    const { res, body } = await problemFor(leaky);
    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toContain(
      "application/problem+json",
    );
    expect(body).toMatchObject({ code: "INTERNAL_ERROR" });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("users_email_key");
    expect(serialized).not.toContain("error-handler.test");
  });
});
