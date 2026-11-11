import crypto from "node:crypto";
import type { TenantTx } from "../with-tenant.js";
import { hashBearerToken } from "../crypto/token-hash.js";

export interface InvitationRow {
  id: string;
  organizationId: string;
  email: string;
  role: string;
  /** The raw token for the invitation link. Only its hash is stored. */
  token: string;
  expiresAt: Date;
  /** TIM-008: access end date for the membership (auditors only). */
  accessExpiresAt: Date | null;
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
  accessExpiresAt?: Date | null | undefined;
}

export interface AcceptedInvitation {
  accessExpiresAt: Date | null;
  createdAt: Date;
}

export class InvitationRepository {
  async create(
    tx: TenantTx,
    data: CreateInvitationData,
  ): Promise<InvitationRow> {
    const token = crypto.randomBytes(32).toString("hex");
    const days = data.expiresInDays ?? 7; // 7 days per AUTH-005
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

    const rows = await tx<Omit<InvitationRow, "token">[]>`
      INSERT INTO invitations (
        email, role, token, expires_at, invited_by_id, access_expires_at
      ) VALUES (
        ${data.email.toLowerCase().trim()},
        ${data.role ?? "employee"},
        ${hashBearerToken(token)},
        ${expiresAt},
        ${data.invitedById ?? null},
        ${data.accessExpiresAt ?? null}
      )
      RETURNING id, organization_id as "organizationId", email, role,
                expires_at as "expiresAt", access_expires_at as "accessExpiresAt",
                invited_by_id as "invitedById", accepted_at as "acceptedAt",
                created_at as "createdAt", updated_at as "updatedAt"
    `;

    // The raw token exists only here, for the email; the row keeps the hash.
    return { ...rows[0]!, token };
  }

  // Token lookups happen before a tenant context exists: see
  // IdentityRepository.invitation.

  /**
   * Marks the invitation used and returns its access end date, or null when
   * it was already used or its access end date (TIM-008) has passed: an
   * auditor invitation whose access window is over cannot be accepted.
   */
  async markAccepted(
    tx: TenantTx,
    id: string,
  ): Promise<AcceptedInvitation | null> {
    const rows = await tx<AcceptedInvitation[]>`
      UPDATE invitations
      SET accepted_at = now(), updated_at = now()
      WHERE id = ${id}
        AND accepted_at IS NULL
        AND (access_expires_at IS NULL OR access_expires_at > now())
      RETURNING access_expires_at AS "accessExpiresAt", created_at AS "createdAt"
    `;
    return rows[0] ?? null;
  }

  /** TIM-008: the auditor access end date an invitation grants, if any. */
  async accessExpiresAt(tx: TenantTx, id: string): Promise<Date | null> {
    const rows = await tx<{ accessExpiresAt: Date | null }[]>`
      SELECT access_expires_at AS "accessExpiresAt"
      FROM invitations
      WHERE id = ${id}
        AND organization_id = ${tx.__tenantContext.organizationId}
    `;
    return rows[0]?.accessExpiresAt ?? null;
  }
}
