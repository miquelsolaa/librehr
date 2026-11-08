import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getTestDatabase, type TestDatabase } from "@librehr/testing";
import { withTenant } from "@librehr/db";
import { runMigrations } from "@librehr/db/migrate";
import { createApp } from "../src/app.js";
import { BetterAuthAdapter } from "../src/adapters/better-auth.js";
import { hashPassword, verifyPassword } from "../src/lib/password.js";

describe("password creation and invitation acceptance", () => {
  let db: TestDatabase;
  let app: ReturnType<typeof createApp>;
  const org = "55100000-0000-0000-0000-000000000001";
  const post = (path: string, body: unknown) =>
    app.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database)
      throw new Error("Docker is required for password integration tests");
    db = database;
    await runMigrations(db.connectionString);
    await db.sql`INSERT INTO organizations (id, name, slug) VALUES (${org}, 'Test Org', 'password-test')`;
    app = createApp({ sql: db.sql, authPort: new BetterAuthAdapter(db.sql) });
  }, 30000);
  afterAll(async () => {
    if (db) await db.close();
  });

  const setup = (email: string, password: string, slug: string) => ({
    orgName: "New Organization",
    orgSlug: slug,
    adminName: "Test Admin",
    adminEmail: email,
    adminPassword: password,
    defaultLocale: "en",
    timezone: "Europe/Madrid",
    legalEntityName: "Legal Entity",
    legalEntityCif: "12345678",
    locationName: "Office",
    locationCity: "Barcelona",
    locationRegion: "Catalonia",
  });
  const invite = async (email: string, token: string) =>
    withTenant(
      db.sql,
      { organizationId: org },
      (tx) =>
        tx`INSERT INTO invitations (email, role, token, expires_at) VALUES (${email}, 'employee', ${token}, now() + interval '1 day')`,
    );

  it("hashes new setup passwords and rejects wrong-password sign in", async () => {
    const email = "setup-new@example.invalid";
    const response = await post(
      "/v1/org/setup-wizard",
      setup(email, "correct-pass-123", "auth-new-setup"),
    );
    expect(response.status).toBe(200);
    const rows = await db.sql<
      { password_hash: string }[]
    >`SELECT password_hash FROM users WHERE email = ${email}`;
    expect(rows[0]?.password_hash).not.toBe("correct-pass-123");
    expect(
      await verifyPassword("correct-pass-123", rows[0]?.password_hash ?? null),
    ).toBe(true);
    expect(
      await new BetterAuthAdapter(db.sql).verifyCredentials(
        email,
        "wrong-password",
      ),
    ).toBeNull();
  });

  it("does not allow setup to claim an existing account without its password", async () => {
    const email = "setup-existing@example.invalid";
    const hash = await hashPassword("owner-password");
    await db.sql`INSERT INTO users (email, name, password_hash) VALUES (${email}, 'Owner', ${hash})`;
    const response = await post(
      "/v1/org/setup-wizard",
      setup(email, "attacker-password", "auth-takeover-setup"),
    );
    expect(response.status).toBe(401);
    const orgs =
      await db.sql`SELECT id FROM organizations WHERE slug = 'auth-takeover-setup'`;
    expect(orgs).toHaveLength(0);
  });

  it("hashes new invitation passwords and verifies them on sign in", async () => {
    const email = "invite-new@example.invalid";
    const token = "invitation-new-password-token";
    await invite(email, token);
    const response = await post("/v1/invitations/accept", {
      token,
      name: "New Employee",
      password: "secure-password",
    });
    expect(response.status).toBe(200);
    const rows = await db.sql<
      { password_hash: string }[]
    >`SELECT password_hash FROM users WHERE email = ${email}`;
    expect(rows[0]?.password_hash).not.toBe("secure-password");
    expect(
      await verifyPassword("secure-password", rows[0]?.password_hash ?? null),
    ).toBe(true);
    expect(
      await new BetterAuthAdapter(db.sql).verifyCredentials(
        email,
        "wrong-password",
      ),
    ).toBeNull();
  });

  it("rejects account takeover without consuming the invitation", async () => {
    const email = "invite-existing@example.invalid";
    const token = "invitation-existing-password-token";
    const hash = await hashPassword("owner-password");
    await db.sql`INSERT INTO users (email, name, password_hash) VALUES (${email}, 'Owner', ${hash})`;
    await invite(email, token);
    const rejected = await post("/v1/invitations/accept", {
      token,
      name: "Attacker",
      password: "attacker-password",
    });
    expect(rejected.status).toBe(401);
    const rows = await withTenant(
      db.sql,
      { organizationId: org },
      (tx) =>
        tx<
          { accepted_at: Date | null }[]
        >`SELECT accepted_at FROM invitations WHERE token = ${token}`,
    );
    expect(rows[0]?.accepted_at).toBeNull();
    const accepted = await post("/v1/invitations/accept", {
      token,
      name: "Owner",
      password: "owner-password",
    });
    expect(accepted.status).toBe(200);
  });

  it("rejects legacy plaintext passwords", async () => {
    const email = "legacy-user@example.invalid";
    const rows = await db.sql<
      { id: string }[]
    >`INSERT INTO users (email, name, password_hash) VALUES (${email}, 'Legacy', 'legacy-plaintext') RETURNING id`;
    await withTenant(
      db.sql,
      { organizationId: org },
      (tx) =>
        tx`INSERT INTO memberships (user_id, role) VALUES (${rows[0]!.id}, 'employee')`,
    );
    expect(
      await new BetterAuthAdapter(db.sql).verifyCredentials(
        email,
        "legacy-plaintext",
      ),
    ).toBeNull();
  });

  it("accepts a single invitation at most once under concurrent requests", async () => {
    const token = "invitation-concurrent-password-token";
    await invite("invite-concurrent@example.invalid", token);
    const payload = {
      token,
      name: "New Employee",
      password: "secure-password",
    };
    const results = await Promise.all([
      post("/v1/invitations/accept", payload),
      post("/v1/invitations/accept", payload),
    ]);
    expect(results.filter((response) => response.status === 200)).toHaveLength(
      1,
    );
  });
});
