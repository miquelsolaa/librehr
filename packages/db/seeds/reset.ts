import postgres from "postgres";
import { runMigrations } from "../src/migrate.js";
import { seedDevDatabase } from "./dev.js";

export async function resetDatabase(connectionUrl?: string): Promise<void> {
  const url =
    connectionUrl ||
    process.env["DATABASE_MIGRATION_URL"] ||
    process.env["DATABASE_URL"] ||
    "postgres://librehr_owner:librehr_dev_password@localhost:5432/librehr";

  const sql = postgres(url, { max: 1 });

  try {
    process.stdout.write("Resetting database schema public...\n");
    await sql.unsafe(
      "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;",
    );
    await sql.end();

    await runMigrations(url);
    await seedDevDatabase(url);
    process.stdout.write("Database reset and re-seeded successfully.\n");
  } catch (err) {
    await sql.end();
    throw err;
  }
}

if (process.argv[1] && process.argv[1].endsWith("reset.ts")) {
  resetDatabase().catch((err) => {
    process.stderr.write(`Reset error: ${String(err)}\n`);
    process.exit(1);
  });
}
