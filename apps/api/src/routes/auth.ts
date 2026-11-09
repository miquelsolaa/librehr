import crypto from "node:crypto";
import { Hono } from "hono";
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
  verifyTotpCode,
  verifyRecoveryCode,
} from "@librehr/core";
import { IdentityRepository, UserRepository } from "@librehr/db";
import type { AuthPort } from "../ports/auth.js";
import { createRateLimiter } from "../middleware/rate-limit.js";
import { requireAuth } from "../middleware/auth.js";

export interface AuthRouteOptions {
  /** Signing key for 2FA challenge tokens; comes from the validated env. */
  sessionSecret?: string | undefined;
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

export function createAuthRoutes(
  authPort: AuthPort,
  sql: Sql,
  options: AuthRouteOptions = {},
) {
  const router = new Hono();
  const signingSecret = challengeSecret(options.sessionSecret);
  const userRepo = new UserRepository();
  const identityRepo = new IdentityRepository();

  // Rate limit: 10 attempts per minute on sign-in
  const authRateLimiter = createRateLimiter({
    windowMs: 60 * 1000,
    max: 10,
  });

  router.post("/sign-in", authRateLimiter, async (c) => {
    const body = await c.req.json();
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
      // If code was supplied, verify it directly
      if (parsed.data.twoFactorCode) {
        const code = parsed.data.twoFactorCode.trim();
        const totpValid = userRow.twoFactorSecret
          ? verifyTotpCode(userRow.twoFactorSecret, code)
          : false;

        let recoveryValid = false;
        if (!totpValid && userRow.twoFactorRecoveryCodes) {
          const matchedIdx = verifyRecoveryCode(
            code,
            userRow.twoFactorRecoveryCodes,
          );
          if (matchedIdx !== -1) {
            recoveryValid = true;
            // Burn single-use recovery code
            const remaining = [...userRow.twoFactorRecoveryCodes];
            remaining.splice(matchedIdx, 1);
            await userRepo.updateRecoveryCodes(sql, user.id, remaining);
          }
        }

        if (!totpValid && !recoveryValid) {
          return c.json(
            createProblemDetails({
              status: 401,
              title: "Unauthorized",
              detail: "Invalid two-factor authentication code",
              code: "INVALID_2FA_CODE",
            }),
            401,
            { "Content-Type": "application/problem+json" },
          );
        }
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

    // Set secure HttpOnly session cookie
    c.header(
      "Set-Cookie",
      `librehr_session=${session.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`,
    );

    return c.json({
      user: session.user,
      expiresAt: session.expiresAt.toISOString(),
      token: session.token,
    });
  });

  // Verify 2FA challenge token and issue session
  router.post("/2fa/verify", authRateLimiter, async (c) => {
    const body = await c.req.json();
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

    const code = parsed.data.code.trim();
    const totpValid = userRow.twoFactorSecret
      ? verifyTotpCode(userRow.twoFactorSecret, code)
      : false;

    let recoveryValid = false;
    if (!totpValid && userRow.twoFactorRecoveryCodes) {
      const matchedIdx = verifyRecoveryCode(
        code,
        userRow.twoFactorRecoveryCodes,
      );
      if (matchedIdx !== -1) {
        recoveryValid = true;
        const remaining = [...userRow.twoFactorRecoveryCodes];
        remaining.splice(matchedIdx, 1);
        await userRepo.updateRecoveryCodes(sql, userId, remaining);
      }
    }

    if (!totpValid && !recoveryValid) {
      return c.json(
        createProblemDetails({
          status: 401,
          title: "Unauthorized",
          detail: "Invalid two-factor authentication code",
          code: "INVALID_2FA_CODE",
        }),
        401,
        { "Content-Type": "application/problem+json" },
      );
    }

    // Same deterministic default membership as password sign-in.
    const membership = await identityRepo.membership(sql, userId);
    if (!membership) {
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

    const authUser: AuthUser = {
      id: userRow.id,
      email: userRow.email,
      name: userRow.name,
      role: membership.role,
      organizationId: membership.organizationId,
      twoFactorEnabled: true,
    };

    const session = await authPort.createSession(authUser);

    c.header(
      "Set-Cookie",
      `librehr_session=${session.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`,
    );

    return c.json({
      user: session.user,
      expiresAt: session.expiresAt.toISOString(),
      token: session.token,
    });
  });

  // Setup 2FA - generates new secret and backup recovery codes
  router.post("/2fa/setup", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;
    const secret = generateTotpSecret();
    const qrUri = generateTotpUri({
      secret,
      accountName: user.email,
      issuer: "LibreHR",
    });
    const { plainCodes } = generateRecoveryCodes(8);

    return c.json({
      secret,
      qrUri,
      recoveryCodes: plainCodes,
    });
  });

  // Enable 2FA - validates code with secret and persists
  router.post("/2fa/enable", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;
    const body = await c.req.json();
    const parsed = TwoFactorEnableRequestSchema.safeParse(body);

    if (!parsed.success) {
      return c.json(
        createProblemDetails({
          status: 400,
          title: "Validation Error",
          detail: "Invalid enable 2FA request",
          code: "VALIDATION_ERROR",
        }),
        400,
        { "Content-Type": "application/problem+json" },
      );
    }

    const isValid = verifyTotpCode(parsed.data.secret, parsed.data.code);
    if (!isValid) {
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

    const hashedCodes = parsed.data.recoveryCodes.map((code) =>
      crypto
        .createHash("sha256")
        .update(code.trim().toLowerCase())
        .digest("hex"),
    );

    await userRepo.enableTwoFactor(
      sql,
      user.id,
      parsed.data.secret,
      hashedCodes,
    );

    return c.json({ success: true });
  });

  // Disable 2FA
  router.post("/2fa/disable", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;
    const body = await c.req.json().catch(() => ({}));
    TwoFactorDisableRequestSchema.safeParse(body);

    await userRepo.disableTwoFactor(sql, user.id);

    return c.json({ success: true });
  });

  router.post("/sign-out", async (c) => {
    const authHeader = c.req.header("authorization");
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.substring(7);
      await authPort.revokeSession(token);
    }

    c.header(
      "Set-Cookie",
      "librehr_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
    );

    return c.json({ success: true });
  });

  return router;
}
