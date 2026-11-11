import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getTestDatabase, type TestDatabase } from "@librehr/testing";
import { runMigrations } from "../src/migrate.js";
import { seedDevDatabase } from "../seeds/dev.js";

describe("dev seed safety", () => {
  let db: TestDatabase;

  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database) throw new Error("Docker is required for seed tests");
    db = database;
    await runMigrations(db.connectionString);
  }, 60000);

  afterAll(async () => {
    if (db) await db.close();
  });

  it("refuses to run when NODE_ENV is production", async () => {
    await expect(
      seedDevDatabase(db.connectionString, { NODE_ENV: "production" }),
    ).rejects.toThrow(/production/);
    const [row] = await db.sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM organizations WHERE slug = 'acme-serveis'
    `;
    expect(row?.n).toBe(0);
  });

  it("does not overwrite the password of an existing account and seeds scrypt PINs", async () => {
    const existingHash = "scrypt$existing-account-hash-must-survive";
    await db.sql`
      INSERT INTO users (email, name, password_hash)
      VALUES ('admin@librehr.local', 'Real Admin', ${existingHash})
    `;

    await seedDevDatabase(db.connectionString, { NODE_ENV: "development" });

    const [user] = await db.sql<{ passwordHash: string; name: string }[]>`
      SELECT password_hash as "passwordHash", name FROM users WHERE email = 'admin@librehr.local'
    `;
    expect(user).toEqual({ passwordHash: existingHash, name: "Real Admin" });

    const pins = await db.sql<
      { pinHash: string; pinSalt: string | null; badgeId: string }[]
    >`
      SELECT pin_hash as "pinHash", pin_salt as "pinSalt", badge_id as "badgeId"
      FROM employees WHERE pin_hash IS NOT NULL
    `;
    expect(pins.length).toBeGreaterThan(1);
    for (const pin of pins) {
      expect(pin.pinHash).toMatch(/^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
      expect(pin.pinSalt).toBeNull();
    }
    const salts = new Set(pins.map((p) => p.pinHash.split("$")[1]));
    expect(salts.size).toBe(pins.length);
    expect(new Set(pins.map((p) => p.badgeId)).size).toBe(pins.length);
  }, 60000);
});
