import crypto from "node:crypto";
import type { TenantTx } from "../with-tenant.js";

export interface InvitationRow {
  id: string;
  organizationId: string;
  email: string;
  role: string;
  token: string;
  expiresAt: Date;
  invitedById: string | null;
  acceptedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateInvitationData {
  email: string;
  role?: string | undefined;
  invitedById?: string | null | undefined;
  expiresInDays?: number | undefined;
}

export class InvitationRepository {
  async create(
    tx: TenantTx,
    data: CreateInvitationData,
  ): Promise<InvitationRow> {
    const token = crypto.randomBytes(32).toString("hex");
    const days = data.expiresInDays ?? 7; // 7 days per AUTH-005
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

    const rows = await tx<InvitationRow[]>`
      INSERT INTO invitations (
        email, role, token, expires_at, invited_by_id
      ) VALUES (
        ${data.email.toLowerCase().trim()},
        ${data.role ?? "employee"},
        ${token},
        ${expiresAt},
        ${data.invitedById ?? null}
      )
      RETURNING id, organization_id as "organizationId", email, role,
                token, expires_at as "expiresAt", invited_by_id as "invitedById",
                accepted_at as "acceptedAt", created_at as "createdAt", updated_at as "updatedAt"
    `;

    return rows[0]!;
  }

  // Token lookups happen before a tenant context exists: see
  // IdentityRepository.invitation.

  async markAccepted(tx: TenantTx, idOrToken: string): Promise<boolean> {
    const result = await tx`
      UPDATE invitations
      SET accepted_at = now(), updated_at = now()
      WHERE (id = ${idOrToken} OR token = ${idOrToken})
        AND accepted_at IS NULL
    `;
    return result.count > 0;
  }
}
