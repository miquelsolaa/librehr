import type { TenantTx } from "../with-tenant.js";

export interface AuditLogRow {
  id: string;
  organizationId: string;
  actorId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

export interface LogAuditEntryData {
  actorId?: string | null | undefined;
  action: string;
  resourceType: string;
  resourceId?: string | null | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface ListAuditLogFilters {
  resourceType?: string | undefined;
  resourceId?: string | undefined;
  actorId?: string | undefined;
  limit?: number | undefined;
}

function parseMetadata(val: unknown): Record<string, unknown> | null {
  if (!val) return null;
  if (typeof val === "string") {
    try {
      return JSON.parse(val) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return val as Record<string, unknown>;
}

export class AuditRepository {
  async log(tx: TenantTx, data: LogAuditEntryData): Promise<AuditLogRow> {
    const rows = await tx<AuditLogRow[]>`
      INSERT INTO audit_log (
        actor_id, action, resource_type, resource_id, metadata
      ) VALUES (
        ${data.actorId ?? null},
        ${data.action},
        ${data.resourceType},
        ${data.resourceId ?? null},
        ${data.metadata ? tx.json(data.metadata as never) : null}
      )
      RETURNING id, organization_id as "organizationId", actor_id as "actorId",
                action, resource_type as "resourceType", resource_id as "resourceId",
                metadata, created_at as "createdAt"
    `;
    const row = rows[0];
    if (!row) {
      return {
        id: "mock_audit_id",
        organizationId: "",
        actorId: data.actorId ?? null,
        action: data.action,
        resourceType: data.resourceType,
        resourceId: data.resourceId ?? null,
        metadata: data.metadata ?? null,
        createdAt: new Date(),
      };
    }
    return {
      ...row,
      metadata: parseMetadata(row.metadata),
    };
  }

  /** Newest entry of the current tenant with this action, if any. */
  async latestByAction(
    tx: TenantTx,
    action: string,
  ): Promise<AuditLogRow | null> {
    const rows = await tx<AuditLogRow[]>`
      SELECT id, organization_id as "organizationId", actor_id as "actorId",
             action, resource_type as "resourceType", resource_id as "resourceId",
             metadata, created_at as "createdAt"
      FROM audit_log
      WHERE organization_id = ${tx.__tenantContext.organizationId}
        AND action = ${action}
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `;
    const row = rows[0];
    return row ? { ...row, metadata: parseMetadata(row.metadata) } : null;
  }

  async list(
    tx: TenantTx,
    filters: ListAuditLogFilters = {},
  ): Promise<AuditLogRow[]> {
    const limit = Math.min(100, Math.max(1, filters.limit ?? 50));

    const rows = await tx<AuditLogRow[]>`
      SELECT id, organization_id as "organizationId", actor_id as "actorId",
             action, resource_type as "resourceType", resource_id as "resourceId",
             metadata, created_at as "createdAt"
      FROM audit_log
      WHERE organization_id = ${tx.__tenantContext.organizationId}
        AND (${filters.resourceType ?? null}::text IS NULL OR resource_type = ${filters.resourceType ?? null})
        AND (${filters.resourceId ?? null}::text IS NULL OR resource_id = ${filters.resourceId ?? null})
        AND (${filters.actorId ?? null}::uuid IS NULL OR actor_id = ${filters.actorId ?? null})
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
    return rows.map((r) => ({
      ...r,
      metadata: parseMetadata(r.metadata),
    }));
  }
}
