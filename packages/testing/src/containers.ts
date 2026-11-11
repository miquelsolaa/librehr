import crypto from "node:crypto";
import postgres, { type Sql } from "postgres";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";

/** Runtime role the API uses in production (NOSUPERUSER, NOBYPASSRLS). */
export const APP_ROLE = "librehr_app";
/** Schema owner that runs migrations in production (NOSUPERUSER, NOBYPASSRLS). */
export const OWNER_ROLE = "librehr_owner";
// Matches the role created by migration 0015 and the dev compose file.
const APP_ROLE_TEST_PASSWORD = "librehr_dev_password";
const OWNER_ROLE_TEST_PASSWORD = "librehr_test_owner_password";
// The container's bootstrap superuser. Deliberately not librehr_owner, as in
// production (infra/postgres/init/00-roles.sh): migrations must not run as a
// superuser, or they bypass RLS and bind policies to the wrong role.
const BOOTSTRAP_USER = "librehr_bootstrap";
const BOOTSTRAP_PASSWORD = "librehr_test_password";

export interface TestDatabase {
  /** Bootstrap (superuser) pool: seeds fixtures. */
  sql: Sql;
  /**
   * URL to run migrations with. On a production-like layout (the default)
   * this is the NOSUPERUSER NOBYPASSRLS `librehr_owner` role; on a legacy
   * server whose superuser is itself named `librehr_owner` it is that
   * superuser (see `productionLayout`).
   */
  connectionString: string;
  /** Superuser URL behind `sql`. */
  adminConnectionString: string;
  /** true when migrations run as the NOSUPERUSER owner role, as in production. */
  productionLayout: boolean;
  /**
   * Pool connected as `librehr_app`, bound by RLS like the production API.
   * Call it after migrations; the pool is closed by `close()`.
   */
  appSql: () => Promise<Sql>;
  close: () => Promise<void>;
}

/**
 * A database laid out like a production install (see
 * infra/postgres/init/00-roles.sh): owned by a NOSUPERUSER NOBYPASSRLS role that
 * runs migrations, and used at runtime by `librehr_app`.
 */
export interface RoleSeparatedDatabase {
  /** Superuser pool on the new database, for fixtures only. */
  adminSql: Sql;
  /** Owner role URL; pass it to `runMigrations`. */
  ownerConnectionString: string;
  /** Runtime role pool, as used by the API. */
  appSql: Sql;
  close: () => Promise<void>;
}

function withCredentials(
  connectionString: string,
  user: string,
  password: string,
  database?: string,
): string {
  const url = new URL(connectionString);
  url.username = user;
  url.password = password;
  if (database) url.pathname = `/${database}`;
  return url.toString();
}

async function ensureLoginRole(
  sql: Sql,
  role: string,
  password: string,
  resetPassword: boolean,
): Promise<void> {
  // Role names are module constants, never user input.
  await sql.unsafe(`
    DO $$
    BEGIN
      CREATE ROLE ${role} WITH LOGIN PASSWORD '${password}';
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `);
  await sql.unsafe(
    `ALTER ROLE ${role} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS${
      resetPassword ? ` PASSWORD '${password}'` : ""
    }`,
  );
}

/**
 * Hands the database `sql` is connected to over to the owner role, as
 * infra/postgres/init/00-roles.sh does on a fresh install. Idempotent.
 */
async function applyProductionLayout(sql: Sql): Promise<void> {
  await ensureLoginRole(sql, OWNER_ROLE, OWNER_ROLE_TEST_PASSWORD, true);
  await ensureLoginRole(sql, APP_ROLE, APP_ROLE_TEST_PASSWORD, false);
  const [row] = await sql<{ db: string }[]>`SELECT current_database() AS db`;
  const database = row?.db;
  if (!database) throw new Error("could not determine the test database");
  await sql.unsafe(`
    ALTER DATABASE "${database}" OWNER TO ${OWNER_ROLE};
    ALTER SCHEMA public OWNER TO ${OWNER_ROLE};
    REVOKE ALL ON DATABASE "${database}" FROM PUBLIC;
    GRANT CONNECT ON DATABASE "${database}" TO ${APP_ROLE};
    CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
    CREATE EXTENSION IF NOT EXISTS "pgcrypto";
    CREATE EXTENSION IF NOT EXISTS "btree_gist";
  `);
}

/**
 * Whether `sql` is a superuser that is not itself the owner role, i.e. one
 * that can set up the production layout without demoting itself.
 */
async function canApplyProductionLayout(sql: Sql): Promise<boolean> {
  const [row] = await sql<{ user: string; superuser: boolean }[]>`
    SELECT current_user AS user, rolsuper AS superuser
    FROM pg_catalog.pg_roles WHERE rolname = current_user`;
  return !!row && row.superuser && row.user !== OWNER_ROLE;
}

async function buildTestDatabase(
  sql: Sql,
  adminConnectionString: string,
  stop: () => Promise<void>,
): Promise<TestDatabase> {
  const productionLayout = await canApplyProductionLayout(sql);
  if (productionLayout) {
    await applyProductionLayout(sql);
  } else {
    process.stderr.write(
      `Test database: the bootstrap user is not a superuser distinct from ${OWNER_ROLE}; migrations run as the bootstrap user (legacy layout, bypasses RLS).\n`,
    );
  }
  const connectionString = productionLayout
    ? withCredentials(
        adminConnectionString,
        OWNER_ROLE,
        OWNER_ROLE_TEST_PASSWORD,
      )
    : adminConnectionString;

  let app: Sql | null = null;
  return {
    sql,
    connectionString,
    adminConnectionString,
    productionLayout,
    appSql: async () => {
      if (!app) {
        await ensureLoginRole(sql, APP_ROLE, APP_ROLE_TEST_PASSWORD, false);
        app = postgres(
          withCredentials(
            adminConnectionString,
            APP_ROLE,
            APP_ROLE_TEST_PASSWORD,
          ),
          { max: 10, idle_timeout: 5 },
        );
      }
      return app;
    },
    close: async () => {
      if (app) await app.end();
      await sql.end();
      await stop();
    },
  };
}

export async function getTestDatabase(): Promise<TestDatabase | null> {
  // 1. Direct environment variable (e.g. CI service container or local Postgres).
  // It must be a superuser; the production layout is applied when its name
  // differs from librehr_owner.
  const envUrl =
    process.env["DATABASE_TEST_URL"] || process.env["DATABASE_URL"];
  if (envUrl) {
    try {
      const sql = postgres(envUrl, {
        max: 10,
        idle_timeout: 5,
        onnotice: () => {},
      });
      // Verify connectivity
      await sql`SELECT 1`;
      return await buildTestDatabase(sql, envUrl, async () => {});
    } catch {
      // If explicit url fails, fall through to Testcontainers
    }
  }

  // 2. Try Testcontainers (if Docker daemon is running)
  try {
    const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(
      "postgres:17-alpine",
    )
      .withDatabase("librehr_test")
      .withUsername(BOOTSTRAP_USER)
      .withPassword(BOOTSTRAP_PASSWORD)
      .start();

    const connectionString = container.getConnectionUri();
    const sql = postgres(connectionString, {
      max: 10,
      idle_timeout: 5,
      onnotice: () => {},
    });

    return await buildTestDatabase(sql, connectionString, async () => {
      await container.stop();
    });
  } catch (err) {
    process.stderr.write(`Testcontainer startup unavailable: ${String(err)}\n`);
    return null;
  }
}

/**
 * Creates a fresh database on the server behind `base`, owned by a
 * NOSUPERUSER NOBYPASSRLS role, mirroring infra/postgres/init/00-roles.sh.
 * `base` must be a superuser connection; it stays open after `close()`.
 */
export async function createRoleSeparatedDatabase(
  base: TestDatabase,
): Promise<RoleSeparatedDatabase> {
  if (!base.productionLayout) {
    throw new Error(
      `createRoleSeparatedDatabase needs a superuser not named ${OWNER_ROLE} (use Testcontainers or a DATABASE_TEST_URL with another bootstrap user)`,
    );
  }
  await ensureLoginRole(base.sql, OWNER_ROLE, OWNER_ROLE_TEST_PASSWORD, true);
  await ensureLoginRole(base.sql, APP_ROLE, APP_ROLE_TEST_PASSWORD, false);

  const database = `librehr_roles_${crypto.randomBytes(6).toString("hex")}`;
  await base.sql.unsafe(`CREATE DATABASE ${database} OWNER ${OWNER_ROLE}`);

  const adminUrl = new URL(base.adminConnectionString);
  adminUrl.pathname = `/${database}`;
  const adminSql = postgres(adminUrl.toString(), {
    max: 5,
    idle_timeout: 5,
    onnotice: () => {},
  });
  await adminSql.unsafe(`
    ALTER SCHEMA public OWNER TO ${OWNER_ROLE};
    REVOKE ALL ON DATABASE ${database} FROM PUBLIC;
    GRANT CONNECT ON DATABASE ${database} TO ${APP_ROLE};
    CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
    CREATE EXTENSION IF NOT EXISTS "pgcrypto";
    CREATE EXTENSION IF NOT EXISTS "btree_gist";
  `);

  const appSql = postgres(
    withCredentials(
      base.adminConnectionString,
      APP_ROLE,
      APP_ROLE_TEST_PASSWORD,
      database,
    ),
    { max: 10, idle_timeout: 5 },
  );

  return {
    adminSql,
    appSql,
    ownerConnectionString: withCredentials(
      base.adminConnectionString,
      OWNER_ROLE,
      OWNER_ROLE_TEST_PASSWORD,
      database,
    ),
    close: async () => {
      await appSql.end();
      await adminSql.end();
      await base.sql.unsafe(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
    },
  };
}
