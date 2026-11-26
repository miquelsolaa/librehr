import type { AuthUser } from "@librehr/contracts";

/** How a session was authenticated (AUTH-004). */
export type AuthMethod = "password" | "sso";

export interface AuthSession {
  user: AuthUser;
  token: string;
  expiresAt: Date;
  /** Absent means "password" (adapters that predate AUTH-004 enforcement). */
  authMethod?: AuthMethod | undefined;
  /**
   * True when a password session opened in an organization that requires
   * SSO because the user is a break-glass admin there (AUTH-004); the
   * sign-in route audits it.
   */
  breakGlass?: boolean | undefined;
}

export interface CreateSessionOptions {
  /** Defaults to "password". The OIDC callback (#34) passes "sso". */
  authMethod?: AuthMethod | undefined;
}

/**
 * Who a session is being opened for. The organization and role are optional:
 * after password or 2FA verification the caller knows only the user, and the
 * adapter binds the session to the user's default active membership.
 */
export type SessionSubject = Pick<AuthUser, "id" | "email" | "name"> &
  Partial<Pick<AuthUser, "organizationId" | "role" | "twoFactorEnabled">>;

export interface AuthPort {
  verifyCredentials(
    email: string,
    password: string,
  ): Promise<SessionSubject | null>;
  /**
   * Opens a session in `user.organizationId` or, when absent, the user's
   * default membership. Returns null when the user has no active membership
   * there (none at all, or a terminated employee: EMP-007). Throws
   * SsoRequiredError when a password session is refused only because every
   * candidate organization requires single sign-on (AUTH-004).
   */
  createSession(
    user: SessionSubject,
    options?: CreateSessionOptions,
  ): Promise<AuthSession | null>;
  getSession(token: string): Promise<AuthSession | null>;
  revokeSession(token: string): Promise<void>;
}
