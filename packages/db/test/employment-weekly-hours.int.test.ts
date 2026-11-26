import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres, { type Sql } from "postgres";
import {
  createRoleSeparatedDatabase,
  getTestDatabase,
  type RoleSeparatedDatabase,
  type TestDatabase,
} from "@librehr/testing";
import { runMigrations } from "../src/migrate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_0037 = fs.readFileSync(
  path.resolve(
    __dirname,
    "../migrations/0037_employment_weekly_hours_numeric.sql",
  ),
  "utf-8",
);

// LEA-002 (#131): employments.working_hours_per_week from text to
// numeric(5,2), with a 0 < hours <= 40 check.
describe("employments.working_hours_per_week (0037)", () => {
  let base: TestDatabase;
  let db: RoleSeparatedDatabase;
  let owner: Sql;
  let orgId: string;

  const columnType = async () =>
    (
      await db.adminSql<{ t: string }[]>`
        SELECT data_type AS t FROM information_schema.columns
        WHERE table_name = 'employments' AND column_name = 'working_hours_per_week'`
    )[0]?.t;

  /** Puts the column back as releases before 0037 created it. */
  async function revertToText() {
    await db.adminSql.unsafe(`
      ALTER TABLE employments DROP CONSTRAINT IF EXISTS employments_working_hours_range;
      ALTER TABLE employments ALTER COLUMN working_hours_per_week DROP DEFAULT;
      ALTER TABLE employments ALTER COLUMN working_hours_per_week TYPE text
        USING working_hours_per_week::text;
      ALTER TABLE employments ALTER COLUMN working_hours_per_week SET DEFAULT '40.0';
      DELETE FROM employments;`);
  }

  /** Inserts one period per value, one employee each; returns their ids. */
  async function seed(values: string[]): Promise<string[]> {
    const ids: string[] = [];
    for (const value of values) {
      const employeeId = randomUUID();
      await db.adminSql`INSERT INTO employees (id, organization_id, first_name, last_name, email)
        VALUES (${employeeId}, ${orgId}, 'Hours', 'Test', ${`${employeeId}@example.invalid`})`;
      const [row] = await db.adminSql<{ id: string }[]>`
        INSERT INTO employments (organization_id, employee_id, job_title, start_date, working_hours_per_week)
        VALUES (${orgId}, ${employeeId}, 'Role', '2024-01-01', ${value}) RETURNING id`;
      ids.push(row!.id);
    }
    return ids;
  }

  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database) throw new Error("Docker is required for migration tests");
    base = database;
    db = await createRoleSeparatedDatabase(base);
    await runMigrations(db.ownerConnectionString);
    owner = postgres(db.ownerConnectionString, { max: 1, onnotice: () => {} });
    orgId = randomUUID();
    await db.adminSql`INSERT INTO organizations (id, name, slug) VALUES (${orgId}, 'Hours', 'hours-0037')`;
  }, 60000);

  beforeEach(revertToText);

  afterAll(async () => {
    if (owner) await owner.end();
    if (db) await db.close();
    if (base) await base.close();
  });

  it("casts existing text values, decimal commas included, as the owner", async () => {
    const values = ["40.0", "37,5", " 20 ", "12.345", ".5", "40"];
    const ids = await seed(values);

    // The runner wraps each migration in a transaction; do the same.
    await owner.begin((tx) => tx.unsafe(MIGRATION_0037));

    expect(await columnType()).toBe("numeric");
    const rows = await db.adminSql<{ id: string; h: string }[]>`
      SELECT id, working_hours_per_week::text AS h FROM employments`;
    const byId = new Map(rows.map((r) => [r.id, r.h]));
    expect(ids.map((id) => byId.get(id))).toEqual([
      "40.00",
      "37.50",
      "20.00",
      "12.35",
      "0.50",
      "40.00",
    ]);

    // Second run: a no-op.
    await owner.begin((tx) => tx.unsafe(MIGRATION_0037));
    expect(await columnType()).toBe("numeric");

    // FORCE RLS is restored.
    const [forced] = await db.adminSql<{ forced: boolean }[]>`
      SELECT relforcerowsecurity AS forced FROM pg_class WHERE relname = 'employments'`;
    expect(forced?.forced).toBe(true);
  });

  it("enforces the range and the 40 h default afterwards", async () => {
    await owner.begin((tx) => tx.unsafe(MIGRATION_0037));
    await expect(seed(["0"])).rejects.toThrow(
      /employments_working_hours_range/,
    );
    await expect(seed(["40.01"])).rejects.toThrow(
      /employments_working_hours_range/,
    );
    const employeeId = randomUUID();
    await db.adminSql`INSERT INTO employees (id, organization_id, first_name, last_name, email)
      VALUES (${employeeId}, ${orgId}, 'Default', 'Hours', ${`${employeeId}@example.invalid`})`;
    const [row] = await db.adminSql<{ h: string }[]>`
      INSERT INTO employments (organization_id, employee_id, job_title, start_date)
      VALUES (${orgId}, ${employeeId}, 'Role', '2024-01-01')
      RETURNING working_hours_per_week::text AS h`;
    expect(row?.h).toBe("40.00");
  });

  it.each([["unknown"], ["0"], ["45"], ["1.000,5"], [""], ["0.004"]])(
    "aborts on %j without changing anything or naming the row",
    async (bad) => {
      const ids = await seed(["38", bad]);
      const error = await owner
        .begin((tx) => tx.unsafe(MIGRATION_0037))
        .then(
          () => null,
          (e: unknown) => e as { message: string; hint?: string },
        );
      expect(error?.message).toMatch(/^0037: weekly contract hours/);
      // The value may be quoted; no id, name, email or organization.
      for (const secret of [...ids, orgId, "example.invalid", "Test"])
        expect(error?.message).not.toContain(secret);
      // The hint's query lists exactly the bad row.
      const query = /with: (SELECT .*); then/.exec(error?.hint ?? "")?.[1];
      expect(query).toBeDefined();
      const listed = await db.adminSql.unsafe<{ id: string }[]>(query!);
      expect(listed.map((r) => r.id)).toEqual([ids[1]]);
      expect(await columnType()).toBe("text");
      const [forced] = await db.adminSql<{ forced: boolean }[]>`
        SELECT relforcerowsecurity AS forced FROM pg_class WHERE relname = 'employments'`;
      expect(forced?.forced).toBe(true);
    },
  );
});
