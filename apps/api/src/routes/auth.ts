import crypto from "node:crypto";
import { Hono, type Context } from "hono";
import type { Sql } from "postgres";
import {
  SignInRequestSchema,
  TwoFactorEnableRequestSchema,
  TwoFactorVerifyRequestSchema,
  TwoFactorDisableRequestSchema,
  createProblemDetails,
  type AuthUser,
} from "@librehr/contracts";
import {
  generateTotpSecret,
  generateTotpUri,
  generateRecoveryCodes,
  hashRecoveryCode,
  matchTotpStep,
} from "@librehr/core";
import {
  AuditRepository,
  UserRepository,
  withTenant,
  type UserRow,
} from "@librehr/db";
import type { AuthPort, AuthSession } from "../ports/auth.js";
import { createRateLimiter } from "../middleware/rate-limit.js";
import { requireAuth } from "../middleware/auth.js";
import {
  clearSessionCookie,
  readSessionCookie,
  setSessionCookie,
  type SessionCookieOptions,
} from "../lib/session-cookie.js";
import { ConflictError, UnauthorizedError } from "../errors/index.js";
import { parseJsonBody } from "../lib/validate.js";
import { FailureLockout } from "../lib/failure-lockout.js";
import {
  resolveTwoFactorConfig,
  type TwoFactorConfigInput,
} from "../lib/two-factor-config.js";

export interface AuthRouteOptions {
  /** Overrides of the 2FA defaults (pending setup TTL, recovery codes). */
  twoFactor?: TwoFactorConfigInput | undefined;
  /** Signing key for 2FA challenge tokens; comes from the validated env. */
  sessionSecret?: string | undefined;
  nodeEnv?: SessionCookieOptions["nodeEnv"];
  /** Trusted reverse-proxy hops (TRUST_PROXY) for rate-limit client IPs. */
  trustProxy?: number | undefined;
}

function challengeSecret(value: string | undefined): string | null {
  return value && value.length >= 32 ? value : null;
}

function createChallengeToken(userId: string, secret: string): string {
  const payload = JSON.stringify({
    userId,
    exp: Date.now() + 5 * 60 * 1000, // 5 minutes
  });
  const b64Payload = Buffer.from(payload).toString("base64url");
  const signature = crypto
    .createHmac("sha256", secret)
    .update(b64Payload)
    .digest("base64url");
  return `${b64Payload}.${signature}`;
}

function verifyChallengeToken(
  token: string,
  secret: string | null,
): string | null {
  try {
    if (!secret) return null;
    const parts = token.split(".");
    if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
    const [b64Payload, signature] = parts;

    const expectedSig = crypto
      .createHmac("sha256", secret)
      .update(b64Payload)
      .digest("base64url");

    if (
      !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))
    ) {
      return null;
    }

    const payload = JSON.parse(
      Buffer.from(b64Payload, "base64url").toString("utf-8"),
    ) as { userId: string; exp: number };

    if (Date.now() > payload.exp) {
      return null;
    }

    return payload.userId;
  } catch {
    return null;
  }
}

/** A JSON body field for rate-limit keys; never throws. */
async function bodyField(c: Context, field: string): Promise<string | null> {
  try {
    const body: unknown = await c.req.json();
    if (body && typeof body === "object" && field in body) {
      const value = (body as Record<string, unknown>)[field];
      return typeof value === "string" ? value : null;
    }
  } catch {
    // Malformed bodies are rejected by the route itself.
  }
  return null;
}

function currentUser(c: Context): AuthUser {
  return (c.get as (key: string) => unknown)("user") as AuthUser;
}

const invalidCode = () =>
  new UnauthorizedError({
    code: "INVALID_2FA_CODE",
    detail: "Invalid two-factor authentication code",
  });

export function createAuthRoutes(
  authPort: AuthPort,
  sql: Sql,
  options: AuthRouteOptions = {},
) {
  const router = new Hono();
  const signingSecret = challengeSecret(options.sessionSecret);
  const userRepo = new UserRepository();
  const auditRepo = new AuditRepository();
  const cookieOptions: SessionCookieOptions = {
    nodeEnv: options.nodeEnv,
    trustProxy: options.trustProxy,
  };
  const trustProxy = options.trustProxy ?? 0;
  const twoFactor = resolveTwoFactorConfig(options.twoFactor);
  const minute = 60 * 1000;

  // Brute-force limits (AUTH-001). Each endpoint has a per-IP bucket and a
  // tighter per IP+account bucket, so one account cannot be hammered from an
  // IP and one IP cannot spray many accounts beyond the IP budget.
  const perIp = () =>
    createRateLimiter({ windowMs: minute, max: 30, trustProxy });
  const signInLimit = createRateLimiter({
    windowMs: minute,
    max: 10,
    trustProxy,
    account: (c) => bodyField(c, "email"),
  });
  const verifyLimit = createRateLimiter({
    windowMs: minute,
    max: 10,
    trustProxy,
    account: async (c) => {
      const token = await bodyField(c, "challengeToken");
      return token ? verifyChallengeToken(token, signingSecret) : null;
    },
  });
  const sessionUserLimit = createRateLimiter({
    windowMs: minute,
    max: 10,
    trustProxy,
    account: (c) => currentUser(c).id,
  });

  const issueSession = (c: Context, session: AuthSession) => {
    setSessionCookie(c, session.token, session.expiresAt, cookieOptions);
    // The token travels only in the httpOnly cookie, never in the body.
    return c.json({
      user: session.user,
      expiresAt: session.expiresAt.toISOString(),
    });
  };

  const noActiveMembership = () =>
    new UnauthorizedError({
      code: "INVALID_CREDENTIALS",
      detail: "Invalid email or password",
    });

  // Per-account lockout of second-factor checks (AUTH-003): the IP buckets
  // above do not stop a guesser that rotates IPs against one account.
  const secondFactorLockout = new FailureLockout({
    failureWindowMs: twoFactor.lockout.failureWindowMs,
    lockoutMs: twoFactor.lockout.lockoutMs,
  });
  const lockoutKey = (userId: string) => `2fa:${userId}`;

  /**
   * Checks a TOTP or single-use recovery code for an account.
   *
   * - "locked": the account had too many recent failures; nothing is checked.
   * - A TOTP code is accepted only for a time step later than the last one
   *   accepted (no replay, also not by parallel requests).
   * - A recovery code is burned in the same conditional UPDATE that accepts
   *   it, so it works once even under concurrency.
   * A legacy plaintext TOTP secret is re-encrypted once a code verified
   * against it.
   */
  const verifySecondFactor = async (
    userRow: UserRow,
    rawCode: string,
  ): Promise<"ok" | "invalid" | "locked"> => {
    const key = lockoutKey(userRow.id);
    if (secondFactorLockout.lockedFor([key]) > 0) return "locked";

    const code = rawCode.trim();
    const secret = userRow.twoFactorSecret;
    const step = secret ? matchTotpStep(secret, code) : null;
    const valid =
      step !== null
        ? await userRepo.consumeTotpStep(sql, userRow.id, step)
        : await userRepo.burnRecoveryCode(
            sql,
            userRow.id,
            hashRecoveryCode(code),
          );

    if (!valid) {
      secondFactorLockout.recordFailure([
        { key, limit: twoFactor.lockout.maxFailures },
      ]);
      return "invalid";
    }
    secondFactorLockout.reset(key);
    if (secret && userRow.twoFactorSecretIsPlaintext) {
      await userRepo.reencryptTwoFactorSecret(sql, userRow.id, secret);
    }
    return "ok";
  };

  const secondFactorLocked = (c: Context, userId: string) =>
    c.json(
      createProblemDetails({
        status: 429,
        title: "Too Many Requests",
        detail:
          "Too many failed two-factor attempts. Please wait before retrying.",
        code: "TWO_FACTOR_LOCKED",
      }),
      429,
      {
        "Content-Type": "application/problem+json",
        "Retry-After": Math.ceil(
          secondFactorLockout.lockedFor([lockoutKey(userId)]) / 1000,
        ).toString(),
      },
    );

  router.post("/sign-in", perIp(), signInLimit, async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = SignInRequestSchema.safeParse(body);

    if (!parsed.success) {
      const problem = createProblemDetails({
        status: 400,
        title: "Validation Error",
        detail: "Invalid sign-in request body",
        code: "VALIDATION_ERROR",
        errors: parsed.error.errors.map((e) => ({
          field: e.path.join("."),
          message: e.message,
        })),
      });
      return c.json(problem, 400, {
        "Content-Type": "application/problem+json",
      });
    }

    const user = await authPort.verifyCredentials(
      parsed.data.email,
      parsed.data.password,
    );

    if (!user) {
      const problem = createProblemDetails({
        status: 401,
        title: "Unauthorized",
        detail: "Invalid email or password",
        code: "INVALID_CREDENTIALS",
      });
      return c.json(problem, 401, {
        "Content-Type": "application/problem+json",
      });
    }

    // Check if user has 2FA enabled
    const userRow = await userRepo.findById(sql, user.id);
    if (userRow?.twoFactorEnabled) {
      if (parsed.data.twoFactorCode) {
        const result = await verifySecondFactor(
          userRow,
          parsed.data.twoFactorCode,
        );
        if (result === "locked") return secondFactorLocked(c, userRow.id);
        if (result === "invalid") throw invalidCode();
      } else {
        // Return 2FA challenge response
        const secret = signingSecret;
        if (!secret) {
          return c.json(
            createProblemDetails({
              status: 503,
              title: "Service unavailable",
              detail: "Two-factor authentication is unavailable",
              code: "TWO_FACTOR_UNAVAILABLE",
            }),
            503,
            { "Content-Type": "application/problem+json" },
          );
        }
        const challengeToken = createChallengeToken(user.id, secret);
        return c.json({
          requiresTwoFactor: true,
          challengeToken,
        });
      }
    }

    const session = await authPort.createSession(user);
    if (!session) throw noActiveMembership();
    return issueSession(c, session);
  });

  // Verify 2FA challenge token and issue session
  router.post("/2fa/verify", perIp(), verifyLimit, async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = TwoFactorVerifyRequestSchema.safeParse(body);

    if (!parsed.success) {
      return c.json(
        createProblemDetails({
          status: 400,
          title: "Validation Error",
          detail: "Invalid verification request",
          code: "VALIDATION_ERROR",
        }),
        400,
        { "Content-Type": "application/problem+json" },
      );
    }

    const userId = verifyChallengeToken(
      parsed.data.challengeToken,
      signingSecret,
    );
    if (!userId) {
      return c.json(
        createProblemDetails({
          status: 401,
          title: "Unauthorized",
          detail: "Two-factor challenge token has expired or is invalid",
          code: "EXPIRED_CHALLENGE",
        }),
        401,
        { "Content-Type": "application/problem+json" },
      );
    }

    const userRow = await userRepo.findById(sql, userId);
    if (!userRow || !userRow.twoFactorEnabled) {
      return c.json(
        createProblemDetails({
          status: 401,
          title: "Unauthorized",
          detail: "User not found or 2FA not enabled",
          code: "INVALID_USER",
        }),
        401,
        { "Content-Type": "application/problem+json" },
      );
    }

    const result = await verifySecondFactor(userRow, parsed.data.code);
    if (result === "locked") return secondFactorLocked(c, userRow.id);
    if (result === "invalid") throw invalidCode();

    // Same deterministic default membership as password sign-in, bound
    // through the new session's token.
    const session = await authPort.createSession({
      id: userRow.id,
      email: userRow.email,
      name: userRow.name,
      twoFactorEnabled: true,
    });
    if (!session) {
      return c.json(
        createProblemDetails({
          status: 401,
          title: "Unauthorized",
          detail: "User not found or 2FA not enabled",
          code: "INVALID_USER",
        }),
        401,
        { "Content-Type": "application/problem+json" },
      );
    }
    return issueSession(c, session);
  });

  const alreadyEnabled = () =>
    new ConflictError({
      code: "TWO_FACTOR_ALREADY_ENABLED",
      detail: "Two-factor authentication is already enabled",
    });

  // Setup 2FA: the server generates the secret and recovery codes and keeps
  // them as a pending setup (secret envelope-encrypted, codes hashed) for a
  // short time. They are shown once here and confirmed by /2fa/enable.
  router.post("/2fa/setup", requireAuth, sessionUserLimit, async (c) => {
    const user = currentUser(c);
    const secret = generateTotpSecret();
    const { plainCodes, hashedCodes } = generateRecoveryCodes(
      twoFactor.recoveryCodeCount,
    );
    const started = await userRepo.startTwoFactorSetup(
      sql,
      user.id,
      secret,
      hashedCodes,
      twoFactor.pendingSetupTtlMs,
    );
    // Never replace an active secret: the user must disable 2FA first.
    if (!started) throw alreadyEnabled();

    return c.json({
      secret,
      qrUri: generateTotpUri({
        secret,
        accountName: user.email,
        issuer: "LibreHR",
      }),
      recoveryCodes: plainCodes,
    });
  });

  // Enable 2FA: only a code that verifies against the pending server-side
  // secret promotes it. The client never supplies the secret or the codes.
  router.post("/2fa/enable", requireAuth, sessionUserLimit, async (c) => {
    const user = currentUser(c);
    const { code } = await parseJsonBody(c, TwoFactorEnableRequestSchema);

    const pending = await userRepo.findPendingTwoFactor(sql, user.id);
    if (!pending) {
      if ((await userRepo.findById(sql, user.id))?.twoFactorEnabled) {
        throw alreadyEnabled();
      }
      throw new ConflictError({
        code: "TWO_FACTOR_SETUP_EXPIRED",
        detail:
          "No two-factor setup is pending or it has expired; start the setup again",
      });
    }

    const step = matchTotpStep(pending.secret, code);
    if (step === null) {
      return c.json(
        createProblemDetails({
          status: 400,
          title: "Invalid Code",
          detail:
            "The 6-digit TOTP code entered did not match the authenticator key",
          code: "INVALID_TOTP_CODE",
        }),
        400,
        { "Content-Type": "application/problem+json" },
      );
    }

    // Enabling a second factor ends every other session of the account (a
    // session opened by someone else with the password alone must not
    // survive it); the current one is kept.
    const currentToken = (
      (c.get as (key: string) => unknown)("session") as AuthSession | undefined
    )?.token;
    await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        // Promotes exactly the setup that was verified, only if it is still
        // pending: a concurrent setup or enable makes this a conflict.
        // The confirming code's step counts as used, so it cannot also
        // satisfy the next sign-in or the disable endpoint.
        if (
          !(await userRepo.promotePendingTwoFactor(
            tx,
            user.id,
            pending.setupId,
            step,
          ))
        ) {
          throw alreadyEnabled();
        }
        const revokedSessions = await userRepo.revokeOtherSessions(
          tx,
          user.id,
          currentToken,
        );
        await auditRepo.log(tx, {
          actorId: user.id,
          action: "auth.2fa.enable",
          resourceType: "user",
          resourceId: user.id,
          metadata: { revokedSessions },
        });
      },
    );

    return c.json({ success: true });
  });

  // Disable 2FA: requires a current TOTP code or an unused recovery code, so a
  // stolen session alone cannot remove the second factor.
  router.post("/2fa/disable", requireAuth, sessionUserLimit, async (c) => {
    const user = currentUser(c);
    const body = await c.req.json().catch(() => null);
    const parsed = TwoFactorDisableRequestSchema.safeParse(body);
    if (!parsed.success) throw invalidCode();

    const userRow = await userRepo.findById(sql, user.id);
    if (!userRow?.twoFactorEnabled) {
      throw new ConflictError({
        code: "TWO_FACTOR_NOT_ENABLED",
        detail: "Two-factor authentication is not enabled",
      });
    }

    const result = await verifySecondFactor(userRow, parsed.data.code);
    if (result === "locked") return secondFactorLocked(c, userRow.id);
    if (result === "invalid") throw invalidCode();

    await userRepo.disableTwoFactor(sql, user.id);
    await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      (tx) =>
        auditRepo.log(tx, {
          actorId: user.id,
          action: "auth.2fa.disable",
          resourceType: "user",
          resourceId: user.id,
        }),
    );

    return c.json({ success: true });
  });

  // Revokes the current session (cookie, or a Bearer session token from a
  // non-browser client) and clears the cookie. Personal access tokens are
  // revoked through /v1/tokens, not here.
  router.post("/sign-out", async (c) => {
    const authHeader = c.req.header("authorization");
    const bearer = authHeader?.startsWith("Bearer ")
      ? authHeader.substring(7)
      : undefined;
    const tokens = [readSessionCookie(c), bearer].filter(
      (t): t is string => typeof t === "string" && !t.startsWith("lhr_"),
    );
    for (const token of new Set(tokens)) {
      await authPort.revokeSession(token);
    }

    clearSessionCookie(c, cookieOptions);
    return c.json({ success: true });
  });

  return router;
}
