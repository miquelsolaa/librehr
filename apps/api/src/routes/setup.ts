import { Hono } from "hono";
import type { Sql } from "postgres";
import {
  createProblemDetails,
  SetupWizardRequestSchema,
} from "@openhr/contracts";
import { withTenant, EmployeeRepository, AuditRepository } from "@openhr/db";

export function createSetupRoutes(sql: Sql) {
  const router = new Hono();
  const employeeRepo = new EmployeeRepository();
  const auditRepo = new AuditRepository();

  router.post("/org/setup-wizard", async (c) => {
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

    // Check if slug already exists
    const existingOrg = await sql<{ id: string }[]>`
      SELECT id FROM organizations WHERE slug = ${data.orgSlug} LIMIT 1
    `;
    if (existingOrg.length > 0) {
      const problem = createProblemDetails({
        status: 409,
        title: "Conflict",
        detail: "An organization with this slug already exists",
        code: "SLUG_ALREADY_EXISTS",
      });
      return c.json(problem, 409, {
        "Content-Type": "application/problem+json",
      });
    }

    // 1. Create Organization (unrestricted)
    const orgRows = await sql<{ id: string }[]>`
      INSERT INTO organizations (name, slug, default_locale, timezone)
      VALUES (${data.orgName}, ${data.orgSlug}, ${data.defaultLocale}, ${data.timezone})
      RETURNING id
    `;
    const orgId = orgRows[0]!.id;

    // 2. Perform tenant-scoped initialization
    await withTenant(sql, { organizationId: orgId }, async (tx) => {
      // 2a. Legal Entity
      const entityRows = await tx<{ id: string }[]>`
        INSERT INTO legal_entities (organization_id, name, cif, country)
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
        VALUES (${data.adminEmail}, ${data.adminName}, ${data.adminPassword}, true)
        ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
        RETURNING id
      `;
      const adminUserId = userRows[0]!.id;

      // 2e. Create Membership as admin
      await tx`
        INSERT INTO memberships (organization_id, user_id, role)
        VALUES (${orgId}, ${adminUserId}, 'admin')
        ON CONFLICT (organization_id, user_id) DO UPDATE SET role = 'admin'
      `;

      // 2f. Create First Employee Record
      const nameParts = data.adminName.trim().split(" ");
      const firstName = nameParts[0] ?? data.adminName;
      const lastName = nameParts.slice(1).join(" ") || "Admin";

      const emp = await employeeRepo.create(tx, {
        userId: adminUserId,
        departmentId: managementDeptId,
        locationId,
        firstName,
        lastName,
        email: data.adminEmail,
        jobTitle: "Founder / Administrator",
      });

      // 2g. Initial Audit log entry
      await auditRepo.log(tx, {
        actorId: adminUserId,
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
