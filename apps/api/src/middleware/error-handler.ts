import type { ErrorHandler } from "hono";
import { ZodError } from "zod";
import { createProblemDetails } from "@openhr/contracts";

export const errorHandler: ErrorHandler = (err, c) => {
  const traceId = (c.get("requestId") as string | undefined) || undefined;

  // 1. Zod Validation Error (HTTP 400)
  if (err instanceof ZodError) {
    const errors = err.errors.map((e) => ({
      field: e.path.join("."),
      message: e.message,
    }));

    const problem = createProblemDetails({
      status: 400,
      title: "Bad Request",
      detail: "Request validation failed",
      code: "VALIDATION_ERROR",
      traceId,
      instance: c.req.path,
      errors,
    });

    return c.json(problem, 400, {
      "Content-Type": "application/problem+json",
    });
  }

  // 2. Default Internal Server Error (HTTP 500)
  // Never leak stack traces or internal server error messages to clients
  const problem = createProblemDetails({
    status: 500,
    title: "Internal Server Error",
    detail: "An unexpected internal server error occurred",
    code: "INTERNAL_ERROR",
    traceId,
    instance: c.req.path,
  });

  return c.json(problem, 500, {
    "Content-Type": "application/problem+json",
  });
};
