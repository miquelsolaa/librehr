import type { TenantTx } from "../with-tenant.js";

/** An auditor membership of the current organization (TIM-008). */
export interface AuditorRow {
  userId: string;
  name: string;
  email: string;
  accessExpiresAt: Date | null;
}

/**
 * The window an auditor access end date must fall in, read from the
 * database clock (the same clock the membership lookup compares against).
 */
export interface AuditorAccessWindow {
  now: Date;
  /** now + organizations.auditor_access_max_days. */
  latest: Date;
  maxDays: number;
}

export interface AuditorRevocationResult {
  sessions: number;
  tokens: number;
}

/**
 * TIM-008: time-boxed auditor access. The membership lookup
 * (librehr_auth_membership, migration 0029) refuses an auditor membership
 * once access_expires_at has passed; this repository reads and moves that
 * date. Every query runs inside a tenant transaction, so RLS confines it to
 * the caller's organization.
 */
export class AuditorAccessRepository {
  async window(tx: TenantTx): Promise<AuditorAccessWindow> {
    const rows = await tx<AuditorAccessWindow[]>`
      SELECT now() AS "now",
             now() + make_interval(days => o.auditor_access_max_days) AS "latest",
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
      ORDER BY m.access_expires_at NULLS LAST, u.name, m.user_id
    `;
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
      FOR UPDATE OF m
    `;
    return rows[0] ?? null;
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
      RETURNING access_expires_at AS "accessExpiresAt"
    `;
    const row = rows[0];
    if (!row) throw new Error("Auditor membership vanished during update");
    return row.accessExpiresAt;
  }

  /**
   * Ends the auditor's access now and deletes their credentials for this
   * organization, like EMP-007 termination: sessions bound here (or not yet
   * bound, which may resolve to this membership) and personal access tokens.
   */
  async revoke(
    tx: TenantTx,
    userId: string,
  ): Promise<{ accessExpiresAt: Date } & AuditorRevocationResult> {
    const orgId = tx.__tenantContext.organizationId;
    const rows = await tx<{ accessExpiresAt: Date }[]>`
      UPDATE memberships
      SET access_expires_at = now(), updated_at = now()
      WHERE user_id = ${userId} AND role = 'auditor'
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
