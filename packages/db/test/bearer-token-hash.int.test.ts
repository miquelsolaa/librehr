import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres, { type Sql } from "postgres";
import {
  createRoleSeparatedDatabase,
  getTestDatabase,
  type RoleSeparatedDatabase,
  type TestDatabase,
} from "@librehr/testing";
import { runMigrations } from "../src/migrate.js";
import { withTenant } from "../src/with-tenant.js";
import { hashBearerToken } from "../src/crypto/token-hash.js";
import { IdentityRepository } from "../src/repositories/identity.repository.js";
import { InvitationRepository } from "../src/repositories/invitation.repository.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_0026 = fs.readFileSync(
  path.resolve(__dirname, "../migrations/0026_hash_bearer_tokens.sql"),
  "utf-8",
);

// AUTH-001/AUTH-005: session and invitation tokens are stored as SHA-256 hex.
describe("bearer tokens are stored hashed (0026)", () => {
  let base: TestDatabase;
  let db: RoleSeparatedDatabase;
  let owner: Sql;
  const identity = new IdentityRepository();
  const org = "a2600000-0000-0000-0000-00000000000a";
  const user = "c2600000-0000-0000-0000-00000000000c";

  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database) throw new Error("Docker is required for role tests");
    base = database;
    db = await createRoleSeparatedDatabase(base);
    await runMigrations(db.ownerConnectionString);
    owner = postgres(db.ownerConnectionString, { max: 1, onnotice: () => {} });

    await db.adminSql`INSERT INTO organizations (id, name, slug) VALUES (${org}, 'Hash Org', 'token-hash')`;
    await db.adminSql`INSERT INTO users (id, email, name) VALUES (${user}, 'hash@example.invalid', 'Hash')`;
    await withTenant(db.adminSql, { organizationId: org }, async (tx) => {
      await tx`INSERT INTO memberships (organization_id, user_id) VALUES (${org}, ${user})`;
    });
  }, 60000);

  afterAll(async () => {
    if (owner) await owner.end();
    if (db) await db.close();
    if (base) await base.close();
  });

  it("matches the SQL transform the migration applies", async () => {
    const raw = crypto.randomBytes(32).toString("hex");
    const [row] = await db.adminSql<{ h: string }[]>`
      SELECT encode(sha256(convert_to(${raw}, 'UTF8')), 'hex') AS h`;
    expect(row?.h).toBe(hashBearerToken(raw));
  });

  it("creates invitations with only the hash stored and finds them by the raw token", async () => {
    const created = await withTenant(
      db.adminSql,
      { organizationId: org },
      (tx) =>
        new InvitationRepository().create(tx, {
          email: "invitee-hash@example.invalid",
        }),
    );
    const stored = await withTenant(
      db.adminSql,
      { organizationId: org },
      (tx) =>
        tx<{ token: string }[]>`
          SELECT token FROM invitations WHERE id = ${created.id}`,
    );
    expect(stored[0]?.token).toBe(hashBearerToken(created.token));
    expect(stored[0]?.token).not.toBe(created.token);

    const found = await identity.invitation(db.appSql, created.token);
    expect(found?.id).toBe(created.id);
    // The stored digest is not itself a valid invitation link.
    expect(await identity.invitation(db.appSql, stored[0]!.token)).toBeNull();
  });

  it("rewrites plaintext rows left by older releases, as the owner role", async () => {
    const session = crypto.randomBytes(32).toString("hex");
    const invitation = crypto.randomBytes(32).toString("hex");
    await db.adminSql`INSERT INTO sessions (user_id, token, expires_at, organization_id)
      VALUES (${user}, ${session}, now() + interval '1 hour', ${org})`;
    const invitationId = await withTenant(
      db.adminSql,
      { organizationId: org },
      async (tx) => {
        const [row] = await tx<{ id: string }[]>`
          INSERT INTO invitations (email, role, token, expires_at)
          VALUES ('legacy-invite@example.invalid', 'employee', ${invitation}, now() + interval '1 day')
          RETURNING id`;
        return row!.id;
      },
    );
    // Rows written by this file's earlier tests are already hashed; keep only
    // the plaintext fixtures above so the re-run hashes each row once.
    await db.adminSql`DELETE FROM sessions WHERE token <> ${session}`;
    await withTenant(
      db.adminSql,
      { organizationId: org },
      (tx) => tx`DELETE FROM invitations WHERE id <> ${invitationId}`,
    );

    // The runner wraps each migration in a transaction; do the same.
    await owner.begin((tx) => tx.unsafe(MIGRATION_0026));

    expect((await identity.session(db.appSql, session))?.userId).toBe(user);
    expect((await identity.invitation(db.appSql, invitation))?.id).toBe(
      invitationId,
    );

    // FORCE ROW LEVEL SECURITY is back on for the owner.
    const [rls] = await db.adminSql<{ forced: boolean }[]>`
      SELECT relforcerowsecurity AS forced FROM pg_class WHERE relname = 'invitations'`;
    expect(rls?.forced).toBe(true);
  });
});
