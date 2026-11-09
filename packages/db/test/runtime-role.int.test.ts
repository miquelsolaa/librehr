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
import { hashBearerToken } from "../src/crypto/token-hash.js";
import { seedDevDatabase } from "../seeds/dev.js";

const APPEND_ONLY_TABLES = ["time_events", "leave_ledger", "audit_log"];
// Callable by librehr_app: each one is keyed by a secret the caller holds.
const LOOKUP_FUNCTIONS = [
  "librehr_auth_session",
  "librehr_auth_session_bind_org",
  "librehr_auth_personal_access_token",
  "librehr_auth_invitation",
  "librehr_auth_sso_config",
];

// Production layout: NOSUPERUSER NOBYPASSRLS owner runs migrations, the
// runtime role librehr_app serves requests.
describe("runtime and owner roles", () => {
  let base: TestDatabase;
  let db: RoleSeparatedDatabase;
  let owner: Sql;
  const orgA = "a8000000-0000-0000-0000-00000000000a";
  const orgB = "b8000000-0000-0000-0000-00000000000b";
  const user = "c8000000-0000-0000-0000-00000000000c";

  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database) throw new Error("Docker is required for role tests");
    base = database;
    db = await createRoleSeparatedDatabase(base);
    await runMigrations(db.ownerConnectionString);
    owner = postgres(db.ownerConnectionString, { max: 2 });

    await db.adminSql`INSERT INTO organizations (id, name, slug) VALUES
      (${orgA}, 'A', 'roles-a'), (${orgB}, 'B', 'roles-b')`;
    await db.adminSql`INSERT INTO users (id, email, name) VALUES (${user}, 'roles@example.invalid', 'Roles')`;
    await withTenant(db.adminSql, { organizationId: orgA }, async (tx) => {
      await tx`INSERT INTO employees (organization_id, first_name, last_name, email)
        VALUES (${orgA}, 'Ana', 'Alpha', 'ana@example.invalid')`;
      await tx`INSERT INTO memberships (organization_id, user_id) VALUES (${orgA}, ${user})`;
    });
  }, 60000);

  afterAll(async () => {
    if (owner) await owner.end();
    if (db) await db.close();
    if (base) await base.close();
  });

  it("returns no tenant rows to the runtime role without, or with the wrong, tenant context", async () => {
    const [none] = await db.appSql<
      { n: number }[]
    >`SELECT count(*)::int AS n FROM employees`;
    expect(none?.n).toBe(0);

    const [wrong] = await withTenant(
      db.appSql,
      { organizationId: orgB },
      (tx) => tx<{ n: number }[]>`SELECT count(*)::int AS n FROM employees`,
    );
    expect(wrong?.n).toBe(0);

    const [own] = await withTenant(
      db.appSql,
      { organizationId: orgA },
      (tx) => tx<{ n: number }[]>`SELECT count(*)::int AS n FROM employees`,
    );
    expect(own?.n).toBe(1);
  });

  it("withholds UPDATE, DELETE and TRUNCATE on append-only tables from the runtime role", async () => {
    for (const table of APPEND_ONLY_TABLES) {
      const [privileges] = await db.adminSql<
        { ins: boolean; upd: boolean; del: boolean; trunc: boolean }[]
      >`SELECT has_table_privilege('librehr_app', ${table}, 'INSERT') AS ins,
               has_table_privilege('librehr_app', ${table}, 'UPDATE') AS upd,
               has_table_privilege('librehr_app', ${table}, 'DELETE') AS del,
               has_table_privilege('librehr_app', ${table}, 'TRUNCATE') AS trunc`;
      expect(privileges).toEqual({
        ins: true,
        upd: false,
        del: false,
        trunc: false,
      });
    }
    await expect(
      withTenant(
        db.appSql,
        { organizationId: orgA },
        (tx) => tx`UPDATE time_events SET reason = 'edited'`,
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it("keeps the owner bound by RLS outside the identity lookup functions", async () => {
    const [role] = await owner<
      { rolbypassrls: boolean; rolsuper: boolean }[]
    >`SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user`;
    expect(role).toEqual({ rolbypassrls: false, rolsuper: false });

    const [visible] = await owner<
      { n: number }[]
    >`SELECT count(*)::int AS n FROM memberships`;
    expect(visible?.n).toBe(0);

    // The runtime role reaches memberships only through a secret it holds:
    // here, a session token bound to the default membership.
    // Stored as the API stores it (migration 0026): the digest only. The
    // functions compare the value given; the repositories hash before calling.
    const token = hashBearerToken("runtime-role-bind-token");
    await db.adminSql`INSERT INTO sessions (user_id, token, expires_at)
      VALUES (${user}, ${token}, now() + interval '1 hour')`;
    const [viaFunction] = await db.appSql<
      { organization_id: string }[]
    >`SELECT organization_id FROM librehr_auth_session_bind_org(${token})`;
    expect(viaFunction?.organization_id).toBe(orgA);

    // The lookup flag does not outlive the function call.
    const flag = await db.appSql.begin(async (tx) => {
      await tx`SELECT * FROM librehr_auth_session(${token})`;
      return tx<
        { value: string | null }[]
      >`SELECT current_setting('librehr.identity_lookup', true) AS value`;
    });
    expect(flag[0]?.value ?? "").toBe("");
  });

  it("defines the lookup functions as hardened SECURITY DEFINER, callable only by librehr_app", async () => {
    const rows = await db.adminSql<
      {
        proname: string;
        prosecdef: boolean;
        proconfig: string[] | null;
        public_exec: boolean;
        app_exec: boolean;
      }[]
    >`
      SELECT p.proname, p.prosecdef, p.proconfig,
             has_function_privilege('public', p.oid, 'EXECUTE') AS public_exec,
             has_function_privilege('librehr_app', p.oid, 'EXECUTE') AS app_exec
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = ANY(${LOOKUP_FUNCTIONS})
    `;
    expect(rows.map((r) => r.proname).sort()).toEqual(
      [...LOOKUP_FUNCTIONS].sort(),
    );
    for (const row of rows) {
      expect(row.prosecdef, row.proname).toBe(true);
      expect(row.proconfig, row.proname).toContain(
        "search_path=pg_catalog, public",
      );
      expect(row.public_exec, row.proname).toBe(false);
      expect(row.app_exec, row.proname).toBe(true);
    }
  });

  it("refuses the secret-less membership lookup to the runtime role", async () => {
    await expect(
      db.appSql`SELECT * FROM librehr_auth_membership(${user}::uuid)`,
    ).rejects.toThrow(/permission denied/i);
    const [row] = await db.adminSql<
      { app_exec: boolean; prosecdef: boolean }[]
    >`
      SELECT has_function_privilege('librehr_app', p.oid, 'EXECUTE') AS app_exec,
             p.prosecdef
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'librehr_auth_membership'
    `;
    expect(row).toEqual({ app_exec: false, prosecdef: true });
  });

  // 00-roles.sh drops BYPASSRLS from the owner: migrations (above) and the dev
  // seed must work without it.
  it("seeds the dev dataset as the owner without BYPASSRLS", async () => {
    await seedDevDatabase(db.ownerConnectionString);
    const [row] = await db.adminSql<
      { n: number }[]
    >`SELECT count(*)::int AS n FROM employees`;
    expect(row?.n).toBeGreaterThan(1);
  }, 60000);
});
