import { Hono } from "hono";
import type { Sql } from "postgres";
import { type AuthUser, createProblemDetails } from "@librehr/contracts";
import { withTenant, NotificationRepository } from "@librehr/db";
import { requireAuth } from "../middleware/auth.js";

export function createNotificationRoutes(sql: Sql) {
  const router = new Hono();
  const notificationRepo = new NotificationRepository();

  // 1. GET /notifications - List user's notifications and unread count
  router.get("/notifications", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;
    const limitStr = c.req.query("limit");
    const limit = limitStr ? parseInt(limitStr, 10) : 30;

    const data = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        return notificationRepo.getForUser(tx, user.id, limit);
      },
    );

    return c.json({
      items: data.items.map((n) => ({
        id: n.id,
        title: n.title,
        body: n.body,
        category: n.category,
        link: n.link,
        read: n.read,
        createdAt: n.createdAt.toISOString(),
      })),
      unreadCount: data.unreadCount,
    });
  });

  // 2. PATCH /notifications/:id/read - Mark notification as read
  router.patch("/notifications/:id/read", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;
    const notificationId = c.req.param("id");

    const updated = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        return notificationRepo.markAsRead(tx, notificationId);
      },
    );

    if (!updated) {
      const problem = createProblemDetails({
        status: 404,
        title: "Not Found",
        detail: "Notification not found",
        code: "NOTIFICATION_NOT_FOUND",
      });
      return c.json(problem, 404, {
        "Content-Type": "application/problem+json",
      });
    }

    return c.json({ success: true, id: notificationId });
  });

  // 3. POST /notifications/read-all - Mark all user notifications as read
  router.post("/notifications/read-all", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;

    const count = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        return notificationRepo.markAllAsRead(tx, user.id);
      },
    );

    return c.json({ success: true, count });
  });

  return router;
}
