import type { TenantTx } from "../with-tenant.js";

/** An auditor membership of the current organization (TIM-008). */
export interface AuditorRow {
  userId: string;
  name: string;
  email: string;
  /** Never null: migration 0029 enforces an end date for auditors. */
  accessExpiresAt: Date;
}

/** A pending (not accepted, link still valid) auditor invitation. */
export interface PendingAuditorInvitationRow {
  id: string;
  email: string;
  accessExpiresAt: Date;
  expiresAt: Date;
}

/**
 * What an access end day is checked against: the database clock (the clock
 * the membership lookup compares against), the organization's time zone and
 * its maximum.
 */
export interface AuditorAccessWindow {
  now: Date;
  timeZone: string;
  maxDays: number;
}

export interface AuditorRevocationResult {
  accessExpiresAt: Date;
  sessions: number;
  tokens: number;
}

/**
 * TIM-008: time-boxed auditor access. The membership lookup
 * (librehr_auth_membership, migration 0029) refuses an auditor membership
 * once access_expires_at has passed; this repository reads and moves that
 * date. Every query runs inside a tenant transaction and also filters on the
 * tenant's organization id, so a missing RLS context cannot widen it.
 */
export class AuditorAccessRepository {
  async window(tx: TenantTx): Promise<AuditorAccessWindow> {
    const rows = await tx<AuditorAccessWindow[]>`
      SELECT now() AS "now", o.timezone AS "timeZone",
             o.auditor_access_max_days AS "maxDays"
      FROM organizations o
      WHERE o.id = ${tx.__tenantContext.organizationId}
    `;
    const row = rows[0];
    if (!row) throw new Error("Organization not found for tenant context");
    return row;
  }

  async list(tx: TenantTx): Promise<AuditorRow[]> {
    return tx<AuditorRow[]>`
      SELECT m.user_id AS "userId", u.name, u.email,
             m.access_expires_at AS "accessExpiresAt"
      FROM memberships m
      JOIN users u ON u.id = m.user_id
      WHERE m.role = 'auditor'
        AND m.organization_id = ${tx.__tenantContext.organizationId}
      ORDER BY u.name, m.user_id
    `;
  }

  async listPendingInvitations(
    tx: TenantTx,
  ): Promise<PendingAuditorInvitationRow[]> {
    return tx<PendingAuditorInvitationRow[]>`
      SELECT id, email, access_expires_at AS "accessExpiresAt",
             expires_at AS "expiresAt"
      FROM invitations
      WHERE role = 'auditor' AND accepted_at IS NULL AND expires_at > now()
        AND organization_id = ${tx.__tenantContext.organizationId}
      ORDER BY created_at, id
    `;
  }

  /** Expires a pending auditor invitation's link. False when none matched. */
  async cancelInvitation(tx: TenantTx, id: string): Promise<boolean> {
    const result = await tx`
      UPDATE invitations SET expires_at = now(), updated_at = now()
      WHERE id = ${id} AND role = 'auditor'
        AND accepted_at IS NULL AND expires_at > now()
        AND organization_id = ${tx.__tenantContext.organizationId}
    `;
    return result.count > 0;
  }

  /**
   * Expires every pending invitation of this organization for the email,
   * whatever its role: accepting one would rewrite the membership and could
   * hand back access an admin just revoked or shortened.
   */
  async expirePendingInvitationsFor(
    tx: TenantTx,
    email: string,
  ): Promise<number> {
    const result = await tx`
      UPDATE invitations SET expires_at = now(), updated_at = now()
      WHERE lower(email) = lower(${email})
        AND accepted_at IS NULL AND expires_at > now()
        AND organization_id = ${tx.__tenantContext.organizationId}
    `;
    return result.count;
  }

  /** Locks and returns the user's auditor membership, or null. */
  async findForUpdate(
    tx: TenantTx,
    userId: string,
  ): Promise<AuditorRow | null> {
    const rows = await tx<AuditorRow[]>`
      SELECT m.user_id AS "userId", u.name, u.email,
             m.access_expires_at AS "accessExpiresAt"
      FROM memberships m
      JOIN users u ON u.id = m.user_id
      WHERE m.user_id = ${userId} AND m.role = 'auditor'
        AND m.organization_id = ${tx.__tenantContext.organizationId}
      FOR UPDATE OF m
    `;
    return rows[0] ?? null;
  }

  /**
   * Whether the user's membership here is an auditor membership changed
   * (access extended, shortened or revoked) after `since`.
   */
  async auditorMembershipChangedAfter(
    tx: TenantTx,
    userId: string,
    since: Date,
  ): Promise<boolean> {
    const rows = await tx<{ changed: boolean }[]>`
      SELECT updated_at > ${since} AS changed
      FROM memberships
      WHERE user_id = ${userId} AND role = 'auditor'
        AND organization_id = ${tx.__tenantContext.organizationId}
      FOR UPDATE
    `;
    return rows[0]?.changed ?? false;
  }

  async setAccessExpiry(
    tx: TenantTx,
    userId: string,
    accessExpiresAt: Date,
  ): Promise<Date> {
    const rows = await tx<{ accessExpiresAt: Date }[]>`
      UPDATE memberships
      SET access_expires_at = ${accessExpiresAt}, updated_at = now()
      WHERE user_id = ${userId} AND role = 'auditor'
        AND organization_id = ${tx.__tenantContext.organizationId}
      RETURNING access_expires_at AS "accessExpiresAt"
    `;
    const row = rows[0];
    if (!row) throw new Error("Auditor membership vanished during update");
    return row.accessExpiresAt;
  }

  /**
   * Ends the auditor's access now and deletes their credentials for this
   * organization, like EMP-007 termination: sessions bound here, sessions
   * not yet bound to any organization (they may resolve to this membership
   * on first use) and personal access tokens. Credentials bound to other
   * organizations are left alone.
   */
  async revoke(tx: TenantTx, userId: string): Promise<AuditorRevocationResult> {
    const orgId = tx.__tenantContext.organizationId;
    const rows = await tx<{ accessExpiresAt: Date }[]>`
      UPDATE memberships
      SET access_expires_at = now(), updated_at = now()
      WHERE user_id = ${userId} AND role = 'auditor'
        AND organization_id = ${orgId}
      RETURNING access_expires_at AS "accessExpiresAt"
    `;
    const row = rows[0];
    if (!row) throw new Error("Auditor membership vanished during revoke");
    const sessions = await tx`
      DELETE FROM sessions
      WHERE user_id = ${userId}
        AND (organization_id = ${orgId} OR organization_id IS NULL)
    `;
    const tokens = await tx`
      DELETE FROM personal_access_tokens
      WHERE user_id = ${userId} AND organization_id = ${orgId}
    `;
    return {
      accessExpiresAt: row.accessExpiresAt,
      sessions: sessions.count,
      tokens: tokens.count,
    };
  }
}
