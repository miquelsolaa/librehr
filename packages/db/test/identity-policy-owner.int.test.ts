import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres, { type Sql } from "postgres";
import {
  createRoleSeparatedDatabase,
  getTestDatabase,
  type RoleSeparatedDatabase,
  type TestDatabase,
} from "@librehr/testing";
import { runMigrations } from "../src/migrate.js";
import { withTenant } from "../src/with-tenant.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_0020 = fs.readFileSync(
  path.resolve(
    __dirname,
    "../migrations/0020_identity_lookup_policy_owner.sql",
  ),
  "utf-8",
);

const POLICIES = [
  ["memberships", "memberships_identity_lookup"],
  ["personal_access_tokens", "personal_access_tokens_identity_lookup"],
  ["invitations", "invitations_identity_lookup"],
  ["sso_configurations", "sso_configurations_identity_lookup"],
] as const;

// AUTH-001: the 0019 lookup policies must apply to the role that owns the
// SECURITY DEFINER functions (librehr_owner), whoever ran migration 0019.
describe("identity-lookup policies follow the function owner (0020)", () => {
  let base: TestDatabase;
  let db: RoleSeparatedDatabase;
  let owner: Sql;
  const org = "a9000000-0000-0000-0000-00000000000a";
  const user = "c9000000-0000-0000-0000-00000000000c";

  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database) throw new Error("Docker is required for role tests");
    base = database;
    db = await createRoleSeparatedDatabase(base);
    await runMigrations(db.ownerConnectionString);
    owner = postgres(db.ownerConnectionString, { max: 2, onnotice: () => {} });

    await db.adminSql`INSERT INTO organizations (id, name, slug) VALUES (${org}, 'P', 'policy-owner')`;
    await db.adminSql`INSERT INTO users (id, email, name) VALUES (${user}, 'policy@example.invalid', 'Policy')`;
    await withTenant(db.adminSql, { organizationId: org }, async (tx) => {
      await tx`INSERT INTO memberships (organization_id, user_id) VALUES (${org}, ${user})`;
    });
  }, 60000);

  afterAll(async () => {
    if (owner) await owner.end();
    if (db) await db.close();
    if (base) await base.close();
  });

  const policyRoles = async () =>
    db.adminSql<{ policyname: string; roles: string[] }[]>`
      SELECT policyname, roles::text[] AS roles FROM pg_policies
      WHERE schemaname = 'public' AND policyname LIKE '%_identity_lookup'
      ORDER BY policyname`;

  // librehr_app no longer has EXECUTE on librehr_auth_membership (0021); the
  // SECURITY DEFINER function runs as its owner either way, so call it as the
  // owner to exercise the same policy path.
  const lookup = async () =>
    owner<
      { organization_id: string }[]
    >`SELECT organization_id FROM librehr_auth_membership(${user}::uuid)`;

  it("binds every lookup policy to librehr_owner after a normal install", async () => {
    const rows = await policyRoles();
    const names = rows.map((r) => r.policyname);
    for (const [, policy] of POLICIES) expect(names).toContain(policy);
    for (const row of rows) expect(row.roles).toEqual(["librehr_owner"]);
    expect(await lookup()).toEqual([{ organization_id: org }]);
  });

  it("repairs policies left on another role (0019 run as the bootstrap user)", async () => {
    // Simulate 0019 having run as the bootstrap superuser, with the function
    // ownership later moved to librehr_owner by the upgrade script.
    const [{ bootstrap } = { bootstrap: "" }] = await db.adminSql<
      { bootstrap: string }[]
    >`SELECT current_user AS bootstrap`;
    for (const [table, policy] of POLICIES) {
      await db.adminSql.unsafe(
        `ALTER POLICY "${policy}" ON "${table}" TO "${bootstrap}"`,
      );
    }
    expect(await lookup()).toEqual([]);

    await owner.unsafe(MIGRATION_0020);

    for (const row of await policyRoles()) {
      expect(row.roles).toEqual(["librehr_owner"]);
    }
    expect(await lookup()).toEqual([{ organization_id: org }]);
  });
});
