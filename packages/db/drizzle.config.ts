import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url:
      process.env["DATABASE_MIGRATION_URL"] ||
      "postgres://openhr_owner:openhr_dev_password@localhost:5432/openhr",
  },
});
