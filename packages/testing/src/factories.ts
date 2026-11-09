import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";

export type FixtureRole = "admin" | "manager" | "employee" | "auditor";

/** A user with a membership and a linked employee, shaped like AuthUser. */
export interface FixturePerson {
  id: string;
  email: string;
  name: string;
  role: FixtureRole;
  organizationId: string;
  employeeId: string;
}

/**
 * One organization with the people needed to exercise every authorization
 * scope: an admin, a manager with one direct report, an unrelated peer and an
 * auditor. All data is synthetic (`.invalid` addresses).
 */
export interface ScopedOrgFixture {
  orgId: string;
  admin: FixturePerson;
  manager: FixturePerson;
  report: FixturePerson;
  peer: FixturePerson;
  auditor: FixturePerson;
}

async function createPerson(
  sql: Sql,
  orgId: string,
  label: string,
  role: FixtureRole,
  managerEmployeeId: string | null = null,
): Promise<FixturePerson> {
  const id = randomUUID();
  const employeeId = randomUUID();
  const email = `${label}-${id.slice(0, 8)}@fixture.invalid`;
  const name = `Fixture ${label}`;
  await sql`INSERT INTO users (id, email, name) VALUES (${id}, ${email}, ${name})`;
  await sql`
    INSERT INTO memberships (organization_id, user_id, role)
    VALUES (${orgId}, ${id}, ${role})
  `;
  await sql`
    INSERT INTO employees (id, organization_id, user_id, manager_id, first_name, last_name, email)
    VALUES (${employeeId}, ${orgId}, ${id}, ${managerEmployeeId}, 'Fixture', ${label}, ${email})
  `;
  return { id, email, name, role, organizationId: orgId, employeeId };
}

/**
 * Seeds a {@link ScopedOrgFixture}. Uses the owner connection directly, so it
 * is meant for integration tests only.
 *
 * @example
 * const orgA = await seedScopedOrg(db.sql, "authz-a");
 * const orgB = await seedScopedOrg(db.sql, "authz-b");
 */
export async function seedScopedOrg(
  sql: Sql,
  slug: string,
): Promise<ScopedOrgFixture> {
  const orgId = randomUUID();
  await sql`
    INSERT INTO organizations (id, name, slug)
    VALUES (${orgId}, ${`Fixture ${slug}`}, ${`${slug}-${orgId.slice(0, 8)}`})
  `;
  const admin = await createPerson(sql, orgId, "admin", "admin");
  const manager = await createPerson(sql, orgId, "manager", "manager");
  const report = await createPerson(
    sql,
    orgId,
    "report",
    "employee",
    manager.employeeId,
  );
  const peer = await createPerson(sql, orgId, "peer", "employee");
  const auditor = await createPerson(sql, orgId, "auditor", "auditor");
  return { orgId, admin, manager, report, peer, auditor };
}
