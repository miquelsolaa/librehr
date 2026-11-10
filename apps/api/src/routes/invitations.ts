import { Hono } from "hono";
import type { Sql } from "postgres";
import {
  type AuthUser,
  createProblemDetails,
  CreateInvitationRequestSchema,
  AcceptInvitationRequestSchema,
} from "@librehr/contracts";
import {
  withTenant,
  InvitationRepository,
  IdentityRepository,
  EmployeeRepository,
  AuditRepository,
  AuditorAccessRepository,
} from "@librehr/db";
import { UnauthorizedError } from "../errors/index.js";
import { requireAuth } from "../middleware/auth.js";
import { can } from "../policies/can.js";
import type { AuthPort } from "../ports/auth.js";
import type { MailPort } from "../ports/mail.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { assertAuditorAccessEnd } from "../lib/auditor-access.js";
import {
  setSessionCookie,
  type SessionCookieOptions,
} from "../lib/session-cookie.js";

export function createInvitationRoutes(
  sql: Sql,
  authPort: AuthPort,
  mailPort?: MailPort,
  cookieOptions: SessionCookieOptions = {},
) {
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
        detail: parse.error.errors.map((e) => e.message).join(", "),
        code: "VALIDATION_FAILED",
      });
      return c.json(problem, 400, {
        "Content-Type": "application/problem+json",
      });
    }

    const created = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        // TIM-008: the schema guarantees an end date for auditors (and none
        // for other roles); it must also fit the organization's window.
        const accessExpiresAt =
          parse.data.accessExpiresAt === undefined
            ? null
            : new Date(parse.data.accessExpiresAt);
        if (accessExpiresAt) {
          assertAuditorAccessEnd(accessExpiresAt, await auditorRepo.window(tx));
        }

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

    // If MailPort is available, send invitation email
    if (mailPort) {
      await mailPort
        .sendMail({
          to: created.email,
          subject: "You have been invited to join LibreHR",
          html: `<p>Hello,</p><p>You have been invited to LibreHR. Click the link below to accept your invitation:</p><p><a href="/invite/${created.token}">Accept Invitation</a></p>`,
        })
        .catch(() => {
          // Log mail delivery failure without breaking invitation creation
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
        detail: parse.error.errors.map((e) => e.message).join(", "),
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

        // 3. Create Membership
        await tx`
          INSERT INTO memberships (organization_id, user_id, role, access_expires_at)
          VALUES (${invite.organizationId}, ${user.id}, ${invite.role}, ${accepted.accessExpiresAt})
          ON CONFLICT (organization_id, user_id) DO UPDATE
          SET role = EXCLUDED.role, access_expires_at = EXCLUDED.access_expires_at
        `;

        // 4. Create Employee record if not existing
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
    const session = await authPort.createSession(authUser);
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
