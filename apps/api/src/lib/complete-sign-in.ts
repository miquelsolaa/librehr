import type { Context } from "hono";
import type { AuthUser } from "@librehr/contracts";
import type { AuthPort } from "../ports/auth.js";
import {
  setSessionCookie,
  type SessionCookieOptions,
} from "./session-cookie.js";
import { createChallengeToken } from "./two-factor-challenge.js";

/** A user whose identity a Business extension verified (SSO, AUTH-004). */
export interface SignInSubject {
  userId: string;
  /** The session is opened in this organization only. */
  organizationId: string;
}

/**
 * - `signed_in`: the session cookie is set on the response.
 * - `two_factor_required`: the user has local 2FA (AUTH-003); the client
 *   finishes with POST /v1/auth/2fa/verify, which keeps the organization.
 * - `no_membership`: no active membership there (also a terminated
 *   employee, EMP-007); no session was opened.
 * - `two_factor_unavailable`: 2FA is needed but SESSION_SECRET is unset.
 */
export type SignInResult =
  | { outcome: "signed_in"; user: AuthUser; expiresAt: Date }
  | { outcome: "two_factor_required"; challengeToken: string }
  | { outcome: "no_membership" }
  | { outcome: "two_factor_unavailable" };

export type CompleteSignIn = (
  c: Context,
  subject: SignInSubject,
) => Promise<SignInResult>;

export interface SignInUser {
  id: string;
  email: string;
  name: string;
  twoFactorEnabled: boolean;
}

export interface CompleteSignInOptions {
  authPort: AuthPort;
  /** Reads the user row (UserRepository.findById in the app). */
  findUser: (userId: string) => Promise<SignInUser | null>;
  /** From `challengeSecret(SESSION_SECRET)`; null refuses 2FA challenges. */
  challengeSecret: string | null;
  cookie: SessionCookieOptions;
}

/**
 * The last step of a sign-in whose first factor an extension checked. It
 * applies the same rules as password sign-in: a user with local 2FA must
 * still pass the TOTP step (SSO never weakens AUTH-003), and the session is
 * bound through createSession, which refuses a user without an active
 * membership in the organization.
 */
export function createCompleteSignIn(
  options: CompleteSignInOptions,
): CompleteSignIn {
  return async (c, subject) => {
    const user = await options.findUser(subject.userId);
    if (!user) return { outcome: "no_membership" };

    if (user.twoFactorEnabled) {
      if (!options.challengeSecret)
        return { outcome: "two_factor_unavailable" };
      return {
        outcome: "two_factor_required",
        challengeToken: createChallengeToken(
          { userId: user.id, organizationId: subject.organizationId },
          options.challengeSecret,
        ),
      };
    }

    const session = await options.authPort.createSession({
      id: user.id,
      email: user.email,
      name: user.name,
      organizationId: subject.organizationId,
      twoFactorEnabled: false,
    });
    if (!session) return { outcome: "no_membership" };
    setSessionCookie(c, session.token, session.expiresAt, options.cookie);
    return {
      outcome: "signed_in",
      user: session.user,
      expiresAt: session.expiresAt,
    };
  };
}
