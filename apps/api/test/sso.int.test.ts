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
import {
  businessEdition,
  hasBusinessEdition,
} from "./support/business-edition.js";
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

const SSO_ROUTES = [
  ["GET", "/v1/sso/config"],
  ["POST", "/v1/sso/config"],
  ["POST", "/v1/sso/authorize"],
  ["GET", "/v1/sso/callback"],
] as const;

async function requestSso(
  app: ReturnType<typeof createApp>,
  method: string,
  path: string,
) {
  const res = await app.request(path, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(method === "POST" ? { body: "{}" } : {}),
  });
  return { status: res.status, body: (await res.json()) as ProblemDetails };
}

// Reading the stored configuration stays in Community (LIC-003); see below.
const LICENSED_ONLY_ROUTES = SSO_ROUTES.filter(
  ([method, path]) => !(method === "GET" && path === "/v1/sso/config"),
);

describe("SSO needs a Business licence (LIC-003, AUTH-004)", () => {
  it.each(LICENSED_ONLY_ROUTES)(
    "%s %s returns 403 LICENSE_REQUIRED in Community",
    async (method, path) => {
      const app = createApp({
        sql: {} as unknown as Sql,
        authPort: new MockAuthPort(),
        config: { nodeEnv: "production", ssoEnabled: true },
      });
      const { status, body } = await requestSso(app, method, path);
      expect(status).toBe(403);
      expect(body.code).toBe("LICENSE_REQUIRED");
    },
  );

  it("stays LICENSE_REQUIRED with a licence that does not grant sso", async () => {
    const edition = businessEdition(["something-else"]);
    const app = createApp({
      sql: {} as unknown as Sql,
      authPort: new MockAuthPort(),
      config: { nodeEnv: "production", ssoEnabled: true },
      license: edition.license,
      extensions: edition.extensions,
    });
    const { status, body } = await requestSso(app, "POST", "/v1/sso/config");
    expect(status).toBe(403);
    expect(body.code).toBe("LICENSE_REQUIRED");
  });
});

describe("Stored SSO configuration without a licence (LIC-003)", () => {
  let base: TestDatabase;
  let db: RoleSeparatedDatabase;
  let app: ReturnType<typeof createApp>;

  const orgA = "e2000000-0000-0000-0000-000000000001";
  const orgB = "e2000000-0000-0000-0000-000000000002";
  const user = (n: string, role: AuthUser["role"], org: string): AuthUser => ({
    id: `e2000000-0000-0000-0000-0000000000${n}`,
    email: `stored-${n}@example.invalid`,
    name: `Stored ${n}`,
    role,
    organizationId: org,
  });
  const adminA = user("a1", "admin", orgA);
  const hrA = user("a2", "hr_admin", orgA);
  const employeeA = user("a3", "employee", orgA);
  const adminB = user("b1", "admin", orgB);
  const authPort = new MockAuthPort();

  const call = (method: string, path: string, as?: AuthUser) =>
    app.request(path, {
      method,
      headers: as ? { Authorization: `Bearer token_${as.id}` } : {},
    });
  const storedA = async () => {
    const [row] = await db.adminSql<
      { enabled: boolean; enforce_sso: boolean }[]
    >`SELECT enabled, enforce_sso FROM sso_configurations
      WHERE organization_id = ${orgA}`;
    return row;
  };

  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database) throw new Error("Docker is required for integration tests");
    base = database;
    db = await createRoleSeparatedDatabase(base);
    await runMigrations(db.ownerConnectionString);
    await db.adminSql`INSERT INTO organizations (id, name, slug) VALUES
      (${orgA}, 'Stored A', 'stored-a'), (${orgB}, 'Stored B', 'stored-b')`;
    for (const person of [adminA, hrA, employeeA, adminB]) {
      await db.adminSql`INSERT INTO users (id, email, name)
        VALUES (${person.id}, ${person.email}, ${person.name})`;
      await authPort.createSession(person);
    }
    await db.adminSql`INSERT INTO sso_configurations
      (organization_id, provider, client_id, client_secret, issuer_url,
       enabled, enforce_sso, allowed_domains)
      VALUES (${orgA}, 'generic_oidc', 'client-a', 'stored-secret-value',
       'https://idp.example.invalid', true, true,
       ${db.adminSql.json(["a.example.invalid"])})`;

    // Community: no licence, no extensions.
    app = createApp({
      sql: db.appSql,
      authPort,
      config: { nodeEnv: "production", ssoEnabled: true },
    });
  }, 60000);

  afterAll(async () => {
    if (db) await db.close();
    if (base) await base.close();
  });

  it("asks for authentication", async () => {
    expect((await call("GET", "/v1/sso/config")).status).toBe(401);
    expect((await call("POST", "/v1/sso/config/disable")).status).toBe(401);
  });

  it("forbids employees from reading or disabling it", async () => {
    expect((await call("GET", "/v1/sso/config", employeeA)).status).toBe(403);
    const res = await call("POST", "/v1/sso/config/disable", employeeA);
    expect(res.status).toBe(403);
    expect(((await res.json()) as ProblemDetails).code).toBe("FORBIDDEN");
    // HR may read but only an admin may switch it off.
    expect((await call("POST", "/v1/sso/config/disable", hrA)).status).toBe(
      403,
    );
    expect(await storedA()).toEqual({ enabled: true, enforce_sso: true });
  });

  it("shows the stored configuration to administrators, never the secret", async () => {
    const res = await call("GET", "/v1/sso/config", hrA);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("stored-secret-value");
    expect(JSON.parse(text)).toMatchObject({
      organizationId: orgA,
      clientId: "client-a",
      enabled: true,
      enforceSso: true,
      allowedDomains: ["a.example.invalid"],
    });
  });

  it("never shows or disables another organization's configuration", async () => {
    const read = await call("GET", "/v1/sso/config", adminB);
    expect(read.status).toBe(200);
    expect(await read.json()).toBeNull();

    const disable = await call("POST", "/v1/sso/config/disable", adminB);
    expect(disable.status).toBe(404);
    expect(await storedA()).toEqual({ enabled: true, enforce_sso: true });
  });

  it("still refuses changes without a licence", async () => {
    const res = await app.request("/v1/sso/config", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer token_${adminA.id}`,
      },
      body: "{}",
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as ProblemDetails).code).toBe(
      "LICENSE_REQUIRED",
    );
  });

  it("lets an admin switch it off, and records it", async () => {
    const res = await call("POST", "/v1/sso/config/disable", adminA);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      clientId: "client-a",
      enabled: false,
      enforceSso: false,
    });
    expect(await storedA()).toEqual({ enabled: false, enforce_sso: false });

    const audit = await db.adminSql<{ action: string }[]>`
      SELECT action FROM audit_log
      WHERE organization_id = ${orgA} AND action = 'sso_config.disabled'`;
    expect(audit).toHaveLength(1);
  });
});

describe.skipIf(!hasBusinessEdition)(
  "Licensed SSO is unavailable unless SSO_ENABLED (AUTH-004)",
  () => {
    const edition = businessEdition();
    const app = createApp({
      sql: {} as unknown as Sql,
      authPort: new MockAuthPort(),
      config: { nodeEnv: "production" },
      license: edition.license,
      extensions: edition.extensions,
    });

    it.each(SSO_ROUTES)("%s %s returns 404", async (method, path) => {
      const { status, body } = await requestSso(app, method, path);
      expect(status).toBe(404);
      expect(body.code).toBe("SSO_DISABLED");
    });
  },
);

describe.skipIf(!hasBusinessEdition)(
  "Licensed SSO configuration when enabled (AUTH-004)",
  () => {
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
      if (!database)
        throw new Error("Docker is required for integration tests");
      base = database;
      db = await createRoleSeparatedDatabase(base);
      await runMigrations(db.ownerConnectionString);
      await db.adminSql`INSERT INTO organizations (id, name, slug)
      VALUES (${orgId}, 'Acme', 'acme-sso')`;
      await db.adminSql`INSERT INTO users (id, email, name)
      VALUES (${admin.id}, ${admin.email}, ${admin.name})`;
      await authPort.createSession(admin);

      const edition = businessEdition();
      app = createApp({
        sql: db.appSql,
        authPort,
        license: edition.license,
        extensions: edition.extensions,
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
      const redirect = new URL(authorizationUrl).searchParams.get(
        "redirect_uri",
      );
      expect(redirect).toBe("https://api.hr.example.com/v1/sso/callback");
    });
  },
);
