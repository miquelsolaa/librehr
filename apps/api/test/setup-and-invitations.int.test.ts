import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDatabase, type TestDatabase } from "@librehr/testing";
import { runMigrations } from "@librehr/db/migrate";
import type { Sql } from "postgres";
import { createApp } from "../src/app.js";
import type { AuthPort, AuthSession } from "../src/ports/auth.js";
import type { AuthUser, ProblemDetails } from "@librehr/contracts";

class MockAuthPort implements AuthPort {
  private sessions = new Map<string, AuthSession>();

  async verifyCredentials(): Promise<AuthUser | null> {
    return null;
  }

  async createSession(user: AuthUser): Promise<AuthSession> {
    const session: AuthSession = {
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

describe("Setup Wizard & Invitations API (ORG-001, AUTH-005)", () => {
  let db: TestDatabase | null = null;
  let authPort: MockAuthPort;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    authPort = new MockAuthPort();
    db = await getTestDatabase();
    if (db) {
      await runMigrations(db.connectionString);
      app = createApp({ sql: await db.appSql(), authPort });
    }
  });

  afterAll(async () => {
    if (db) {
      await db.close();
    }
  });

  it("validates setup wizard payload constraints", async () => {
    const testApp = db
      ? app
      : createApp({ sql: {} as unknown as Sql, authPort });

    const res = await testApp.request("/v1/org/setup-wizard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orgName: "A", // min 2
        orgSlug: "Invalid Slug with spaces",
        adminName: "",
        adminEmail: "not-an-email",
        adminPassword: "short",
      }),
    });

    expect(res.status).toBe(400);
    const prob = (await res.json()) as ProblemDetails;
    expect(prob.code).toBe("VALIDATION_FAILED");
  });

  it("returns 404 for invalid invitation token", async () => {
    if (!db) return;

    const res = await app.request(
      "/v1/invitations/non-existent-token-1234567890",
    );
    expect(res.status).toBe(404);
  });
});
