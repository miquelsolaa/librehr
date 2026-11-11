import type { ErrorHandler } from "hono";
import { ZodError } from "zod";
import { createProblemDetails, type ProblemDetails } from "@librehr/contracts";
import { AppError } from "../errors/index.js";
import { logger } from "./logger.js";

function problemResponse(problem: ProblemDetails) {
  return new Response(JSON.stringify(problem), {
    status: problem.status,
    headers: { "Content-Type": "application/problem+json" },
  });
}

export const errorHandler: ErrorHandler = (err, c) => {
  const traceId = (c.get("requestId") as string | undefined) || undefined;

  // 1. Expected, typed application errors: every field is safe to expose.
  if (err instanceof AppError) {
    return problemResponse({
      ...createProblemDetails({
        status: err.status,
        title: err.title,
        detail: err.detail,
        code: err.code,
        traceId,
        instance: c.req.path,
        errors: err.errors,
      }),
      type: err.type,
    });
  }

  // 2. Zod Validation Error (HTTP 400)
  if (err instanceof ZodError) {
    const errors = err.errors.map((e) => ({
      field: e.path.join("."),
      message: e.message,
    }));

    return problemResponse(
      createProblemDetails({
        status: 400,
        title: "Bad Request",
        detail: "Request validation failed",
        code: "VALIDATION_ERROR",
        traceId,
        instance: c.req.path,
        errors,
      }),
    );
  }

  // 3. Default Internal Server Error (HTTP 500)
  // Never leak stack traces or internal messages to clients. The log keeps
  // only the error class and driver code: messages may embed PII from SQL
  // parameters or constraint details.
  const code: unknown = "code" in err ? err.code : undefined;
  logger.error({
    requestId: traceId,
    method: c.req.method,
    path: c.req.path,
    errorName: err.name,
    errorCode: typeof code === "string" ? code : undefined,
  });

  return problemResponse(
    createProblemDetails({
      status: 500,
      title: "Internal Server Error",
      detail: "An unexpected internal server error occurred",
      code: "INTERNAL_ERROR",
      traceId,
      instance: c.req.path,
    }),
  );
};
