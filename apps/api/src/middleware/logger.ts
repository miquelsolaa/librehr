import pino from "pino";
import type { MiddlewareHandler } from "hono";

export const logger = pino({
  level: process.env["LOG_LEVEL"] || "info",
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export const loggerMiddleware: MiddlewareHandler = async (c, next) => {
  const start = Date.now();
  const requestId = c.get("requestId") as string | undefined;

  await next();

  const duration = Date.now() - start;
  // Strictly log structured metadata without personal identifiable information
  logger.info({
    requestId,
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    durationMs: duration,
  });
};
