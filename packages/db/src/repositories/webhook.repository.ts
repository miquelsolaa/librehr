import type { TenantTx } from "../with-tenant.js";

export interface WebhookRow {
  id: string;
  organizationId: string;
  name: string;
  url: string;
  secret: string;
  events: string[];
  enabled: boolean;
  lastDeliveryStatus: number | null;
  lastDeliveredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export class WebhookRepository {
  async list(tx: TenantTx): Promise<WebhookRow[]> {
    const rows = await tx<WebhookRow[]>`
      SELECT
        id,
        organization_id as "organizationId",
        name,
        url,
        secret,
        events,
        enabled,
        last_delivery_status as "lastDeliveryStatus",
        last_delivered_at as "lastDeliveredAt",
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM webhooks
      ORDER BY created_at DESC
    `;
    return rows;
  }

  async getById(tx: TenantTx, id: string): Promise<WebhookRow | null> {
    const rows = await tx<WebhookRow[]>`
      SELECT
        id,
        organization_id as "organizationId",
        name,
        url,
        secret,
        events,
        enabled,
        last_delivery_status as "lastDeliveryStatus",
        last_delivered_at as "lastDeliveredAt",
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM webhooks
      WHERE id = ${id}
      LIMIT 1
    `;
    return rows[0] ?? null;
  }

  async create(
    tx: TenantTx,
    data: {
      name: string;
      url: string;
      secret: string;
      events: string[];
      enabled?: boolean;
    },
  ): Promise<WebhookRow> {
    const enabled = data.enabled ?? true;
    const rows = await tx<WebhookRow[]>`
      INSERT INTO webhooks (
        name,
        url,
        secret,
        events,
        enabled
      ) VALUES (
        ${data.name},
        ${data.url},
        ${data.secret},
        ${JSON.stringify(data.events)}::jsonb,
        ${enabled}
      )
      RETURNING
        id,
        organization_id as "organizationId",
        name,
        url,
        secret,
        events,
        enabled,
        last_delivery_status as "lastDeliveryStatus",
        last_delivered_at as "lastDeliveredAt",
        created_at as "createdAt",
        updated_at as "updatedAt"
    `;
    return rows[0]!;
  }

  async update(
    tx: TenantTx,
    id: string,
    data: {
      name?: string;
      url?: string;
      secret?: string;
      events?: string[];
      enabled?: boolean;
    },
  ): Promise<WebhookRow | null> {
    const existing = await this.getById(tx, id);
    if (!existing) return null;

    const name = data.name ?? existing.name;
    const url = data.url ?? existing.url;
    const secret = data.secret ?? existing.secret;
    const events = data.events ?? existing.events;
    const enabled =
      data.enabled !== undefined ? data.enabled : existing.enabled;

    const rows = await tx<WebhookRow[]>`
      UPDATE webhooks
      SET
        name = ${name},
        url = ${url},
        secret = ${secret},
        events = ${JSON.stringify(events)}::jsonb,
        enabled = ${enabled},
        updated_at = now()
      WHERE id = ${id}
      RETURNING
        id,
        organization_id as "organizationId",
        name,
        url,
        secret,
        events,
        enabled,
        last_delivery_status as "lastDeliveryStatus",
        last_delivered_at as "lastDeliveredAt",
        created_at as "createdAt",
        updated_at as "updatedAt"
    `;
    return rows[0] ?? null;
  }

  async delete(tx: TenantTx, id: string): Promise<boolean> {
    const result = await tx`
      DELETE FROM webhooks
      WHERE id = ${id}
    `;
    return (result.count ?? 0) > 0;
  }

  async updateDeliveryStatus(
    tx: TenantTx,
    id: string,
    status: number,
  ): Promise<void> {
    await tx`
      UPDATE webhooks
      SET
        last_delivery_status = ${status},
        last_delivered_at = now(),
        updated_at = now()
      WHERE id = ${id}
    `;
  }
}
