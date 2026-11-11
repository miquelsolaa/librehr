import type { TenantTx } from "../with-tenant.js";

export interface TimeCorrectionRow {
  id: string;
  organizationId: string;
  employeeId: string;
  employeeName?: string | undefined;
  refEventId: string | null;
  proposedEventType: string;
  proposedOccurredAt: Date;
  reason: string;
  status: string; // pending, approved, rejected
  approverId: string | null;
  approverName?: string | null | undefined;
  decidedAt: Date | null;
  decisionReason: string | null;
  createdEventId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export class TimeCorrectionRepository {
  async create(
    tx: TenantTx,
    data: {
      employeeId: string;
      refEventId?: string | null | undefined;
      proposedEventType: string;
      proposedOccurredAt: Date;
      reason: string;
    },
  ): Promise<TimeCorrectionRow> {
    const rows = await tx<TimeCorrectionRow[]>`
      INSERT INTO time_corrections (
        employee_id, ref_event_id, proposed_event_type,
        proposed_occurred_at, reason, status
      ) VALUES (
        ${data.employeeId},
        ${data.refEventId ?? null},
        ${data.proposedEventType},
        ${data.proposedOccurredAt},
        ${data.reason},
        'pending'
      )
      RETURNING id, organization_id as "organizationId", employee_id as "employeeId",
                ref_event_id as "refEventId", proposed_event_type as "proposedEventType",
                proposed_occurred_at as "proposedOccurredAt", reason, status,
                approver_id as "approverId", decided_at as "decidedAt",
                decision_reason as "decisionReason", created_event_id as "createdEventId",
                created_at as "createdAt", updated_at as "updatedAt"
    `;
    return rows[0]!;
  }

  async list(
    tx: TenantTx,
    filters: {
      employeeId?: string | undefined;
      status?: string | undefined;
    } = {},
  ): Promise<TimeCorrectionRow[]> {
    return tx<TimeCorrectionRow[]>`
      SELECT c.id, c.organization_id as "organizationId", c.employee_id as "employeeId",
             CONCAT(e.first_name, ' ', e.last_name) as "employeeName",
             c.ref_event_id as "refEventId", c.proposed_event_type as "proposedEventType",
             c.proposed_occurred_at as "proposedOccurredAt", c.reason, c.status,
             c.approver_id as "approverId",
             CONCAT(a.first_name, ' ', a.last_name) as "approverName",
             c.decided_at as "decidedAt", c.decision_reason as "decisionReason",
             c.created_event_id as "createdEventId",
             c.created_at as "createdAt", c.updated_at as "updatedAt"
      FROM time_corrections c
      JOIN employees e ON e.id = c.employee_id
      LEFT JOIN employees a ON a.id = c.approver_id
      WHERE (${filters.employeeId ?? null}::uuid IS NULL OR c.employee_id = ${filters.employeeId ?? null})
        AND (${filters.status ?? null}::text IS NULL OR c.status = ${filters.status ?? null})
        AND c.organization_id = ${tx.__tenantContext.organizationId}
      ORDER BY c.created_at DESC
    `;
  }

  async findById(tx: TenantTx, id: string): Promise<TimeCorrectionRow | null> {
    const rows = await tx<TimeCorrectionRow[]>`
      SELECT c.id, c.organization_id as "organizationId", c.employee_id as "employeeId",
             CONCAT(e.first_name, ' ', e.last_name) as "employeeName",
             c.ref_event_id as "refEventId", c.proposed_event_type as "proposedEventType",
             c.proposed_occurred_at as "proposedOccurredAt", c.reason, c.status,
             c.approver_id as "approverId",
             CONCAT(a.first_name, ' ', a.last_name) as "approverName",
             c.decided_at as "decidedAt", c.decision_reason as "decisionReason",
             c.created_event_id as "createdEventId",
             c.created_at as "createdAt", c.updated_at as "updatedAt"
      FROM time_corrections c
      JOIN employees e ON e.id = c.employee_id
      LEFT JOIN employees a ON a.id = c.approver_id
      WHERE c.id = ${id} AND c.organization_id = ${tx.__tenantContext.organizationId}
      LIMIT 1
    `;
    return rows[0] ?? null;
  }

  async updateDecision(
    tx: TenantTx,
    id: string,
    data: {
      status: "approved" | "rejected";
      approverId: string;
      decisionReason?: string | null | undefined;
      createdEventId?: string | null | undefined;
    },
  ): Promise<TimeCorrectionRow> {
    const updated = await tx<TimeCorrectionRow[]>`
      UPDATE time_corrections
      SET status = ${data.status},
          approver_id = ${data.approverId},
          decided_at = now(),
          decision_reason = ${data.decisionReason ?? null},
          created_event_id = ${data.createdEventId ?? null},
          updated_at = now()
      WHERE id = ${id}
      RETURNING id, organization_id as "organizationId", employee_id as "employeeId",
                ref_event_id as "refEventId", proposed_event_type as "proposedEventType",
                proposed_occurred_at as "proposedOccurredAt", reason, status,
                approver_id as "approverId", decided_at as "decidedAt",
                decision_reason as "decisionReason", created_event_id as "createdEventId",
                created_at as "createdAt", updated_at as "updatedAt"
    `;

    return updated[0]!;
  }
}
