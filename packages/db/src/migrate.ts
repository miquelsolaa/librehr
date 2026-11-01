import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function runMigrations(connectionUrl?: string): Promise<void> {
  const url =
    connectionUrl ||
    process.env["DATABASE_MIGRATION_URL"] ||
    process.env["DATABASE_URL"] ||
    "postgres://openhr_owner:openhr_dev_password@localhost:5432/openhr";

  const sql = postgres(url, { max: 1 });

  try {
    process.stdout.write("Acquiring migration advisory lock...\n");
    await sql`SELECT pg_advisory_lock(424242)`;

    await sql`
      CREATE TABLE IF NOT EXISTS "openhr_migrations" (
        "name" text PRIMARY KEY,
        "applied_at" timestamptz NOT NULL DEFAULT now()
      )
    `;

    const migrationsDir = path.resolve(__dirname, "../migrations");
    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    for (const file of files) {
      const alreadyApplied = await sql`
        SELECT 1 FROM "openhr_migrations" WHERE "name" = ${file}
      `;

      if (alreadyApplied.length === 0) {
        process.stdout.write(`Applying migration: ${file}...\n`);
        const content = fs.readFileSync(
          path.join(migrationsDir, file),
          "utf-8",
        );
        await sql.begin(async (tx) => {
          await tx.unsafe(content);
          await tx`INSERT INTO "openhr_migrations" ("name") VALUES (${file})`;
        });
        process.stdout.write(`Applied migration: ${file}\n`);
      }
    }

    process.stdout.write("Migrations applied successfully.\n");
  } finally {
    await sql`SELECT pg_advisory_unlock(424242)`.catch(() => {});
    await sql.end();
  }
}

// Run directly when executed via CLI
if (process.argv[1] && process.argv[1].endsWith("migrate.ts")) {
  runMigrations().catch((err) => {
    process.stderr.write(`Migration error: ${String(err)}\n`);
    process.exit(1);
  });
}
