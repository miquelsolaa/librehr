import { describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import { BetterAuthAdapter } from "../src/adapters/better-auth.js";
import { hashPassword, verifyPassword } from "../src/lib/password.js";

describe("password authentication", () => {
  it("uses salted password hashes and verifies the correct password", async () => {
    const hash = await hashPassword("a long test password");
    expect(await hashPassword("a long test password")).not.toBe(hash);
    expect(await verifyPassword("a long test password", hash)).toBe(true);
    expect(await verifyPassword("wrong password", hash)).toBe(false);
    expect(await verifyPassword("a long test password", "scrypt$broken")).toBe(
      false,
    );
  });
  it("rejects a password when the stored value is legacy plaintext", async () => {
    const sql = (async () => [
      {
        id: "user",
        email: "user@example.invalid",
        name: "User",
        role: "admin",
        organization_id: "org",
        two_factor_enabled: false,
        password_hash: "legacy password",
      },
    ]) as unknown as Sql;
    const adapter = new BetterAuthAdapter(sql);
    expect(
      await adapter.verifyCredentials("user@example.invalid", "wrong password"),
    ).toBeNull();
    expect(
      await adapter.verifyCredentials(
        "user@example.invalid",
        "legacy password",
      ),
    ).toBeNull();
  });

  it("requires the correct password for a hashed account", async () => {
    const passwordHash = await hashPassword("a long test password");
    const sql = (async () => [
      {
        id: "user",
        email: "user@example.invalid",
        name: "User",
        role: "admin",
        organization_id: "org",
        two_factor_enabled: false,
        password_hash: passwordHash,
      },
    ]) as unknown as Sql;
    const adapter = new BetterAuthAdapter(sql);
    expect(
      await adapter.verifyCredentials("user@example.invalid", "wrong password"),
    ).toBeNull();
    expect(
      await adapter.verifyCredentials(
        "user@example.invalid",
        "a long test password",
      ),
    ).not.toBeNull();
  });
});
