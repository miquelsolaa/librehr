import { Hono } from "hono";
import type { Sql } from "postgres";

export function createHealthRoutes(sql: Sql) {
  const router = new Hono();

  router.get("/healthz", (c) => {
    return c.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  router.get("/readyz", async (c) => {
    try {
      await sql`SELECT 1`;
      return c.json({ status: "ready", database: "connected" });
    } catch {
      return c.json({ status: "unready", database: "disconnected" }, 503);
    }
  });

  return router;
}
