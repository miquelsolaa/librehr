import type { AuthUser } from "@librehr/contracts";

export interface AuthSession {
  user: AuthUser;
  token: string;
  expiresAt: Date;
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
   * there (none at all, or a terminated employee: EMP-007).
   */
  createSession(user: SessionSubject): Promise<AuthSession | null>;
  getSession(token: string): Promise<AuthSession | null>;
  revokeSession(token: string): Promise<void>;
}
