import crypto from "node:crypto";
import postgres, { type Sql } from "postgres";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";

/** Runtime role the API uses in production (NOSUPERUSER, NOBYPASSRLS). */
export const APP_ROLE = "librehr_app";
// Matches the role created by migration 0015 and the dev compose file.
const APP_ROLE_TEST_PASSWORD = "librehr_dev_password";
const OWNER_ROLE = "librehr_test_owner";
const OWNER_ROLE_TEST_PASSWORD = "librehr_test_owner_password";

export interface TestDatabase {
  /** Bootstrap (superuser) pool: runs migrations and seeds fixtures. */
  sql: Sql;
  connectionString: string;
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

function buildTestDatabase(
  sql: Sql,
  connectionString: string,
  stop: () => Promise<void>,
): TestDatabase {
  let app: Sql | null = null;
  return {
    sql,
    connectionString,
    appSql: async () => {
      if (!app) {
        await ensureLoginRole(sql, APP_ROLE, APP_ROLE_TEST_PASSWORD, false);
        app = postgres(
          withCredentials(connectionString, APP_ROLE, APP_ROLE_TEST_PASSWORD),
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
  // 1. Direct environment variable (e.g. CI service container or local Postgres)
  const envUrl =
    process.env["DATABASE_TEST_URL"] || process.env["DATABASE_URL"];
  if (envUrl) {
    try {
      const sql = postgres(envUrl, { max: 10, idle_timeout: 5 });
      // Verify connectivity
      await sql`SELECT 1`;
      return buildTestDatabase(sql, envUrl, async () => {});
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
      .withUsername("librehr_owner")
      .withPassword("librehr_test_password")
      .start();

    const connectionString = container.getConnectionUri();
    const sql = postgres(connectionString, { max: 10, idle_timeout: 5 });

    return buildTestDatabase(sql, connectionString, async () => {
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
  await ensureLoginRole(base.sql, OWNER_ROLE, OWNER_ROLE_TEST_PASSWORD, true);
  await ensureLoginRole(base.sql, APP_ROLE, APP_ROLE_TEST_PASSWORD, false);

  const database = `librehr_roles_${crypto.randomBytes(6).toString("hex")}`;
  await base.sql.unsafe(`CREATE DATABASE ${database} OWNER ${OWNER_ROLE}`);

  const adminUrl = new URL(base.connectionString);
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
      base.connectionString,
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
      base.connectionString,
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
