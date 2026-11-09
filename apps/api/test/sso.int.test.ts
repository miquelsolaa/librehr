import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createRoleSeparatedDatabase,
  getTestDatabase,
  type RoleSeparatedDatabase,
  type TestDatabase,
} from "@librehr/testing";
import { decryptEnvelope, SsoRepository, withTenant } from "@librehr/db";
import { runMigrations } from "@librehr/db/migrate";
import type { AuthUser, ProblemDetails } from "@librehr/contracts";
import { createApp } from "../src/app.js";
import type { AuthPort, AuthSession } from "../src/ports/auth.js";

class MockAuthPort implements AuthPort {
  private sessions = new Map<string, AuthSession>();
  async verifyCredentials(): Promise<AuthUser | null> {
    return null;
  }
  async createSession(user: AuthUser): Promise<AuthSession> {
    const session = {
      user,
      token: `token_${user.id}`,
      expiresAt: new Date(Date.now() + 3600000),
    };
    this.sessions.set(session.token, session);
    return session;
  }
  async getSession(token: string): Promise<AuthSession | null> {
    return this.sessions.get(token) ?? null;
  }
  async revokeSession(token: string): Promise<void> {
    this.sessions.delete(token);
  }
}

describe("SSO is unavailable unless SSO_ENABLED (AUTH-004)", () => {
  const app = createApp({
    sql: {} as unknown as Sql,
    authPort: new MockAuthPort(),
    config: { nodeEnv: "production" },
  });

  it.each([
    ["GET", "/v1/sso/config"],
    ["POST", "/v1/sso/config"],
    ["POST", "/v1/sso/authorize"],
    ["GET", "/v1/sso/callback"],
  ])("%s %s returns 404", async (method, path) => {
    const res = await app.request(path, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(method === "POST" ? { body: "{}" } : {}),
    });
    expect(res.status).toBe(404);
    expect(((await res.json()) as ProblemDetails).code).toBe("SSO_DISABLED");
  });
});

describe("SSO configuration when enabled (AUTH-004)", () => {
  let base: TestDatabase;
  let db: RoleSeparatedDatabase;
  let app: ReturnType<typeof createApp>;

  const orgId = "e1000000-0000-0000-0000-000000000001";
  const admin: AuthUser = {
    id: "e1000000-0000-0000-0000-0000000000a1",
    email: "sso-admin@example.invalid",
    name: "SSO Admin",
    role: "admin",
    organizationId: orgId,
  };
  const clientSecret = "oidc-client-secret-value-123";
  const authPort = new MockAuthPort();

  const saveConfig = (body: Record<string, unknown>) =>
    app.request("/v1/sso/config", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer token_${admin.id}`,
      },
      body: JSON.stringify({
        provider: "generic_oidc",
        clientId: "librehr-client",
        issuerUrl: "https://idp.example.com/realms/acme",
        enabled: true,
        enforceSso: false,
        allowedDomains: ["acme.example"],
        ...body,
      }),
    });
  const storedSecret = async () => {
    const [row] = await db.adminSql<{ client_secret: string }[]>`
      SELECT client_secret FROM sso_configurations WHERE organization_id = ${orgId}`;
    return row?.client_secret ?? "";
  };

  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database) throw new Error("Docker is required for integration tests");
    base = database;
    db = await createRoleSeparatedDatabase(base);
    await runMigrations(db.ownerConnectionString);
    await db.adminSql`INSERT INTO organizations (id, name, slug)
      VALUES (${orgId}, 'Acme', 'acme-sso')`;
    await db.adminSql`INSERT INTO users (id, email, name)
      VALUES (${admin.id}, ${admin.email}, ${admin.name})`;
    await authPort.createSession(admin);

    app = createApp({
      sql: db.appSql,
      authPort,
      config: {
        nodeEnv: "production",
        ssoEnabled: true,
        publicApiUrl: "https://api.hr.example.com",
      },
    });
  }, 60000);

  afterAll(async () => {
    if (db) await db.close();
    if (base) await base.close();
  });

  it("requires a client secret for the first configuration", async () => {
    const res = await saveConfig({});
    expect(res.status).toBe(400);
  });

  it("stores the client secret envelope-encrypted, never in plaintext", async () => {
    const res = await saveConfig({ clientSecret });
    expect(res.status).toBe(200);
    expect(await res.text()).not.toContain(clientSecret);

    const stored = await storedSecret();
    expect(stored).not.toContain(clientSecret);
    expect(JSON.parse(stored)).toHaveProperty("encryptedDek");
    expect(decryptEnvelope(stored)).toBe(clientSecret);

    const read = await app.request("/v1/sso/config", {
      headers: { Authorization: `Bearer token_${admin.id}` },
    });
    expect(await read.text()).not.toContain("clientSecret");
  });

  it("keeps the stored secret when a save omits it for the same client", async () => {
    const before = await storedSecret();
    const res = await saveConfig({
      allowedDomains: ["acme.example", "b.example"],
    });
    expect(res.status).toBe(200);
    expect(await storedSecret()).toBe(before);
  });

  it.each([
    ["issuer", { issuerUrl: "https://attacker.example/realms/acme" }],
    ["client id", { clientId: "renamed-client" }],
    ["provider", { provider: "google" }],
  ])("requires a new secret when the %s changes (400)", async (_, change) => {
    const before = await storedSecret();
    const res = await saveConfig(change);
    expect(res.status).toBe(400);
    expect(await storedSecret()).toBe(before);
    // Accepted together with a new secret.
    const withSecret = await saveConfig({ ...change, clientSecret });
    expect(withSecret.status).toBe(200);
    // Back to the original client for the following tests.
    expect((await saveConfig({ clientSecret })).status).toBe(200);
  });

  it("re-encrypts a legacy plaintext secret on the next save", async () => {
    await db.adminSql`UPDATE sso_configurations SET client_secret = 'legacy-plain'
      WHERE organization_id = ${orgId}`;
    const legacy = await withTenant(
      db.appSql,
      { organizationId: orgId },
      (tx) => new SsoRepository().getClientSecret(tx),
    );
    expect(legacy).toBe("legacy-plain");

    expect((await saveConfig({})).status).toBe(200);
    const stored = await storedSecret();
    expect(stored).not.toContain("legacy-plain");
    expect(decryptEnvelope(stored)).toBe("legacy-plain");
  });

  it("builds the redirect URI from configuration, not the Host header", async () => {
    const res = await app.request("http://evil.example/v1/sso/authorize", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Host: "evil.example",
        "X-Forwarded-Host": "evil.example",
      },
      body: JSON.stringify({ email: "user@acme.example" }),
    });
    expect(res.status).toBe(200);
    const { authorizationUrl } = (await res.json()) as {
      authorizationUrl: string;
    };
    const redirect = new URL(authorizationUrl).searchParams.get("redirect_uri");
    expect(redirect).toBe("https://api.hr.example.com/v1/sso/callback");
  });
});
