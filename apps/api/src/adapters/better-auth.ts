import crypto from "node:crypto";
import type { Sql } from "postgres";
import { IdentityRepository } from "@librehr/db";
import type { AuthPort, AuthSession } from "../ports/auth.js";
import type { AuthUser } from "@librehr/contracts";
import { verifyPassword } from "../lib/password.js";

/**
 * Session auth on the runtime role (librehr_app, bound by RLS). users and
 * sessions are global tables; memberships are resolved through the identity
 * lookup functions (migration 0019).
 */
export class BetterAuthAdapter implements AuthPort {
  private sql: Sql;
  private identity = new IdentityRepository();

  constructor(sql: Sql) {
    this.sql = sql;
  }

  async verifyCredentials(
    email: string,
    password: string,
  ): Promise<AuthUser | null> {
    const users = await this.sql<
      {
        id: string;
        email: string;
        name: string;
        two_factor_enabled: boolean;
        password_hash: string | null;
      }[]
    >`
      SELECT id, email, name, password_hash, COALESCE(two_factor_enabled, false) as two_factor_enabled
      FROM users
      WHERE email = ${email}
      LIMIT 1
    `;

    const user = users[0];
    if (!user || !(await verifyPassword(password, user.password_hash)))
      return null;

    // Sign-in carries no organization yet, so the session opens in the
    // user's default membership (oldest first, deterministic).
    const membership = await this.identity.membership(this.sql, user.id);
    if (!membership) return null;

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: membership.role,
      organizationId: membership.organizationId,
      twoFactorEnabled: user.two_factor_enabled,
    };
  }

  async createSession(user: AuthUser): Promise<AuthSession> {
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await this.sql`
      INSERT INTO sessions (user_id, token, expires_at, organization_id)
      VALUES (${user.id}, ${token}, ${expiresAt}, ${user.organizationId || null})
    `;

    return {
      user,
      token,
      expiresAt,
    };
  }

  async getSession(token: string): Promise<AuthSession | null> {
    const row = await this.identity.session(this.sql, token);
    if (!row) return null;

    return {
      user: {
        id: row.userId,
        email: row.email,
        name: row.name,
        role: row.role,
        organizationId: row.organizationId,
        twoFactorEnabled: row.twoFactorEnabled,
      },
      token,
      expiresAt: new Date(row.expiresAt),
    };
  }

  async revokeSession(token: string): Promise<void> {
    await this.sql`DELETE FROM sessions WHERE token = ${token}`;
  }
}
