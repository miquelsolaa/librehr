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
import { hashBearerToken } from "../src/crypto/token-hash.js";
import { IdentityRepository } from "../src/repositories/identity.repository.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_0029 = fs.readFileSync(
  path.resolve(__dirname, "../migrations/0029_auditor_access_expiry.sql"),
  "utf-8",
);

// TIM-008: auditor memberships carry an access end date; the membership
// lookup behind sessions, tokens and sign-in refuses them once it has passed.
describe("auditor access expiry (0029)", () => {
  let base: TestDatabase;
  let db: RoleSeparatedDatabase;
  let owner: Sql;
  const identity = new IdentityRepository();
  const org = "a2900000-0000-0000-0000-00000000000a";
  const auditor = "c2900000-0000-0000-0000-000000000001";
  const employee = "c2900000-0000-0000-0000-000000000002";
  const legacyAuditor = "c2900000-0000-0000-0000-000000000003";
  const datedAuditor = "c2900000-0000-0000-0000-000000000004";

  const sessionFor = async (userId: string): Promise<string> => {
    const token = crypto.randomBytes(32).toString("hex");
    await db.adminSql`INSERT INTO sessions (user_id, token, expires_at, organization_id)
      VALUES (${userId}, ${hashBearerToken(token)}, now() + interval '1 hour', ${org})`;
    return token;
  };
  const setExpiry = (userId: string, interval: string | null) =>
    interval === null
      ? db.adminSql`UPDATE memberships SET access_expires_at = NULL WHERE user_id = ${userId}`
      : db.adminSql`UPDATE memberships SET access_expires_at = now() + ${interval}::interval
          WHERE user_id = ${userId}`;
  const expiryOf = async (userId: string) => {
    const [row] = await db.adminSql<{ at: Date | null }[]>`
      SELECT access_expires_at AS at FROM memberships WHERE user_id = ${userId}`;
    return row?.at ?? null;
  };

  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database) throw new Error("Docker is required for role tests");
    base = database;
    db = await createRoleSeparatedDatabase(base);
    await runMigrations(db.ownerConnectionString);
    owner = postgres(db.ownerConnectionString, { max: 1, onnotice: () => {} });

    await db.adminSql`INSERT INTO organizations (id, name, slug) VALUES (${org}, 'Expiry Org', 'auditor-expiry')`;
    for (const id of [auditor, employee, legacyAuditor, datedAuditor]) {
      await db.adminSql`INSERT INTO users (id, email, name)
        VALUES (${id}, ${`${id.slice(-1)}-expiry@example.invalid`}, 'Expiry')`;
    }
    await db.adminSql`INSERT INTO memberships (organization_id, user_id, role, access_expires_at) VALUES
      (${org}, ${auditor}, 'auditor', now() + interval '1 day'),
      (${org}, ${employee}, 'employee', NULL),
      (${org}, ${legacyAuditor}, 'auditor', now() + interval '2 days'),
      (${org}, ${datedAuditor}, 'auditor', now() + interval '5 days')`;
  }, 60000);

  afterAll(async () => {
    if (owner) await owner.end();
    if (db) await db.close();
    if (base) await base.close();
  });

  it("adds the organization maximum with a default of 90 days, bounded 1..366", async () => {
    const [row] = await db.adminSql<{ days: number }[]>`
      SELECT auditor_access_max_days AS days FROM organizations WHERE id = ${org}`;
    expect(row?.days).toBe(90);
    await expect(
      db.adminSql`UPDATE organizations SET auditor_access_max_days = 0 WHERE id = ${org}`,
    ).rejects.toThrow();
    await expect(
      db.adminSql`UPDATE organizations SET auditor_access_max_days = 367 WHERE id = ${org}`,
    ).rejects.toThrow();
  });

  it("resolves a session while the auditor's access lasts and refuses it once it has ended", async () => {
    const token = await sessionFor(auditor);
    expect((await identity.session(db.appSql, token))?.role).toBe("auditor");

    await setExpiry(auditor, "-1 second");
    expect(await identity.session(db.appSql, token)).toBeNull();
    // Session binding at sign-in goes through the same lookup.
    expect(await identity.bindSessionOrganization(db.appSql, token)).toBeNull();

    await setExpiry(auditor, "1 day");
    expect((await identity.session(db.appSql, token))?.role).toBe("auditor");
  });

  it("treats a NULL end date as no end (non-auditor roles)", async () => {
    const token = await sessionFor(employee);
    expect((await identity.session(db.appSql, token))?.role).toBe("employee");
  });

  it("refuses an auditor membership or invitation without an end date", async () => {
    await expect(setExpiry(auditor, null)).rejects.toThrow(
      /memberships_auditor_access_expiry_check/,
    );
    await expect(
      db.adminSql`INSERT INTO invitations (organization_id, email, role, token, expires_at)
        VALUES (${org}, 'no-date@example.invalid', 'auditor', 'no-date-token', now() + interval '1 day')`,
    ).rejects.toThrow(/invitations_auditor_access_expiry_check/);
    // Other roles keep NULL.
    expect(await expiryOf(employee)).toBeNull();
  });

  it("backfills 90 days for pre-existing auditors and their invitations, as the owner role", async () => {
    // Recreate the pre-0029 state: no constraints and auditors without a date.
    await db.adminSql`ALTER TABLE memberships DROP CONSTRAINT memberships_auditor_access_expiry_check`;
    await db.adminSql`ALTER TABLE invitations DROP CONSTRAINT invitations_auditor_access_expiry_check`;
    await setExpiry(legacyAuditor, null);
    await db.adminSql`INSERT INTO invitations (organization_id, email, role, token, expires_at)
      VALUES (${org}, 'legacy-invite@example.invalid', 'auditor', 'legacy-invite-token', now() + interval '1 day')`;
    const before = await expiryOf(datedAuditor);

    // The runner wraps each migration in a transaction; do the same.
    await owner.begin((tx) => tx.unsafe(MIGRATION_0029));

    const [row] = await db.adminSql<{ days: number }[]>`
      SELECT extract(epoch FROM access_expires_at - now()) / 86400 AS days
      FROM memberships WHERE user_id = ${legacyAuditor}`;
    expect(Number(row?.days)).toBeGreaterThan(89.9);
    expect(Number(row?.days)).toBeLessThanOrEqual(90);
    // Auditors that already had a date and other roles are untouched.
    expect(await expiryOf(datedAuditor)).toEqual(before);
    expect(await expiryOf(employee)).toBeNull();
    const [invite] = await db.adminSql<{ set: boolean }[]>`
      SELECT access_expires_at IS NOT NULL AS set FROM invitations
      WHERE email = 'legacy-invite@example.invalid'`;
    expect(invite?.set).toBe(true);
    // The constraints are back.
    await expect(setExpiry(legacyAuditor, null)).rejects.toThrow(
      /memberships_auditor_access_expiry_check/,
    );

    // FORCE ROW LEVEL SECURITY is back on for the owner.
    const [rls] = await db.adminSql<{ forced: boolean }[]>`
      SELECT bool_and(relforcerowsecurity) AS forced FROM pg_class
      WHERE relname IN ('memberships', 'invitations')`;
    expect(rls?.forced).toBe(true);
  });

  it("keeps the membership lookup out of the runtime role's reach", async () => {
    await expect(
      db.appSql`SELECT * FROM librehr_auth_membership(${auditor}::uuid, ${org}::uuid)`,
    ).rejects.toThrow(/permission denied/);
  });
});
