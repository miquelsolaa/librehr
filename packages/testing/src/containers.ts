import postgres, { type Sql } from "postgres";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";

export interface TestDatabase {
  sql: Sql;
  connectionString: string;
  close: () => Promise<void>;
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
      return {
        sql,
        connectionString: envUrl,
        close: async () => {
          await sql.end();
        },
      };
    } catch {
      // If explicit url fails, fall through to Testcontainers
    }
  }

  // 2. Try Testcontainers (if Docker daemon is running)
  try {
    const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(
      "postgres:17-alpine",
    )
      .withDatabase("openhr_test")
      .withUsername("openhr_owner")
      .withPassword("openhr_test_password")
      .start();

    const connectionString = container.getConnectionUri();
    const sql = postgres(connectionString, { max: 10, idle_timeout: 5 });

    return {
      sql,
      connectionString,
      close: async () => {
        await sql.end();
        await container.stop();
      },
    };
  } catch (err) {
    process.stderr.write(`Testcontainer startup unavailable: ${String(err)}\n`);
    return null;
  }
}
