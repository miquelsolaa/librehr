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
import { SchedulerRepository } from "../src/repositories/scheduler.repository.js";

const MIGRATION_0035 = fs.readFileSync(
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../migrations/0035_scheduler_org_list.sql",
  ),
  "utf-8",
);

// Issue #115: the scheduler's cross-tenant organization list (migration 0035)
// returns ids and zones only, to the worker's role only, and opens no other
// path around RLS.
describe("scheduler organization list (0035)", () => {
  let base: TestDatabase;
  let db: RoleSeparatedDatabase;
  let owner: Sql;
  const orgA = "a1150000-0000-4000-8000-00000000000a";
  const orgB = "b1150000-0000-4000-8000-00000000000b";

  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database) throw new Error("Docker is required for role tests");
    base = database;
    db = await createRoleSeparatedDatabase(base);
    await runMigrations(db.ownerConnectionString);
    owner = postgres(db.ownerConnectionString, { max: 2, onnotice: () => {} });

    await db.adminSql`INSERT INTO organizations (id, name, slug, timezone) VALUES
      (${orgA}, 'Scheduler A', 'scheduler-a', 'Europe/Madrid'),
      (${orgB}, 'Scheduler B', 'scheduler-b', 'Atlantic/Canary')`;
    for (const org of [orgA, orgB]) {
      await withTenant(db.adminSql, { organizationId: org }, async (tx) => {
        await tx`INSERT INTO employees (organization_id, first_name, last_name, email)
          VALUES (${org}, 'Sched', 'Uler', ${`${org}@example.invalid`})`;
      });
    }
  }, 60000);

  afterAll(async () => {
    if (owner) await owner.end();
    if (db) await db.close();
    if (base) await base.close();
  });

  it("returns every organization's id and time zone, and no other column, to the owner", async () => {
    const rows = await owner<Record<string, unknown>[]>`
      SELECT * FROM librehr_scheduler_organizations()`;
    expect(rows).toEqual([
      { organization_id: orgA, timezone: "Europe/Madrid" },
      { organization_id: orgB, timezone: "Atlantic/Canary" },
    ]);

    const [signature] = await db.adminSql<{ result: string }[]>`
      SELECT pg_get_function_result(p.oid) AS result
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'librehr_scheduler_organizations'`;
    expect(signature?.result).toBe(
      "TABLE(organization_id uuid, timezone text)",
    );
  });

  it("is a hardened SECURITY DEFINER owned by librehr_owner, not executable by PUBLIC or librehr_app", async () => {
    const [row] = await db.adminSql<
      {
        prosecdef: boolean;
        proconfig: string[] | null;
        owner: string;
        public_exec: boolean;
        app_exec: boolean;
        owner_exec: boolean;
      }[]
    >`
      SELECT p.prosecdef, p.proconfig, pg_get_userbyid(p.proowner) AS owner,
             has_function_privilege('public', p.oid, 'EXECUTE') AS public_exec,
             has_function_privilege('librehr_app', p.oid, 'EXECUTE') AS app_exec,
             has_function_privilege('librehr_owner', p.oid, 'EXECUTE') AS owner_exec
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'librehr_scheduler_organizations'`;
    expect(row).toEqual({
      prosecdef: true,
      proconfig: ["search_path=pg_catalog, public"],
      owner: "librehr_owner",
      public_exec: false,
      app_exec: false,
      owner_exec: true,
    });

    await expect(
      db.appSql`SELECT * FROM librehr_scheduler_organizations()`,
    ).rejects.toThrow(/permission denied/i);
  });

  it("leaves tenant rows hidden from the runtime role and the owner without a tenant context", async () => {
    const [app] = await db.appSql<
      { n: number }[]
    >`SELECT count(*)::int AS n FROM employees`;
    expect(app?.n).toBe(0);
    const [own] = await owner<
      { n: number }[]
    >`SELECT count(*)::int AS n FROM employees`;
    expect(own?.n).toBe(0);

    // With one tenant's context, the other tenant's rows stay invisible.
    const visible = await withTenant(
      db.appSql,
      { organizationId: orgA },
      (tx) => tx<{ organization_id: string }[]>`
        SELECT organization_id FROM employees`,
    );
    expect(visible).toEqual([{ organization_id: orgA }]);

    const [role] = await owner<
      { rolbypassrls: boolean; rolsuper: boolean }[]
    >`SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user`;
    expect(role).toEqual({ rolbypassrls: false, rolsuper: false });
  });

  it("is read by SchedulerRepository as ids and zones", async () => {
    const repo = new SchedulerRepository();
    expect(await repo.listOrganizations(owner)).toEqual([
      { organizationId: orgA, timeZone: "Europe/Madrid" },
      { organizationId: orgB, timeZone: "Atlantic/Canary" },
    ]);
  });

  it("lists only the tenant's own location zones", async () => {
    await withTenant(db.adminSql, { organizationId: orgB }, async (tx) => {
      await tx`INSERT INTO locations (organization_id, name, city, timezone)
        VALUES (${orgB}, 'Las Palmas', 'Las Palmas', 'Atlantic/Canary')`;
    });
    const repo = new SchedulerRepository();
    const zonesA = await withTenant(owner, { organizationId: orgA }, (tx) =>
      repo.listLocationTimeZones(tx),
    );
    const zonesB = await withTenant(owner, { organizationId: orgB }, (tx) =>
      repo.listLocationTimeZones(tx),
    );
    expect(zonesA).toEqual([]);
    expect(zonesB).toEqual(["Atlantic/Canary"]);
  });

  it("hands the function to librehr_owner when the migration runs as the bootstrap superuser", async () => {
    const [{ bootstrap } = { bootstrap: "" }] = await db.adminSql<
      { bootstrap: string }[]
    >`SELECT current_user AS bootstrap`;
    await db.adminSql.unsafe(
      `ALTER FUNCTION public.librehr_scheduler_organizations() OWNER TO "${bootstrap}"`,
    );

    await db.adminSql.unsafe(MIGRATION_0035);

    const [row] = await db.adminSql<
      { owner: string; owner_exec: boolean; app_exec: boolean }[]
    >`
      SELECT pg_get_userbyid(p.proowner) AS owner,
             has_function_privilege('librehr_owner', p.oid, 'EXECUTE') AS owner_exec,
             has_function_privilege('librehr_app', p.oid, 'EXECUTE') AS app_exec
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'librehr_scheduler_organizations'`;
    expect(row).toEqual({
      owner: "librehr_owner",
      owner_exec: true,
      app_exec: false,
    });
    expect(
      await owner`SELECT * FROM librehr_scheduler_organizations()`,
    ).toHaveLength(2);
  });
});
