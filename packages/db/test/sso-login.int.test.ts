import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  APP_ROLE,
  createRoleSeparatedDatabase,
  getTestDatabase,
  type RoleSeparatedDatabase,
  type TestDatabase,
} from "@librehr/testing";
import { runMigrations } from "../src/migrate.js";
import { withTenant } from "../src/with-tenant.js";
import { hashBearerToken } from "../src/crypto/token-hash.js";
import {
  IdentityRepository,
  type SsoLoginRequestInput,
} from "../src/repositories/identity.repository.js";

// AUTH-004 (issue #34): single-use SSO login requests and identity links
// (migration 0044), exercised as the restricted runtime role.
describe("SSO login requests and identity links (0044)", () => {
  let base: TestDatabase;
  let db: RoleSeparatedDatabase;
  const repo = new IdentityRepository();
  const issuer = "https://idp.example.invalid/realms/a";

  const orgA = "a4400000-0000-0000-0000-00000000000a";
  const orgB = "b4400000-0000-0000-0000-00000000000b";
  const configA = "a4400000-0000-0000-0000-0000000000c1";
  const configB = "b4400000-0000-0000-0000-0000000000c2";
  const ana = "a4400000-0000-0000-0000-000000000001"; // member of A
  const bea = "a4400000-0000-0000-0000-000000000002"; // member of A
  const leaver = "a4400000-0000-0000-0000-000000000003"; // terminated in A
  const bob = "b4400000-0000-0000-0000-000000000004"; // member of B only
  const carl = "a4400000-0000-0000-0000-000000000005"; // member of A and B
  const dan = "a4400000-0000-0000-0000-000000000006"; // member of A, later B

  const newState = () => crypto.randomBytes(32).toString("base64url");

  async function begin(
    overrides: Partial<SsoLoginRequestInput> = {},
  ): Promise<string> {
    const state = newState();
    await repo.ssoBeginLogin(db.appSql, {
      state,
      organizationId: orgA,
      ssoConfigurationId: configA,
      issuerUrl: issuer,
      clientId: "client-a",
      nonce: "nonce-value",
      codeVerifier: "verifier-value",
      locale: "es",
      ...overrides,
    });
    return state;
  }

  /** Begins and consumes a request, then resolves the identity. */
  async function signIn(subject: string, email: string, iss = issuer) {
    const state = await begin();
    expect((await repo.ssoConsume(db.appSql, state)).outcome).toBe("ok");
    return repo.ssoResolveUser(db.appSql, {
      state,
      issuer: iss,
      subject,
      email,
    });
  }

  const links = (org: string) =>
    withTenant(
      db.appSql,
      { organizationId: org },
      (tx) =>
        tx<{ userId: string; subject: string }[]>`
        SELECT user_id AS "userId", subject FROM sso_identities
        ORDER BY created_at`,
    );

  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database) throw new Error("Docker is required for role tests");
    base = database;
    db = await createRoleSeparatedDatabase(base);
    await runMigrations(db.ownerConnectionString);

    const admin = db.adminSql;
    await admin`INSERT INTO organizations (id, name, slug) VALUES
      (${orgA}, 'A', 'sso-a'), (${orgB}, 'B', 'sso-b')`;
    await admin`INSERT INTO users (id, email, name) VALUES
      (${ana}, 'ana@example.com', 'Ana'),
      (${bea}, 'Bea@Example.com', 'Bea'),
      (${leaver}, 'leaver@example.com', 'Leaver'),
      (${bob}, 'bob@example.com', 'Bob'),
      (${carl}, 'carl@example.com', 'Carl'),
      (${dan}, 'dan@example.com', 'Dan')`;
    await admin`INSERT INTO memberships (organization_id, user_id) VALUES
      (${orgA}, ${ana}), (${orgA}, ${bea}), (${orgA}, ${leaver}),
      (${orgB}, ${bob}), (${orgA}, ${carl}), (${orgB}, ${carl}),
      (${orgA}, ${dan})`;
    await admin`INSERT INTO employees
      (organization_id, user_id, first_name, last_name, email, status, termination_date)
      VALUES (${orgA}, ${leaver}, 'Lea', 'Ver', 'leaver@example.com',
              'terminated', '2020-01-31')`;
    await admin`INSERT INTO sso_configurations
      (id, organization_id, provider, client_id, client_secret, issuer_url, allowed_domains)
      VALUES
      (${configA}, ${orgA}, 'generic_oidc', 'client-a', 'secret-a', ${issuer},
       ${admin.json(["@Example.com"])}),
      (${configB}, ${orgB}, 'generic_oidc', 'client-b', 'secret-b', ${issuer},
       ${admin.json(["example.com"])})`;
  }, 60000);

  afterAll(async () => {
    if (db) await db.close();
    if (base) await base.close();
  });

  it("grants the runtime role only what the flow needs", async () => {
    const [grants] = await db.adminSql<Record<string, boolean>[]>`
      SELECT
        has_table_privilege(${APP_ROLE}, 'sso_login_requests', 'INSERT') AS req_insert,
        has_table_privilege(${APP_ROLE}, 'sso_login_requests', 'UPDATE') AS req_update,
        has_table_privilege(${APP_ROLE}, 'sso_identities', 'SELECT') AS id_select,
        has_table_privilege(${APP_ROLE}, 'sso_identities', 'INSERT') AS id_insert,
        has_table_privilege(${APP_ROLE}, 'sso_identities', 'UPDATE') AS id_update,
        has_function_privilege(${APP_ROLE}, 'librehr_auth_sso_consume(text)', 'EXECUTE') AS consume,
        has_function_privilege(${APP_ROLE},
          'librehr_auth_sso_resolve_user(text, text, text, text)', 'EXECUTE') AS resolve,
        has_function_privilege(${APP_ROLE},
          'librehr_auth_sso_domain_taken(text)', 'EXECUTE') AS domains_taken,
        has_function_privilege(${APP_ROLE},
          'librehr_auth_sso_other_org_member(uuid, uuid)', 'EXECUTE') AS other_org,
        has_function_privilege('public', 'librehr_auth_sso_consume(text)', 'EXECUTE') AS public_consume`;
    expect(grants).toEqual({
      req_insert: true,
      req_update: false,
      id_select: true,
      id_insert: false,
      id_update: false,
      consume: true,
      resolve: true,
      domains_taken: true,
      other_org: false,
      public_consume: false,
    });
    const [rls] = await db.adminSql<{ rls: boolean; force: boolean }[]>`
      SELECT relrowsecurity AS rls, relforcerowsecurity AS force
      FROM pg_class WHERE relname = 'sso_identities'`;
    expect(rls).toEqual({ rls: true, force: true });
  });

  it("stores only the state hash and consumes a request once", async () => {
    const state = await begin();
    const stored = await db.adminSql<{ locale: string; ttl: number }[]>`
      SELECT locale,
             extract(epoch FROM expires_at - created_at)::int AS ttl
      FROM sso_login_requests WHERE state_hash = ${hashBearerToken(state)}`;
    expect(stored).toEqual([{ locale: "es", ttl: 600 }]);
    const raw = await db.adminSql`
      SELECT 1 FROM sso_login_requests WHERE state_hash = ${state}`;
    expect(raw).toHaveLength(0);

    expect(await repo.ssoConsume(db.appSql, state)).toEqual({
      outcome: "ok",
      organizationId: orgA,
      ssoConfigurationId: configA,
      provider: "generic_oidc",
      issuerUrl: issuer,
      clientId: "client-a",
      clientSecret: "secret-a",
      allowedDomains: ["@Example.com"],
      nonce: "nonce-value",
      codeVerifier: "verifier-value",
      locale: "es",
    });
    expect(await repo.ssoConsume(db.appSql, state)).toEqual({
      outcome: "invalid",
    });
    expect(await repo.ssoConsume(db.appSql, newState())).toEqual({
      outcome: "invalid",
    });
  });

  it("lets only one of two concurrent callbacks consume a request", async () => {
    const state = await begin();
    const results = await Promise.all([
      repo.ssoConsume(db.appSql, state),
      repo.ssoConsume(db.appSql, state),
    ]);
    expect(results.map((r) => r.outcome).sort()).toEqual(["invalid", "ok"]);
  });

  it("refuses a consumed request to be reopened by the runtime role", async () => {
    const state = await begin();
    await repo.ssoConsume(db.appSql, state);
    await expect(
      db.appSql`UPDATE sso_login_requests SET consumed_at = NULL
                WHERE state_hash = ${hashBearerToken(state)}`,
    ).rejects.toThrow(/permission denied/);
  });

  it("answers expired after the request's lifetime, still spending it", async () => {
    const state = await begin();
    await db.adminSql`
      UPDATE sso_login_requests SET expires_at = now() - interval '1 second'
      WHERE state_hash = ${hashBearerToken(state)}`;
    expect(await repo.ssoConsume(db.appSql, state)).toEqual({
      outcome: "expired",
      organizationId: orgA,
      locale: "es",
    });
    expect((await repo.ssoConsume(db.appSql, state)).outcome).toBe("invalid");
  });

  it("answers unavailable when the configuration changed or was disabled", async () => {
    const changed = await begin({ clientId: "old-client" });
    expect(await repo.ssoConsume(db.appSql, changed)).toEqual({
      outcome: "unavailable",
      organizationId: orgA,
      locale: "es",
    });

    const disabled = await begin();
    await db.adminSql`UPDATE sso_configurations SET enabled = false WHERE id = ${configA}`;
    try {
      expect((await repo.ssoConsume(db.appSql, disabled)).outcome).toBe(
        "unavailable",
      );
    } finally {
      await db.adminSql`UPDATE sso_configurations SET enabled = true WHERE id = ${configA}`;
    }
  });

  it("purges requests older than one day when a new sign-in starts", async () => {
    const old = await begin();
    await db.adminSql`
      UPDATE sso_login_requests SET created_at = now() - interval '25 hours'
      WHERE state_hash = ${hashBearerToken(old)}`;
    await begin();
    const rows = await db.adminSql`
      SELECT 1 FROM sso_login_requests WHERE state_hash = ${hashBearerToken(old)}`;
    expect(rows).toHaveLength(0);
  });

  it("links a member by verified email, then matches later sign-ins by subject", async () => {
    expect(await signIn("sub-ana", "ana@example.com")).toEqual({
      outcome: "ok",
      userId: ana,
      organizationId: orgA,
    });
    // Renamed at the provider: the subject still identifies Ana.
    expect(await signIn("sub-ana", "ana.renamed@EXAMPLE.com")).toEqual({
      outcome: "ok",
      userId: ana,
      organizationId: orgA,
    });
    expect(await links(orgA)).toEqual([{ userId: ana, subject: "sub-ana" }]);
  });

  it("matches an email case-insensitively when it is unambiguous", async () => {
    expect(await signIn("sub-bea", "bea@example.com")).toMatchObject({
      outcome: "ok",
      userId: bea,
    });
  });

  it("refuses a second subject for a linked member and a reassigned email", async () => {
    // Ana is linked to sub-ana; another account at the provider now carries
    // her email (reassigned): it must not take over her account.
    expect(await signIn("sub-impostor", "ana@example.com")).toEqual({
      outcome: "identity_conflict",
      organizationId: orgA,
    });
    expect(await links(orgA)).not.toContainEqual(
      expect.objectContaining({ subject: "sub-impostor" }),
    );
  });

  it("refuses domains outside the allow-list, including look-alikes", async () => {
    for (const email of [
      "ana@evil.test",
      "ana@notexample.com",
      "ana@example.com.evil.test",
      "ana@sub.example.com",
    ]) {
      expect(await signIn(`sub-${email}`, email)).toEqual({
        outcome: "domain_not_allowed",
        organizationId: orgA,
      });
    }
  });

  it("answers no_account for unknown, terminated and other-tenant users", async () => {
    for (const email of [
      "nobody@example.com",
      "leaver@example.com",
      // Bob is a member of organization B only: never signed into A.
      "bob@example.com",
    ]) {
      expect(await signIn(`sub-${email}`, email)).toEqual({
        outcome: "no_account",
        organizationId: orgA,
      });
    }
    expect(
      (await links(orgA)).map((l) => l.subject).filter((s) => s.includes("@")),
    ).toEqual([]);
  });

  it("refuses a wrong issuer, an empty subject or a malformed email", async () => {
    expect(
      await signIn("sub-x", "ana@example.com", "https://other.invalid"),
    ).toEqual({ outcome: "invalid", organizationId: null });
    expect(await signIn("", "ana@example.com")).toMatchObject({
      outcome: "invalid",
    });
    expect(await signIn("sub-x", "not-an-email")).toMatchObject({
      outcome: "invalid",
    });
  });

  it("resolves a request once, and only after it was consumed", async () => {
    const unconsumed = await begin();
    const input = {
      issuer,
      subject: "sub-ana",
      email: "ana@example.com",
    };
    expect(
      await repo.ssoResolveUser(db.appSql, { state: unconsumed, ...input }),
    ).toEqual({ outcome: "expired", organizationId: null });

    const state = await begin();
    await repo.ssoConsume(db.appSql, state);
    expect(
      (await repo.ssoResolveUser(db.appSql, { state, ...input })).outcome,
    ).toBe("ok");
    expect(await repo.ssoResolveUser(db.appSql, { state, ...input })).toEqual({
      outcome: "expired",
      organizationId: null,
    });
  });

  it("keeps identity links isolated per organization", async () => {
    await withTenant(db.appSql, { organizationId: orgB }, async (tx) => {
      expect(await tx`SELECT 1 FROM sso_identities`).toHaveLength(0);
    });
    expect(await db.appSql`SELECT 1 FROM sso_identities`).toHaveLength(0);
    await expect(
      withTenant(
        db.appSql,
        { organizationId: orgA },
        (tx) =>
          tx`INSERT INTO sso_identities (user_id, issuer, subject)
           VALUES (${bea}, ${issuer}, 'forged')`,
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("removes the link with the membership", async () => {
    expect((await signIn("sub-bea", "bea@example.com")).outcome).toBe("ok");
    await db.adminSql`
      DELETE FROM memberships WHERE organization_id = ${orgA} AND user_id = ${bea}`;
    expect(await links(orgA)).not.toContainEqual(
      expect.objectContaining({ userId: bea }),
    );
  });
  // A person's password and second factors are global: the provider of one
  // organization must never act for someone who also belongs to another.
  it("refuses a person who is also an active member of another organization", async () => {
    expect(await signIn("sub-carl", "carl@example.com")).toEqual({
      outcome: "multi_org_account",
      organizationId: orgA,
    });
    expect(await links(orgA)).not.toContainEqual(
      expect.objectContaining({ userId: carl }),
    );
  });

  it("refuses a linked member once they join another organization", async () => {
    expect((await signIn("sub-dan", "dan@example.com")).outcome).toBe("ok");
    await db.adminSql`
      INSERT INTO memberships (organization_id, user_id) VALUES (${orgB}, ${dan})`;
    expect(await signIn("sub-dan", "dan@example.com")).toEqual({
      outcome: "multi_org_account",
      organizationId: orgA,
    });

    // A membership that no longer grants access (EMP-007) does not count.
    await db.adminSql`INSERT INTO employees
      (organization_id, user_id, first_name, last_name, email, status, termination_date)
      VALUES (${orgB}, ${dan}, 'Dan', 'B', 'dan@example.com',
              'terminated', '2020-01-31')`;
    expect(await signIn("sub-dan", "dan@example.com")).toMatchObject({
      outcome: "ok",
      userId: dan,
    });
  });

  it("reports the domains another organization's enabled configuration claims", async () => {
    const taken = (org: string, domains: string[]) =>
      withTenant(db.appSql, { organizationId: org }, (tx) =>
        repo.ssoDomainsTaken(tx, domains),
      );
    // B's configuration also lists example.com (created later, so lookups by
    // domain keep resolving to A, the oldest).
    expect(await taken(orgB, [" @EXAMPLE.com ", "b-only.example"])).toEqual([
      "example.com",
    ]);
    expect(await taken(orgA, ["example.com"])).toEqual(["example.com"]);
    expect(await taken(orgA, [])).toEqual([]);
    expect(
      (await repo.ssoConfigForDomain(db.appSql, "example.com"))?.organizationId,
    ).toBe(orgA);
    // Only for the signed-in tenant: no context, no answer.
    await expect(
      db.appSql`SELECT librehr_auth_sso_domain_taken('example.com')`,
    ).rejects.toThrow(/tenant context/);

    // A disabled configuration claims nothing.
    await db.adminSql`UPDATE sso_configurations SET enabled = false WHERE id = ${configB}`;
    try {
      expect(await taken(orgA, ["example.com"])).toEqual([]);
    } finally {
      await db.adminSql`UPDATE sso_configurations SET enabled = true WHERE id = ${configB}`;
    }
  });
});
