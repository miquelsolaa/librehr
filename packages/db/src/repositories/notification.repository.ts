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

/**
 * TIM-003: categories that `createOnce` deduplicates. Each one needs a
 * partial unique index on (organization_id, user_id, category, link) and a
 * matching conflict target in `createOnce`; adding a category here means a
 * migration that widens the index (see 0032).
 */
export const ONCE_NOTIFICATION_CATEGORIES = ["time_missing_clock_out"] as const;
export type OnceNotificationCategory =
  (typeof ONCE_NOTIFICATION_CATEGORIES)[number];

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
   * category and link, which together act as its idempotency key. Returns
   * null when it already existed.
   *
   * Enforced by the database, not by a prior read: the partial unique index
   * `notifications_missing_clock_out_once` (migration 0032) makes concurrent
   * callers insert one row between them. The conflict target names that
   * index, so a database without it fails loudly instead of writing
   * duplicates. The row's organization comes from the RLS context, as in
   * `create`, so the key is scoped to the tenant.
   */
  async createOnce(
    tx: TenantTx,
    data: {
      userId: string;
      title: string;
      body: string;
      category: OnceNotificationCategory;
      link: string;
    },
  ): Promise<NotificationRow | null> {
    const rows = await tx<NotificationRow[]>`
      INSERT INTO notifications (
        user_id, title, body, category, link, read
      ) VALUES (
        ${data.userId},
        ${data.title},
        ${data.body},
        ${data.category},
        ${data.link},
        false
      )
      ON CONFLICT (organization_id, user_id, category, link)
        WHERE category = 'time_missing_clock_out'
        DO NOTHING
      RETURNING id, organization_id as "organizationId", user_id as "userId",
                title, body, category, link, read,
                created_at as "createdAt", updated_at as "updatedAt"
    `;
    return rows[0] ?? null;
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
