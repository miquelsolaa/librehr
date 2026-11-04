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
        ${data.metadata ? JSON.stringify(data.metadata) : null}::jsonb
      )
      RETURNING id, organization_id as "organizationId", actor_id as "actorId",
                action, resource_type as "resourceType", resource_id as "resourceId",
                metadata, created_at as "createdAt"
    `;
    return rows[0]!;
  }

  async list(
    tx: TenantTx,
    filters: ListAuditLogFilters = {},
  ): Promise<AuditLogRow[]> {
    const limit = Math.min(100, Math.max(1, filters.limit ?? 50));

    return tx<AuditLogRow[]>`
      SELECT id, organization_id as "organizationId", actor_id as "actorId",
             action, resource_type as "resourceType", resource_id as "resourceId",
             metadata, created_at as "createdAt"
      FROM audit_log
      WHERE (${filters.resourceType ?? null}::text IS NULL OR resource_type = ${filters.resourceType ?? null})
        AND (${filters.resourceId ?? null}::text IS NULL OR resource_id = ${filters.resourceId ?? null})
        AND (${filters.actorId ?? null}::uuid IS NULL OR actor_id = ${filters.actorId ?? null})
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
  }
}
