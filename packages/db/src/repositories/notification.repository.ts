import type { TenantTx } from "../with-tenant.js";

export interface NotificationRow {
  id: string;
  organizationId: string;
  userId: string;
  title: string;
  body: string;
  category: string;
  link: string | null;
  read: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export class NotificationRepository {
  async create(
    tx: TenantTx,
    data: {
      userId: string;
      title: string;
      body: string;
      category: string;
      link?: string | null | undefined;
    },
  ): Promise<NotificationRow> {
    const rows = await tx<NotificationRow[]>`
      INSERT INTO notifications (
        user_id, title, body, category, link, read
      ) VALUES (
        ${data.userId},
        ${data.title},
        ${data.body},
        ${data.category},
        ${data.link ?? null},
        false
      )
      RETURNING id, organization_id as "organizationId", user_id as "userId",
                title, body, category, link, read,
                created_at as "createdAt", updated_at as "updatedAt"
    `;
    return rows[0]!;
  }

  /**
   * Creates the notification unless the user already has one with the same
   * category and link, which together act as its idempotency key. A
   * transaction-scoped advisory lock on that key serializes concurrent
   * callers. Returns null when it already existed.
   */
  async createOnce(
    tx: TenantTx,
    data: {
      userId: string;
      title: string;
      body: string;
      category: string;
      link: string;
    },
  ): Promise<NotificationRow | null> {
    const lockKey = `notification:${tx.__tenantContext.organizationId}:${data.userId}:${data.category}:${data.link}`;
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
    const existing = await tx<{ id: string }[]>`
      SELECT id FROM notifications
      WHERE user_id = ${data.userId} AND category = ${data.category}
        AND link = ${data.link}
      LIMIT 1
    `;
    if (existing.length > 0) return null;
    return this.create(tx, data);
  }

  async getForUser(
    tx: TenantTx,
    userId: string,
    limit: number = 30,
  ): Promise<{ items: NotificationRow[]; unreadCount: number }> {
    const items = await tx<NotificationRow[]>`
      SELECT id, organization_id as "organizationId", user_id as "userId",
             title, body, category, link, read,
             created_at as "createdAt", updated_at as "updatedAt"
      FROM notifications
      WHERE user_id = ${userId}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;

    const countResult = await tx<[{ count: string }]>`
      SELECT COUNT(*)::text as count
      FROM notifications
      WHERE user_id = ${userId} AND read = false
    `;

    const unreadCount = parseInt(countResult[0]?.count ?? "0", 10);
    return { items, unreadCount };
  }

  /** Marks one of the user's own notifications read; false if none matched. */
  async markAsRead(tx: TenantTx, id: string, userId: string): Promise<boolean> {
    const result = await tx`
      UPDATE notifications
      SET read = true, updated_at = now()
      WHERE id = ${id} AND user_id = ${userId}
        AND organization_id = ${tx.__tenantContext.organizationId}
    `;
    return result.count > 0;
  }

  async markAllAsRead(tx: TenantTx, userId: string): Promise<number> {
    const result = await tx`
      UPDATE notifications
      SET read = true, updated_at = now()
      WHERE user_id = ${userId} AND read = false
    `;
    return result.count;
  }
}
