import crypto from "node:crypto";
import type { Sql } from "postgres";
import type { AuthPort, AuthSession } from "../ports/auth.js";
import type { AuthUser } from "@librehr/contracts";

export class BetterAuthAdapter implements AuthPort {
  private sql: Sql;

  constructor(sql: Sql) {
    this.sql = sql;
  }

  async verifyCredentials(
    email: string,
    _password: string,
  ): Promise<AuthUser | null> {
    // In dev / M0, verify user exists and load active membership
    const users = await this.sql<
      {
        id: string;
        email: string;
        name: string;
        role: string;
        organization_id: string;
      }[]
    >`
      SELECT u.id, u.email, u.name, m.role, m.organization_id
      FROM users u
      JOIN memberships m ON m.user_id = u.id
      WHERE u.email = ${email}
      LIMIT 1
    `;

    const user = users[0];
    if (!user) return null;

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      organizationId: user.organization_id,
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
        expires_at: Date;
      }[]
    >`
      SELECT u.id, u.email, u.name, m.role, m.organization_id, s.expires_at
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
      },
      token,
      expiresAt: new Date(row.expires_at),
    };
  }

  async revokeSession(token: string): Promise<void> {
    await this.sql`DELETE FROM sessions WHERE token = ${token}`;
  }
}
