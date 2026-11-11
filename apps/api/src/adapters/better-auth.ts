import crypto from "node:crypto";
import type { Sql } from "postgres";
import { IdentityRepository, hashBearerToken } from "@librehr/db";
import type { AuthPort, AuthSession, SessionSubject } from "../ports/auth.js";
import { verifyPassword } from "../lib/password.js";

/** Sessions last 7 days; the cookie Max-Age is derived from expiresAt. */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Session auth on the runtime role (librehr_app, bound by RLS). users and
 * sessions are global tables; memberships are resolved through the identity
 * lookup functions (migrations 0019/0020), always keyed by a secret the
 * caller holds (a session token), never by a bare user id.
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
  ): Promise<SessionSubject | null> {
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

    // No organization yet: createSession binds the session to the user's
    // default membership through the session token.
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      twoFactorEnabled: user.two_factor_enabled,
    };
  }

  async createSession(user: SessionSubject): Promise<AuthSession | null> {
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

    await this.sql`
      INSERT INTO sessions (user_id, token, expires_at, organization_id)
      VALUES (${user.id}, ${hashBearerToken(token)}, ${expiresAt}, ${user.organizationId ?? null})
    `;

    // Picks the pinned org (or the default membership), refusing memberships
    // of terminated employees (EMP-007).
    const membership = await this.identity.bindSessionOrganization(
      this.sql,
      token,
    );
    if (!membership) {
      await this.revokeSession(token);
      return null;
    }

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: membership.role,
        organizationId: membership.organizationId,
        ...(user.twoFactorEnabled !== undefined
          ? { twoFactorEnabled: user.twoFactorEnabled }
          : {}),
      },
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
    await this
      .sql`DELETE FROM sessions WHERE token = ${hashBearerToken(token)}`;
  }
}
