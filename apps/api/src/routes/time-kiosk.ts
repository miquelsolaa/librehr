import { Hono, type MiddlewareHandler } from "hono";
import type { Sql } from "postgres";
import {
  type AuthUser,
  createProblemDetails,
  KioskClockRequestSchema,
} from "@librehr/contracts";
import { hashKioskPin, verifyKioskPin } from "@librehr/core";
import {
  withTenant,
  TimeRepository,
  EmployeeRepository,
  AuditRepository,
} from "@librehr/db";
import { requireAuth } from "../middleware/auth.js";
import { createRateLimiter } from "../middleware/rate-limit.js";
import { permissionScope } from "../policies/can.js";
import { ForbiddenError } from "../errors/index.js";
import { parseJsonBody } from "../lib/validate.js";
import { FailureLockout } from "../lib/failure-lockout.js";
import { clientIp, rateLimitAddress } from "../lib/client-ip.js";
import type { RateLimitStore } from "../lib/rate-limit-store.js";
import type { TimeChainSigner } from "@librehr/db";
import type { TimeTrackingConfig } from "../lib/time-tracking-config.js";

function genericInvalid() {
  return createProblemDetails({
    status: 401,
    title: "Unauthorized",
    detail: "Invalid identifier or PIN",
    code: "INVALID_CREDENTIALS",
  });
}

/**
 * TIM-010: shared-device kiosk clocking by identifier + PIN.
 *
 * The device session must hold `time.kiosk`. Attempts are rate limited per IP
 * and failed PINs lock out both the identifier and the IP. Responses do not
 * reveal whether an identifier exists, and the employee's display name is
 * only returned after a successful PIN check.
 */
export function createTimeKioskRoutes(
  sql: Sql,
  options: {
    sign: TimeChainSigner;
    config: TimeTrackingConfig;
    /** Shared store of the rate limit and the PIN lockout (issue #35). */
    rateLimitStore: RateLimitStore;
    /** TRUST_PROXY: reverse-proxy hops whose X-Forwarded-For entries are trusted. */
    trustProxy?: number | undefined;
  },
) {
  const trustProxy = options.trustProxy ?? 0;
  const router = new Hono();
  const timeRepo = new TimeRepository();
  const employeeRepo = new EmployeeRepository();
  const auditRepo = new AuditRepository();
  const { kiosk } = options.config;
  const lockout = new FailureLockout({
    name: "kiosk.pin",
    store: options.rateLimitStore,
    failureWindowMs: kiosk.failureWindowMs,
    lockoutMs: kiosk.lockoutMs,
  });
  const ipRateLimit = createRateLimiter({
    ...kiosk.ipRateLimit,
    name: "kiosk.clock.ip",
    store: options.rateLimitStore,
    trustProxy,
  });

  const requireKioskPermission: MiddlewareHandler = async (c, next) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;
    const scope = permissionScope(
      {
        userId: user.id,
        organizationId: user.organizationId,
        role: user.role,
      },
      "time.kiosk",
    );
    if (scope !== "organization") {
      throw new ForbiddenError({
        detail: "This session is not allowed to operate a kiosk",
      });
    }
    await next();
  };

  // Unknown identifiers are checked against a throwaway hash so that the
  // response time does not reveal whether the identifier exists.
  let decoyHash: Promise<string> | null = null;
  const decoy = () => (decoyHash ??= hashKioskPin("decoy-pin"));

  router.post(
    "/time/kiosk/clock",
    requireAuth,
    requireKioskPermission,
    ipRateLimit,
    async (c) => {
      const user = (c.get as (key: string) => unknown)("user") as AuthUser;
      const { identifier, pin, eventType } = await parseJsonBody(
        c,
        KioskClockRequestSchema,
      );

      const identifierKey = `id:${user.organizationId}:${identifier.trim().toLowerCase()}`;
      const ipKey = `ip:${user.organizationId}:${rateLimitAddress(clientIp(c, trustProxy))}`;

      const locked = (lockedMs: number) =>
        c.json(
          createProblemDetails({
            status: 429,
            title: "Too Many Requests",
            detail: "Too many failed attempts. Please wait before retrying.",
            code: "KIOSK_LOCKED",
          }),
          429,
          {
            "Content-Type": "application/problem+json",
            "Retry-After": Math.max(1, Math.ceil(lockedMs / 1000)).toString(),
          },
        );

      // The per-IP lockout counts failures after the check (it stops one
      // device spraying many identifiers); checking it first keeps a locked
      // IP from using up identifiers' attempts. Check-then-record: a
      // concurrent burst can exceed it (bounded by the per-IP rate limit and
      // the per-identifier reservation); see issue #178.
      const ipLockedMs = await lockout.lockedFor([ipKey]);
      if (ipLockedMs > 0) return locked(ipLockedMs);
      // The per-identifier limit is reserved atomically before the PIN is
      // checked (issue #35): at most maxFailuresPerIdentifier PINs are ever
      // checked per window, whatever the concurrency across replicas.
      const reservation = await lockout.reserve(
        identifierKey,
        kiosk.maxFailuresPerIdentifier,
      );
      if (!reservation.allowed) return locked(reservation.lockedMs);

      const found = await withTenant(
        sql,
        { organizationId: user.organizationId, userId: user.id },
        (tx) => employeeRepo.findByIdentifier(tx, identifier.trim()),
      );
      const check = found?.pinHash
        ? await verifyKioskPin(pin, found.pinHash, found.pinSalt)
        : { valid: false, needsRehash: false };
      if (!found?.pinHash) await verifyKioskPin(pin, await decoy(), null);

      if (!found || !check.valid) {
        // The identifier's failure was counted by its reservation.
        await lockout.recordFailure([
          { key: ipKey, limit: kiosk.maxFailuresPerIp },
        ]);
        return c.json(genericInvalid(), 401, {
          "Content-Type": "application/problem+json",
        });
      }
      await lockout.reset(identifierKey);

      const upgradedHash = check.needsRehash ? await hashKioskPin(pin) : null;

      const created = await withTenant(
        sql,
        { organizationId: user.organizationId, userId: user.id },
        async (tx) => {
          if (upgradedHash) {
            await employeeRepo.upgradeKioskPinHash(tx, found.id, upgradedHash);
          }

          const event = await timeRepo.appendEvent(tx, options.sign, {
            organizationId: user.organizationId,
            employeeId: found.id,
            eventType,
            source: "kiosk",
            actorId: found.userId ?? user.id,
          });

          await auditRepo.log(tx, {
            actorId: user.id,
            action: "time.kiosk_clock",
            resourceType: "time_event",
            resourceId: event.id,
            metadata: {
              employeeId: found.id,
              eventType,
              source: "kiosk",
              pinUpgraded: Boolean(upgradedHash),
            },
          });

          return event;
        },
      );

      let newStatus: "clocked_in" | "on_break" | "clocked_out" = "clocked_out";
      if (eventType === "clock_in" || eventType === "break_end") {
        newStatus = "clocked_in";
      } else if (eventType === "break_start") {
        newStatus = "on_break";
      }

      return c.json({
        success: true,
        employeeName: found.preferredName || found.firstName,
        eventType,
        occurredAt: created.occurredAt.toISOString(),
        newStatus,
      });
    },
  );

  return router;
}
