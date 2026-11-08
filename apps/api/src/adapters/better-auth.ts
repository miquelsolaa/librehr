import crypto from "node:crypto";
import type { Sql } from "postgres";
import type { AuthPort, AuthSession } from "../ports/auth.js";
import type { AuthUser } from "@librehr/contracts";
import { verifyPassword } from "../lib/password.js";

export class BetterAuthAdapter implements AuthPort {
  private sql: Sql;

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
        role: string;
        organization_id: string;
        two_factor_enabled: boolean;
        password_hash: string | null;
      }[]
    >`
      SELECT u.id, u.email, u.name, m.role, m.organization_id, u.password_hash, COALESCE(u.two_factor_enabled, false) as two_factor_enabled
      FROM users u
      JOIN memberships m ON m.user_id = u.id
      WHERE u.email = ${email}
      LIMIT 1
    `;

    const user = users[0];
    if (!user || !(await verifyPassword(password, user.password_hash)))
      return null;

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      organizationId: user.organization_id,
      twoFactorEnabled: user.two_factor_enabled,
    };
  }

  async createSession(user: AuthUser): Promise<AuthSession> {
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await this.sql`
      INSERT INTO sessions (user_id, token, expires_at)
      VALUES (${user.id}, ${token}, ${expiresAt})
    `;

    return {
      user,
      token,
      expiresAt,
    };
  }

  async getSession(token: string): Promise<AuthSession | null> {
    const rows = await this.sql<
      {
        id: string;
        email: string;
        name: string;
        role: string;
        organization_id: string;
        two_factor_enabled: boolean;
        expires_at: Date;
      }[]
    >`
      SELECT u.id, u.email, u.name, m.role, m.organization_id, COALESCE(u.two_factor_enabled, false) as two_factor_enabled, s.expires_at
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      JOIN memberships m ON m.user_id = u.id
      WHERE s.token = ${token} AND s.expires_at > now()
      LIMIT 1
    `;

    const row = rows[0];
    if (!row) return null;

    return {
      user: {
        id: row.id,
        email: row.email,
        name: row.name,
        role: row.role,
        organizationId: row.organization_id,
        twoFactorEnabled: row.two_factor_enabled,
      },
      token,
      expiresAt: new Date(row.expires_at),
    };
  }

  async revokeSession(token: string): Promise<void> {
    await this.sql`DELETE FROM sessions WHERE token = ${token}`;
  }
}
