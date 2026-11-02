import type { TenantTx } from "../with-tenant.js";

export interface DocumentRow {
  id: string;
  organizationId: string;
  employeeId: string | null;
  employeeName?: string | null | undefined;
  title: string;
  category: string;
  description: string | null;
  audienceType: string;
  targetDepartmentId: string | null;
  targetLocationId: string | null;
  createdById: string;
  latestVersionNumber: number;
  latestFilename: string;
  latestMimeType: string;
  latestSizeBytes: number;
  latestStorageKey: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface DocumentVersionRow {
  id: string;
  organizationId: string;
  documentId: string;
  versionNumber: number;
  storageKey: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  sha256Hash: string;
  uploadedById: string;
  createdAt: Date;
}

export class DocumentRepository {
  async createDocument(
    tx: TenantTx,
    data: {
      employeeId?: string | null | undefined;
      title: string;
      category: string;
      description?: string | null | undefined;
      audienceType?: string | undefined;
      targetDepartmentId?: string | null | undefined;
      targetLocationId?: string | null | undefined;
      createdById: string;
      filename: string;
      mimeType: string;
      sizeBytes: number;
      sha256Hash: string;
      storageKey: string;
    },
  ): Promise<DocumentRow> {
    const docRows = await tx<{ id: string }[]>`
      INSERT INTO documents (
        employee_id, title, category, description,
        audience_type, target_department_id, target_location_id,
        created_by_id
      ) VALUES (
        ${data.employeeId ?? null},
        ${data.title},
        ${data.category},
        ${data.description ?? null},
        ${data.audienceType ?? "individual"},
        ${data.targetDepartmentId ?? null},
        ${data.targetLocationId ?? null},
        ${data.createdById}
      )
      RETURNING id
    `;

    const docId = docRows[0]!.id;

    await tx`
      INSERT INTO document_versions (
        document_id, version_number, storage_key,
        filename, mime_type, size_bytes, sha256_hash,
        uploaded_by_id
      ) VALUES (
        ${docId},
        1,
        ${data.storageKey},
        ${data.filename},
        ${data.mimeType},
        ${data.sizeBytes},
        ${data.sha256Hash},
        ${data.createdById}
      )
    `;

    const doc = await this.findById(tx, docId);
    return doc!;
  }

  async findById(tx: TenantTx, id: string): Promise<DocumentRow | null> {
    const rows = await tx<DocumentRow[]>`
      SELECT d.id, d.organization_id as "organizationId", d.employee_id as "employeeId",
             CONCAT(e.first_name, ' ', e.last_name) as "employeeName",
             d.title, d.category, d.description, d.audience_type as "audienceType",
             d.target_department_id as "targetDepartmentId", d.target_location_id as "targetLocationId",
             d.created_by_id as "createdById",
             v.version_number as "latestVersionNumber",
             v.filename as "latestFilename",
             v.mime_type as "latestMimeType",
             v.size_bytes as "latestSizeBytes",
             v.storage_key as "latestStorageKey",
             d.created_at as "createdAt", d.updated_at as "updatedAt"
      FROM documents d
      LEFT JOIN employees e ON e.id = d.employee_id
      JOIN LATERAL (
        SELECT version_number, filename, mime_type, size_bytes, storage_key
        FROM document_versions
        WHERE document_id = d.id
        ORDER BY version_number DESC
        LIMIT 1
      ) v ON true
      WHERE d.id = ${id}
      LIMIT 1
    `;
    return rows[0] ?? null;
  }

  async list(
    tx: TenantTx,
    filters: {
      employeeId?: string | undefined;
      category?: string | undefined;
      isCompanyWide?: boolean | undefined;
    } = {},
  ): Promise<DocumentRow[]> {
    return tx<DocumentRow[]>`
      SELECT d.id, d.organization_id as "organizationId", d.employee_id as "employeeId",
             CONCAT(e.first_name, ' ', e.last_name) as "employeeName",
             d.title, d.category, d.description, d.audience_type as "audienceType",
             d.target_department_id as "targetDepartmentId", d.target_location_id as "targetLocationId",
             d.created_by_id as "createdById",
             v.version_number as "latestVersionNumber",
             v.filename as "latestFilename",
             v.mime_type as "latestMimeType",
             v.size_bytes as "latestSizeBytes",
             v.storage_key as "latestStorageKey",
             d.created_at as "createdAt", d.updated_at as "updatedAt"
      FROM documents d
      LEFT JOIN employees e ON e.id = d.employee_id
      JOIN LATERAL (
        SELECT version_number, filename, mime_type, size_bytes, storage_key
        FROM document_versions
        WHERE document_id = d.id
        ORDER BY version_number DESC
        LIMIT 1
      ) v ON true
      WHERE (${filters.employeeId ?? null}::uuid IS NULL OR d.employee_id = ${filters.employeeId ?? null})
        AND (${filters.category ?? null}::text IS NULL OR d.category = ${filters.category ?? null})
        AND (
          ${filters.isCompanyWide ?? null}::boolean IS NULL
          OR (${filters.isCompanyWide ?? false} = true AND d.employee_id IS NULL)
          OR (${filters.isCompanyWide ?? false} = false AND d.employee_id IS NOT NULL)
        )
      ORDER BY d.created_at DESC
    `;
  }

  async delete(tx: TenantTx, id: string): Promise<boolean> {
    const res = await tx`DELETE FROM documents WHERE id = ${id}`;
    return res.count > 0;
  }

  async acknowledge(
    tx: TenantTx,
    documentId: string,
    employeeId: string,
  ): Promise<{ id: string; acknowledgedAt: Date }> {
    const rows = await tx<{ id: string; acknowledgedAt: Date }[]>`
      INSERT INTO document_acknowledgements (document_id, employee_id)
      VALUES (${documentId}, ${employeeId})
      RETURNING id, acknowledged_at as "acknowledgedAt"
    `;
    return rows[0]!;
  }

  async getAcknowledgements(
    tx: TenantTx,
    documentId: string,
  ): Promise<
    {
      id: string;
      employeeId: string;
      employeeName: string;
      acknowledgedAt: Date;
    }[]
  > {
    return tx<
      {
        id: string;
        employeeId: string;
        employeeName: string;
        acknowledgedAt: Date;
      }[]
    >`
      SELECT da.id, da.employee_id as "employeeId",
             CONCAT(e.first_name, ' ', e.last_name) as "employeeName",
             da.acknowledged_at as "acknowledgedAt"
      FROM document_acknowledgements da
      JOIN employees e ON e.id = da.employee_id
      WHERE da.document_id = ${documentId}
      ORDER BY da.acknowledged_at DESC
    `;
  }
}
