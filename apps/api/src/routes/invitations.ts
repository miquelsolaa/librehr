import { Hono } from "hono";
import type { Sql } from "postgres";
import {
  type AuthUser,
  createProblemDetails,
  CreateInvitationRequestSchema,
  AcceptInvitationRequestSchema,
  AUDITOR_ACCESS_ERROR_CODES,
} from "@librehr/contracts";
import {
  withTenant,
  InvitationRepository,
  IdentityRepository,
  EmployeeRepository,
  AuditRepository,
  AuditorAccessRepository,
} from "@librehr/db";
import { AppError, UnauthorizedError } from "../errors/index.js";
import { requireAuth } from "../middleware/auth.js";
import { requireInteractiveSession } from "../middleware/pat-scopes.js";
import { can } from "../policies/can.js";
import type { AuthPort } from "../ports/auth.js";
import type { MailPort } from "../ports/mail.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { invitationEmail } from "../lib/invitation-email.js";
import { logger } from "../middleware/logger.js";
import { resolveAuditorAccessEnd } from "../lib/auditor-access.js";
import {
  setSessionCookie,
  type SessionCookieOptions,
} from "../lib/session-cookie.js";

/** Roles whose invitation grants access control: interactive sessions only. */
const INTERACTIVE_ONLY_INVITE_ROLES: ReadonlySet<string> = new Set([
  "admin",
  "auditor",
]);

export function createInvitationRoutes(
  sql: Sql,
  authPort: AuthPort,
  mailPort?: MailPort,
  cookieOptions: SessionCookieOptions & {
    /** Public web app URL (APP_URL), the base of invitation links. */
    appUrl?: string | undefined;
  } = {},
) {
  const { appUrl } = cookieOptions;
  if (mailPort && !appUrl) {
    logger.warn("invitation emails are off: APP_URL is not configured");
  }
  const router = new Hono();
  const invitationRepo = new InvitationRepository();
  const identityRepo = new IdentityRepository();
  const employeeRepo = new EmployeeRepository();
  const auditRepo = new AuditRepository();
  const auditorRepo = new AuditorAccessRepository();

  router.post("/invitations", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;

    const allowed = can(
      {
        userId: user.id,
        organizationId: user.organizationId,
        role: user.role,
      },
      "employee.write",
    );

    if (!allowed) {
      const problem = createProblemDetails({
        status: 403,
        title: "Forbidden",
        detail: "You do not have permission to invite employees",
        code: "FORBIDDEN",
      });
      return c.json(problem, 403, {
        "Content-Type": "application/problem+json",
      });
    }

    const body = await c.req.json();
    const parse = CreateInvitationRequestSchema.safeParse(body);
    if (!parse.success) {
      const problem = createProblemDetails({
        status: 400,
        title: "Validation Failed",
        detail: parse.error.issues.map((e) => e.message).join(", "),
        code: "VALIDATION_FAILED",
      });
      return c.json(problem, 400, {
        "Content-Type": "application/problem+json",
      });
    }

    // Inviting an admin or an auditor grants access, like the /v1/auditors
    // routes (TIM-008), so it needs an interactive session: never a personal
    // access token, even an admin one (issue #35). Manager and employee
    // invitations still accept admin-scoped tokens.
    if (INTERACTIVE_ONLY_INVITE_ROLES.has(parse.data.role)) {
      requireInteractiveSession(c);
    }

    const created = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        // TIM-008: the schema guarantees a last day of access for auditors
        // (and none for other roles); it must also fit the organization's
        // window, and becomes the instant access ends in its time zone.
        const accessExpiresAt =
          parse.data.accessUntil === undefined
            ? null
            : resolveAuditorAccessEnd(
                parse.data.accessUntil,
                await auditorRepo.window(tx),
              );

        const invite = await invitationRepo.create(tx, {
          email: parse.data.email,
          role: parse.data.role,
          invitedById: user.id,
          accessExpiresAt,
        });

        // No PII in audit metadata: the invitation id identifies the invitee.
        await auditRepo.log(tx, {
          actorId: user.id,
          action: "invitation.create",
          resourceType: "invitation",
          resourceId: invite.id,
          metadata: {
            role: parse.data.role,
            accessExpiresAt: accessExpiresAt?.toISOString() ?? null,
          },
        });

        return invite;
      },
    );

    // A relative link cannot be opened from a mail client, so without
    // APP_URL no email is sent; the invitation can still be shared by hand.
    if (mailPort && appUrl) {
      const [org] = await sql<{ name: string; defaultLocale: string }[]>`
        SELECT name, default_locale AS "defaultLocale"
        FROM organizations WHERE id = ${user.organizationId}`;
      const message = invitationEmail(
        appUrl,
        org?.defaultLocale,
        org?.name,
        created.token,
      );
      await mailPort
        .sendMail({ to: created.email, ...message })
        .catch((err: unknown) => {
          // Invitation creation must not fail on delivery. Only the error
          // class: SMTP messages often quote the recipient address.
          logger.error(
            { errName: err instanceof Error ? err.name : "unknown" },
            "invitation email failed",
          );
        });
    }

    return c.json(
      {
        id: created.id,
        email: created.email,
        role: created.role,
        expiresAt: new Date(created.expiresAt).toISOString(),
        accessExpiresAt: created.accessExpiresAt
          ? new Date(created.accessExpiresAt).toISOString()
          : null,
        acceptedAt: created.acceptedAt
          ? new Date(created.acceptedAt).toISOString()
          : null,
        createdAt: new Date(created.createdAt).toISOString(),
      },
      201,
    );
  });

  router.get("/invitations/:token", async (c) => {
    const token = c.req.param("token");

    const invite = await identityRepo.invitation(sql, token);
    if (!invite) {
      const problem = createProblemDetails({
        status: 404,
        title: "Invitation Not Found",
        detail: "The invitation token is invalid or has expired",
        code: "INVITATION_NOT_FOUND",
      });
      return c.json(problem, 404, {
        "Content-Type": "application/problem+json",
      });
    }

    if (new Date(invite.expiresAt).getTime() < Date.now()) {
      const problem = createProblemDetails({
        status: 410,
        title: "Invitation Expired",
        detail: "This invitation has expired. Please request a new invite.",
        code: "INVITATION_EXPIRED",
      });
      return c.json(problem, 410, {
        "Content-Type": "application/problem+json",
      });
    }

    if (invite.acceptedAt) {
      const problem = createProblemDetails({
        status: 410,
        title: "Invitation Already Accepted",
        detail: "This invitation has already been used.",
        code: "INVITATION_ALREADY_ACCEPTED",
      });
      return c.json(problem, 410, {
        "Content-Type": "application/problem+json",
      });
    }

    // TIM-008: an auditor invitation whose access period has already ended
    // cannot be accepted (see markAccepted); say so specifically.
    const accessExpiresAt = await withTenant(
      sql,
      { organizationId: invite.organizationId },
      (tx) => invitationRepo.accessExpiresAt(tx, invite.id),
    );
    if (accessExpiresAt && accessExpiresAt.getTime() <= Date.now()) {
      const problem = createProblemDetails({
        status: 410,
        title: "Invitation Access Expired",
        detail:
          "The access period this invitation grants has ended. Please request a new invite.",
        code: AUDITOR_ACCESS_ERROR_CODES.invitationAccessExpired,
      });
      return c.json(problem, 410, {
        "Content-Type": "application/problem+json",
      });
    }

    return c.json({
      email: invite.email,
      role: invite.role,
      orgName: invite.organizationName,
      expiresAt: new Date(invite.expiresAt).toISOString(),
    });
  });

  router.post("/invitations/accept", async (c) => {
    const body = await c.req.json();
    const parse = AcceptInvitationRequestSchema.safeParse(body);
    if (!parse.success) {
      const problem = createProblemDetails({
        status: 400,
        title: "Validation Failed",
        detail: parse.error.issues.map((e) => e.message).join(", "),
        code: "VALIDATION_FAILED",
      });
      return c.json(problem, 400, {
        "Content-Type": "application/problem+json",
      });
    }

    const { token, name, password } = parse.data;
    const invite = await identityRepo.invitation(sql, token);
    if (
      !invite ||
      invite.acceptedAt ||
      new Date(invite.expiresAt).getTime() < Date.now()
    ) {
      const problem = createProblemDetails({
        status: 400,
        title: "Invalid Invitation",
        detail: "This invitation is invalid, expired, or already used.",
        code: "INVALID_INVITATION",
      });
      return c.json(problem, 400, {
        "Content-Type": "application/problem+json",
      });
    }

    const existing = await sql<{ password_hash: string | null }[]>`
      SELECT password_hash FROM users WHERE email = ${invite.email} LIMIT 1
    `;
    if (
      existing[0] &&
      !(await verifyPassword(password, existing[0].password_hash))
    ) {
      return c.json(
        createProblemDetails({
          status: 401,
          title: "Unauthorized",
          detail: "Invalid email or password",
          code: "INVALID_CREDENTIALS",
        }),
        401,
        { "Content-Type": "application/problem+json" },
      );
    }
    const passwordHash = await hashPassword(password);

    // Process acceptance in a tenant transaction
    const authUser = await withTenant(
      sql,
      { organizationId: invite.organizationId },
      async (tx) => {
        // 1. Mark invitation accepted. An auditor invitation whose access
        // end date (TIM-008) has passed is refused like an expired link.
        const accepted = await invitationRepo.markAccepted(tx, invite.id);
        if (!accepted) return null;

        // 2. Create or find User
        const userRows = await tx<
          { id: string; email: string; name: string }[]
        >`
          INSERT INTO users (email, name, password_hash, email_verified)
          VALUES (${invite.email}, ${name}, ${passwordHash}, true)
          ON CONFLICT (email) DO NOTHING
          RETURNING id, email, name
        `;
        let user = userRows[0];
        if (!user) {
          const rows = await tx<
            {
              id: string;
              email: string;
              name: string;
              password_hash: string | null;
            }[]
          >`
            SELECT id, email, name, password_hash FROM users WHERE email = ${invite.email} FOR UPDATE
          `;
          const account = rows[0];
          if (
            !account ||
            !(await verifyPassword(password, account.password_hash))
          )
            // The account's password changed between the pre-check and this
            // locked read: answer like the pre-check instead of a 500.
            throw new UnauthorizedError({
              detail: "Invalid email or password",
              code: "INVALID_CREDENTIALS",
            });
          user = account;
        }

        // 3. TIM-008: an invitation older than the last access change of an
        // existing auditor membership is stale. The admin has since revoked,
        // shortened or extended that access, and accepting must not rewrite
        // it. Revoking or shortening also expires pending invitations
        // outright; this check covers every other order of events. Throwing
        // rolls the acceptance back, so the invitation stays unused.
        if (
          await auditorRepo.auditorMembershipChangedAfter(
            tx,
            user.id,
            accepted.createdAt,
          )
        ) {
          throw new AppError({
            status: 400,
            title: "Invalid Invitation",
            code: "INVALID_INVITATION",
            detail: "This invitation is invalid, expired, or already used.",
          });
        }

        // 4. Create Membership. The access end date follows the role: set
        // for auditors, cleared for every other role (migration 0029 CHECK).
        await tx`
          INSERT INTO memberships (organization_id, user_id, role, access_expires_at)
          VALUES (${invite.organizationId}, ${user.id}, ${invite.role}, ${accepted.accessExpiresAt})
          ON CONFLICT (organization_id, user_id) DO UPDATE
          SET role = EXCLUDED.role, access_expires_at = EXCLUDED.access_expires_at
        `;

        // 5. Create the Employee record. Auditors (TIM-008) only get read
        // access: they are not employed, so they must not appear in time
        // exports or headcount.
        if (invite.role !== "auditor") {
          const nameParts = name.trim().split(" ");
          const firstName = nameParts[0] ?? name;
          const lastName = nameParts.slice(1).join(" ") || "Employee";

          await employeeRepo.create(tx, {
            userId: user.id,
            firstName,
            lastName,
            email: user.email,
            departmentId: null,
          });
        }

        await auditRepo.log(tx, {
          actorId: user.id,
          action: "invitation.accept",
          resourceType: "invitation",
          resourceId: invite.id,
        });

        const authUser: AuthUser = {
          id: user.id,
          email: user.email,
          name: user.name,
          role: invite.role,
          organizationId: invite.organizationId,
        };

        return authUser;
      },
    );

    if (!authUser) {
      return c.json(
        createProblemDetails({
          status: 400,
          title: "Invalid Invitation",
          detail: "This invitation is invalid, expired, or already used.",
          code: "INVALID_INVITATION",
        }),
        400,
        { "Content-Type": "application/problem+json" },
      );
    }
    // AUTH-004: in an organization that requires SSO, the acceptance above
    // has committed and createSession throws SsoRequiredError (403
    // SSO_REQUIRED); the client continues with single sign-on. That includes
    // break-glass admins: accepting checks no second factor and writes no
    // break-glass audit entry, so they sign in through /auth/sign-in instead.
    const session = await authPort.createSession(authUser, {
      allowBreakGlass: false,
    });
    if (!session) {
      throw new UnauthorizedError({
        code: "INVALID_INVITATION",
        detail: "This invitation is invalid, expired, or already used.",
      });
    }
    // The session lives only in the httpOnly cookie (AUTH-001/002).
    setSessionCookie(c, session.token, session.expiresAt, cookieOptions);
    return c.json({
      user: session.user,
      expiresAt: session.expiresAt.toISOString(),
    });
  });

  return router;
}
