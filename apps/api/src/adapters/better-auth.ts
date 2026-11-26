import crypto from "node:crypto";
import type { Sql } from "postgres";
import { IdentityRepository, hashBearerToken } from "@librehr/db";
import type {
  AuthPort,
  AuthSession,
  CreateSessionOptions,
  SessionSubject,
} from "../ports/auth.js";
import { verifyPassword } from "../lib/password.js";
import { SsoRequiredError } from "../errors/index.js";
import { logger } from "../middleware/logger.js";

/** Sessions last 7 days; the cookie Max-Age is derived from expiresAt. */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Session auth on the runtime role (librehr_app, bound by RLS). users and
 * sessions are global tables; memberships are resolved through the identity
 * lookup functions (migrations 0019/0020), always keyed by a secret the
 * caller holds (a session token), never by a bare user id.
 */
export interface BetterAuthAdapterOptions {
  /**
   * AUTH-004 "Require SSO" is active on this instance: the licence grants
   * `sso` and SSO_ENABLED is true (see lib/sso-enforcement.ts). When false,
   * organizations' enforce_sso settings are stored but have no effect.
   */
  ssoEnforcement?: boolean | undefined;
}

export class BetterAuthAdapter implements AuthPort {
  private sql: Sql;
  private identity = new IdentityRepository();
  private ssoEnforcement: boolean;

  constructor(sql: Sql, options: BetterAuthAdapterOptions = {}) {
    this.sql = sql;
    this.ssoEnforcement = options.ssoEnforcement ?? false;
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

  async createSession(
    user: SessionSubject,
    options: CreateSessionOptions = {},
  ): Promise<AuthSession | null> {
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    const authMethod = options.authMethod ?? "password";

    await this.sql`
      INSERT INTO sessions (user_id, token, expires_at, organization_id, auth_method)
      VALUES (${user.id}, ${hashBearerToken(token)}, ${expiresAt}, ${user.organizationId ?? null}, ${authMethod})
    `;

    // Picks the pinned org (or the default membership), refusing memberships
    // of terminated employees (EMP-007) and, for password sessions while
    // enforcement is active, of organizations that require SSO (AUTH-004).
    const membership = await this.identity.bindSessionOrganization(
      this.sql,
      token,
      { enforceSso: this.ssoEnforcement },
    );
    if (!membership || membership.ssoRequired) {
      await this.revokeSession(token);
      if (membership?.ssoRequired) {
        // No user id, email or organization (AGENTS.md section 4).
        logger.warn(
          { code: "SSO_REQUIRED" },
          "password session refused: organization requires single sign-on",
        );
        throw new SsoRequiredError();
      }
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
      authMethod,
      breakGlass: membership.breakGlass,
    };
  }

  async getSession(token: string): Promise<AuthSession | null> {
    const row = await this.identity.session(this.sql, token);
    if (!row) return null;
    // AUTH-004: checked at lookup time, so switching "Require SSO" on ends
    // password sessions at once and lifting it (or a licence lapse) restores
    // them. Nothing is deleted.
    if (
      this.ssoEnforcement &&
      row.authMethod === "password" &&
      !row.passwordAllowed
    ) {
      return null;
    }

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
      authMethod: row.authMethod,
    };
  }

  async revokeSession(token: string): Promise<void> {
    await this
      .sql`DELETE FROM sessions WHERE token = ${hashBearerToken(token)}`;
  }
}
