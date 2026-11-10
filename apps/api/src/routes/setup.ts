import crypto from "node:crypto";
import { Hono } from "hono";
import type { Sql } from "postgres";
import {
  createProblemDetails,
  SetupWizardRequestSchema,
} from "@librehr/contracts";
import {
  withTenant,
  EmployeeRepository,
  AuditRepository,
  type TenantTx,
} from "@librehr/db";
import { ConflictError, UnauthorizedError } from "../errors/index.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { createRateLimiter } from "../middleware/rate-limit.js";

/**
 * ORG-001 is a first-run wizard: once any organization exists the endpoint is
 * closed, so an unauthenticated caller cannot create organizations on a
 * running instance. ORG-006 instance super-admin org management does not
 * exist yet; when it does, it needs its own authenticated route.
 */
async function instanceIsSetUp(db: Sql | TenantTx): Promise<boolean> {
  const rows = await db.unsafe<{ exists: boolean }[]>(
    `SELECT EXISTS (SELECT 1 FROM organizations) AS "exists"`,
  );
  return rows[0]?.exists === true;
}

function setupCompleted(): ConflictError {
  return new ConflictError({
    code: "SETUP_ALREADY_COMPLETED",
    detail: "This instance has already been set up",
  });
}

export function createSetupRoutes(
  sql: Sql,
  options: { trustProxy?: number | undefined } = {},
) {
  const router = new Hono();
  const employeeRepo = new EmployeeRepository();
  const auditRepo = new AuditRepository();
  const setupRateLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 10,
    trustProxy: options.trustProxy,
  });

  router.post("/org/setup-wizard", setupRateLimiter, async (c) => {
    const body = await c.req.json();
    const parse = SetupWizardRequestSchema.safeParse(body);
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

    const data = parse.data;

    // Fast path; the authoritative check runs again under a lock below.
    if (await instanceIsSetUp(sql)) throw setupCompleted();

    const existingUsers = await sql<{ password_hash: string | null }[]>`
      SELECT password_hash FROM users WHERE email = ${data.adminEmail} LIMIT 1
    `;
    if (
      existingUsers[0] &&
      !(await verifyPassword(
        data.adminPassword,
        existingUsers[0].password_hash,
      ))
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
    const passwordHash = await hashPassword(data.adminPassword);

    // The organization id is chosen up front so that the organization row and
    // everything seeded for it are written in one tenant transaction: if any
    // step fails, nothing is left behind.
    const orgId = crypto.randomUUID();

    await withTenant(sql, { organizationId: orgId }, async (tx) => {
      // Serialises concurrent first-run attempts; the check below then sees
      // any organization committed by the winner.
      await tx`SELECT pg_advisory_xact_lock(hashtext('librehr.setup_wizard'))`;
      if (await instanceIsSetUp(tx)) throw setupCompleted();

      // 1. Organization (a global table without RLS)
      await tx`
        INSERT INTO organizations (id, name, slug, default_locale, timezone)
        VALUES (${orgId}, ${data.orgName}, ${data.orgSlug}, ${data.defaultLocale}, ${data.timezone})
      `;

      // 2. Tenant-scoped initialization
      // 2a. Legal Entity
      const entityRows = await tx<{ id: string }[]>`
        INSERT INTO legal_entities (organization_id, name, tax_id, country)
        VALUES (${orgId}, ${data.legalEntityName}, ${data.legalEntityCif}, 'ES')
        RETURNING id
      `;
      const entityId = entityRows[0]!.id;

      // 2b. Initial Work Location
      const locRows = await tx<{ id: string }[]>`
        INSERT INTO locations (organization_id, legal_entity_id, name, country, region, city, timezone)
        VALUES (${orgId}, ${entityId}, ${data.locationName}, 'ES', ${data.locationRegion}, ${data.locationCity}, ${data.timezone})
        RETURNING id
      `;
      const locationId = locRows[0]!.id;

      // 2c. Default Departments
      const deptRows = await tx<{ id: string }[]>`
        INSERT INTO departments (organization_id, name)
        VALUES (${orgId}, 'Management'), (${orgId}, 'Engineering'), (${orgId}, 'Operations'), (${orgId}, 'People & Culture')
        RETURNING id
      `;
      const managementDeptId = deptRows[0]?.id ?? null;

      // 2d. Create Admin User
      const userRows = await tx<{ id: string }[]>`
        INSERT INTO users (email, name, password_hash, email_verified)
        VALUES (${data.adminEmail}, ${data.adminName}, ${passwordHash}, true)
        ON CONFLICT (email) DO NOTHING
        RETURNING id
      `;
      const adminUserId =
        userRows[0]?.id ??
        (
          await tx<
            { id: string; password_hash: string | null }[]
          >`SELECT id, password_hash FROM users WHERE email = ${data.adminEmail} FOR UPDATE`
        )[0];
      const userId =
        typeof adminUserId === "string"
          ? adminUserId
          : adminUserId &&
              (await verifyPassword(
                data.adminPassword,
                adminUserId.password_hash,
              ))
            ? adminUserId.id
            : null;
      // The admin's password changed between the pre-check and this locked
      // read: answer like the pre-check instead of a 500.
      if (!userId)
        throw new UnauthorizedError({
          detail: "Invalid email or password",
          code: "INVALID_CREDENTIALS",
        });

      // 2e. Create Membership as admin
      await tx`
        INSERT INTO memberships (organization_id, user_id, role)
        VALUES (${orgId}, ${userId}, 'admin')
        ON CONFLICT (organization_id, user_id) DO UPDATE
        SET role = 'admin', access_expires_at = NULL
      `;

      // 2f. Create First Employee Record
      const nameParts = data.adminName.trim().split(" ");
      const firstName = nameParts[0] ?? data.adminName;
      const lastName = nameParts.slice(1).join(" ") || "Admin";

      const emp = await employeeRepo.create(tx, {
        userId,
        departmentId: managementDeptId,
        locationId,
        firstName,
        lastName,
        email: data.adminEmail,
        jobTitle: "Founder / Administrator",
      });

      // 2g. Initial Audit log entry
      await auditRepo.log(tx, {
        actorId: userId,
        action: "organization.bootstrap",
        resourceType: "organization",
        resourceId: orgId,
        metadata: {
          orgName: data.orgName,
          slug: data.orgSlug,
          location: data.locationName,
          employeeId: emp.id,
        },
      });
    });

    return c.json({
      success: true,
      organizationId: orgId,
    });
  });

  return router;
}
