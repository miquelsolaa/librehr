import type { TenantTx } from "../with-tenant.js";

/** ORG-007 (ADR 0008): projects and areas, stored in org_groups (0046). */
export type OrgGroupKind = "project" | "area";

export interface OrgGroupRow {
  id: string;
  organizationId: string;
  kind: OrgGroupKind;
  name: string;
  description: string | null;
  parentId: string | null;
  leadEmployeeId: string | null;
  /** Calendar dates (`YYYY-MM-DD`). */
  startsOn: string | null;
  endsOn: string | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateOrgGroupData {
  kind: OrgGroupKind;
  name: string;
  description?: string | null | undefined;
  parentId?: string | null | undefined;
  leadEmployeeId?: string | null | undefined;
  startsOn?: string | null | undefined;
  endsOn?: string | null | undefined;
}

/** Fields left undefined are kept; null clears an optional field. */
export type UpdateOrgGroupData = Partial<Omit<CreateOrgGroupData, "kind">>;

const columns = (tx: TenantTx) => tx`
  id, organization_id as "organizationId", kind, name, description,
  parent_id as "parentId", lead_employee_id as "leadEmployeeId",
  starts_on::text as "startsOn", ends_on::text as "endsOn",
  archived_at as "archivedAt", created_at as "createdAt",
  updated_at as "updatedAt"
`;

/**
 * Every query also filters on the tenant explicitly, on top of RLS, as the
 * department repository does. Groups are archived, never deleted (ADR 0008).
 */
export class OrgGroupRepository {
  async findMany(
    tx: TenantTx,
    filter: { kind?: OrgGroupKind; includeArchived?: boolean } = {},
  ): Promise<OrgGroupRow[]> {
    const orgId = tx.__tenantContext.organizationId;
    return tx<OrgGroupRow[]>`
      SELECT ${columns(tx)}
      FROM org_groups
      WHERE organization_id = ${orgId}
        ${filter.kind ? tx`AND kind = ${filter.kind}` : tx``}
        ${filter.includeArchived ? tx`` : tx`AND archived_at IS NULL`}
      ORDER BY kind ASC, lower(name) ASC, id ASC
    `;
  }

  async findById(tx: TenantTx, id: string): Promise<OrgGroupRow | null> {
    const rows = await tx<OrgGroupRow[]>`
      SELECT ${columns(tx)}
      FROM org_groups
      WHERE id = ${id} AND organization_id = ${tx.__tenantContext.organizationId}
      LIMIT 1
    `;
    return rows[0] ?? null;
  }

  async create(tx: TenantTx, data: CreateOrgGroupData): Promise<OrgGroupRow> {
    const rows = await tx<OrgGroupRow[]>`
      INSERT INTO org_groups (
        kind, name, description, parent_id, lead_employee_id, starts_on, ends_on
      )
      VALUES (
        ${data.kind}, ${data.name}, ${data.description ?? null},
        ${data.parentId ?? null}, ${data.leadEmployeeId ?? null},
        ${data.startsOn ?? null}, ${data.endsOn ?? null}
      )
      RETURNING ${columns(tx)}
    `;
    return rows[0]!;
  }

  async update(
    tx: TenantTx,
    id: string,
    data: UpdateOrgGroupData,
  ): Promise<OrgGroupRow | null> {
    const updates: Record<string, unknown> = {};
    if (data.name !== undefined) updates["name"] = data.name;
    if (data.description !== undefined)
      updates["description"] = data.description;
    if (data.parentId !== undefined) updates["parent_id"] = data.parentId;
    if (data.leadEmployeeId !== undefined)
      updates["lead_employee_id"] = data.leadEmployeeId;
    if (data.startsOn !== undefined) updates["starts_on"] = data.startsOn;
    if (data.endsOn !== undefined) updates["ends_on"] = data.endsOn;
    if (Object.keys(updates).length === 0) return this.findById(tx, id);

    const rows = await tx<OrgGroupRow[]>`
      UPDATE org_groups
      SET ${tx(updates)}, updated_at = now()
      WHERE id = ${id} AND organization_id = ${tx.__tenantContext.organizationId}
      RETURNING ${columns(tx)}
    `;
    return rows[0] ?? null;
  }

  /**
   * Archives a group. Idempotent: an archived group keeps its first
   * archived_at. Null when the group does not exist in this tenant.
   */
  async archive(tx: TenantTx, id: string): Promise<OrgGroupRow | null> {
    const rows = await tx<OrgGroupRow[]>`
      UPDATE org_groups
      SET archived_at = coalesce(archived_at, now()), updated_at = now()
      WHERE id = ${id} AND organization_id = ${tx.__tenantContext.organizationId}
      RETURNING ${columns(tx)}
    `;
    return rows[0] ?? null;
  }
}
