import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getTestDatabase, type TestDatabase } from "@librehr/testing";

describe("legacy password cleanup migration", () => {
  let db: TestDatabase;
  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database) throw new Error("Docker is required for migration tests");
    db = database;
  }, 30000);
  afterAll(async () => {
    if (db) await db.close();
  });
  it("removes plaintext and unsupported values while retaining valid scrypt hashes", async () => {
    const migration = await readFile(
      new URL(
        "../../../packages/db/migrations/0017_password_sanitize.sql",
        import.meta.url,
      ),
      "utf8",
    );
    await db.sql.begin(async (tx) => {
      // The id only gives the assertion a stable order: the migration UPDATEs
      // rows, which moves them in the heap, so an unordered SELECT is not
      // guaranteed to return insertion order.
      await tx`CREATE TEMP TABLE users (id serial, password_hash text) ON COMMIT DROP`;
      const hash = `scrypt$${"a".repeat(32)}$${"b".repeat(128)}`;
      await tx`INSERT INTO users (password_hash) VALUES ('legacy-password'), ('unsupported$hash'), (${hash}), (NULL)`;
      await tx.unsafe(migration);
      const result = await tx<
        { password_hash: string | null }[]
      >`SELECT password_hash FROM users ORDER BY id`;
      expect(result.map((row) => row.password_hash)).toEqual([
        null,
        null,
        hash,
        null,
      ]);
    });
  });
});
