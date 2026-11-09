import type { TenantTx } from "../with-tenant.js";

export interface AccessRevocationResult {
  /** False when the termination is not yet effective or no user is linked. */
  revoked: boolean;
  sessions: number;
  tokens: number;
}

/**
 * EMP-007: revoke a terminated employee's access in the current organization.
 *
 * Sign-in, session and token lookups already refuse a terminated membership
 * once its date has arrived (migration 0020); this deletes the credentials
 * themselves when the termination is effective now. "Now" is the
 * organization's local date, computed in SQL so no business-date arithmetic
 * happens in application code.
 */
export class AccessRevocationRepository {
  async revokeIfTerminated(
    tx: TenantTx,
    employeeId: string,
  ): Promise<AccessRevocationResult> {
    const targets = await tx<{ userId: string; organizationId: string }[]>`
      SELECT e.user_id AS "userId", e.organization_id AS "organizationId"
      FROM employees e
      JOIN organizations o ON o.id = e.organization_id
      WHERE e.id = ${employeeId}
        AND e.user_id IS NOT NULL
        AND e.status = 'terminated'
        AND (
          e.termination_date IS NULL
          OR e.termination_date <= (now() AT TIME ZONE o.timezone)::date
        )
      LIMIT 1
    `;
    const target = targets[0];
    if (!target) return { revoked: false, sessions: 0, tokens: 0 };

    // Sessions without an organization resolve the default membership, which
    // may be this one, so they go too.
    const sessions = await tx`
      DELETE FROM sessions
      WHERE user_id = ${target.userId}
        AND (organization_id = ${target.organizationId} OR organization_id IS NULL)
    `;
    const tokens = await tx`
      DELETE FROM personal_access_tokens
      WHERE user_id = ${target.userId}
        AND organization_id = ${target.organizationId}
    `;
    return { revoked: true, sessions: sessions.count, tokens: tokens.count };
  }
}
