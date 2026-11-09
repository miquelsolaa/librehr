import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createRoleSeparatedDatabase,
  getTestDatabase,
  type RoleSeparatedDatabase,
  type TestDatabase,
} from "@librehr/testing";
import { runMigrations } from "@librehr/db/migrate";
import type { AuthUser, ProblemDetails } from "@librehr/contracts";
import { createApp } from "../src/app.js";
import type { AuthPort, AuthSession } from "../src/ports/auth.js";

class NoSessionsAuthPort implements AuthPort {
  async verifyCredentials(): Promise<AuthUser | null> {
    return null;
  }
  async createSession(user: AuthUser): Promise<AuthSession> {
    return { user, token: "unused", expiresAt: new Date() };
  }
  async getSession(): Promise<AuthSession | null> {
    return null;
  }
  async revokeSession(): Promise<void> {}
}

const wizard = (overrides: Record<string, string> = {}) => ({
  orgName: "First Org",
  orgSlug: "first-org",
  adminName: "Ada Admin",
  adminEmail: "ada@example.invalid",
  adminPassword: "first-run-password",
  defaultLocale: "es",
  timezone: "Europe/Madrid",
  legalEntityName: "First Org SL",
  legalEntityCif: "B00000000",
  locationName: "HQ",
  locationCity: "Barcelona",
  locationRegion: "Catalonia",
  ...overrides,
});

// ORG-001: the setup wizard is a first-run, all-or-nothing operation.
describe("Setup wizard (ORG-001)", () => {
  let base: TestDatabase;
  let db: RoleSeparatedDatabase;
  let app: ReturnType<typeof createApp>;

  const post = (body: unknown, ip = "203.0.113.1") =>
    app.request("/v1/org/setup-wizard", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
      body: JSON.stringify(body),
    });
  const count = async (table: string) => {
    const [row] = await db.adminSql.unsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM ${table}`,
    );
    return row?.n ?? -1;
  };

  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database) throw new Error("Docker is required for integration tests");
    base = database;
    db = await createRoleSeparatedDatabase(base);
    await runMigrations(db.ownerConnectionString);
    app = createApp({ sql: db.appSql, authPort: new NoSessionsAuthPort() });
  }, 60000);

  afterAll(async () => {
    if (db) await db.close();
    if (base) await base.close();
  });

  it("leaves nothing behind when a step fails after the organization insert", async () => {
    // Force the legal-entity insert (step 2a) to fail inside the transaction.
    await db.adminSql`ALTER TABLE legal_entities
      ADD CONSTRAINT test_fail_setup CHECK (name <> 'FAIL ME')`;
    try {
      const res = await post(wizard({ legalEntityName: "FAIL ME" }));
      expect(res.status).toBe(500);
    } finally {
      await db.adminSql`ALTER TABLE legal_entities DROP CONSTRAINT test_fail_setup`;
    }
    expect(await count("organizations")).toBe(0);
    expect(await count("users")).toBe(0);
  });

  it("creates the first organization", async () => {
    const res = await post(wizard());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      organizationId: string;
    };
    expect(body.success).toBe(true);

    expect(await count("organizations")).toBe(1);
    const [membership] = await db.adminSql<{ role: string }[]>`
      SELECT role FROM memberships WHERE organization_id = ${body.organizationId}`;
    expect(membership?.role).toBe("admin");
  });

  it("returns 409 once any organization exists, whatever the slug or caller", async () => {
    for (const overrides of [
      {},
      { orgSlug: "second-org", adminEmail: "mallory@example.invalid" },
    ]) {
      const res = await post(wizard(overrides), "203.0.113.2");
      expect(res.status).toBe(409);
      const problem = (await res.json()) as ProblemDetails;
      expect(problem.code).toBe("SETUP_ALREADY_COMPLETED");
    }
    expect(await count("organizations")).toBe(1);
    const [stranger] = await db.adminSql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM users WHERE email = 'mallory@example.invalid'`;
    expect(stranger?.n).toBe(0);
  });

  it("is rate limited per client", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      statuses.push((await post(wizard(), "203.0.113.99")).status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 409)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
  });
});
