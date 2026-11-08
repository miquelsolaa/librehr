import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getTestDatabase, type TestDatabase } from "@librehr/testing";
import { runMigrations } from "@librehr/db/migrate";
import { recoverAccount } from "../src/lib/recover-account.js";
import { verifyPassword } from "../src/lib/password.js";

describe("operator account recovery", () => {
  let db: TestDatabase;
  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database)
      throw new Error("Docker is required for account recovery tests");
    db = database;
    await runMigrations(db.connectionString);
  }, 30000);
  afterAll(async () => {
    if (db) await db.close();
  });

  it("stores a password hash and revokes all sessions only for the recovered account", async () => {
    const users = await db.sql<
      { id: string; email: string }[]
    >`INSERT INTO users (email, name, password_hash) VALUES ('recover@example.invalid', 'Recovery', 'legacy-password'), ('unrelated@example.invalid', 'Other', 'legacy-password') RETURNING id, email`;
    const recovered = users.find(
      (item) => item.email === "recover@example.invalid",
    )!;
    const other = users.find(
      (item) => item.email === "unrelated@example.invalid",
    )!;
    await db.sql`INSERT INTO sessions (user_id, token, expires_at) VALUES (${recovered.id}, 'session-recover', now() + interval '1 day'), (${other.id}, 'session-other', now() + interval '1 day')`;
    expect(
      await recoverAccount(db.sql, recovered.email, "new-password-123"),
    ).toBe(true);
    const records = await db.sql<
      { password_hash: string }[]
    >`SELECT password_hash FROM users WHERE id = ${recovered.id}`;
    expect(records[0]?.password_hash).not.toBe("new-password-123");
    expect(
      await verifyPassword(
        "new-password-123",
        records[0]?.password_hash ?? null,
      ),
    ).toBe(true);
    const sessions = await db.sql<
      { token: string }[]
    >`SELECT token FROM sessions ORDER BY token`;
    expect(sessions.map((session) => session.token)).toEqual(["session-other"]);
  });

  it("does not change anything for a missing account or invalid password", async () => {
    expect(
      await recoverAccount(
        db.sql,
        "missing@example.invalid",
        "new-password-123",
      ),
    ).toBe(false);
    await expect(
      recoverAccount(db.sql, "recover@example.invalid", "short"),
    ).rejects.toThrow();
    const rows = await db.sql<
      { password_hash: string }[]
    >`SELECT password_hash FROM users WHERE email = 'recover@example.invalid'`;
    expect(
      await verifyPassword("new-password-123", rows[0]?.password_hash ?? null),
    ).toBe(true);
  });
});
