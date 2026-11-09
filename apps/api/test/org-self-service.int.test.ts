import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Sql } from "postgres";
import { getTestDatabase, type TestDatabase } from "@librehr/testing";
import { runMigrations } from "@librehr/db/migrate";
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

describe("Phase 1 API Integration Tests (ORG-004, ORG-005, EMP-002, EMP-005)", () => {
  let db: TestDatabase | null = null;
  let authPort: MockAuthPort;
  let app: ReturnType<typeof createApp>;

  const orgId = "00000000-0000-0000-0000-000000000001";
  const adminUser: AuthUser = {
    id: "11111111-1111-1111-1111-111111111111",
    email: "admin@librehr.test",
    name: "Admin User",
    role: "admin",
    organizationId: orgId,
  };

  const staffUser: AuthUser = {
    id: "22222222-2222-2222-2222-222222222222",
    email: "staff@librehr.test",
    name: "Staff User",
    role: "employee",
    organizationId: orgId,
  };

  let adminToken: string;
  let staffToken: string;

  beforeAll(async () => {
    authPort = new MockAuthPort();
    const adminSession = await authPort.createSession(adminUser);
    const staffSession = await authPort.createSession(staffUser);
    adminToken = adminSession.token;
    staffToken = staffSession.token;

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

  it("returns 401 when requesting org chart without authentication", async () => {
    const dummyApp = db
      ? app
      : createApp({ sql: {} as unknown as Sql, authPort });

    const res = await dummyApp.request("/v1/people/org-chart", {
      method: "GET",
    });

    expect(res.status).toBe(401);
  });

  it("prevents non-admin staff from creating custom field definitions", async () => {
    const dummyApp = db
      ? app
      : createApp({ sql: {} as unknown as Sql, authPort });

    const res = await dummyApp.request("/v1/custom-fields", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${staffToken}`,
      },
      body: JSON.stringify({
        name: "Shoe Size",
        code: "shoe_size",
        fieldType: "text",
      }),
    });

    expect(res.status).toBe(403);
    const prob = (await res.json()) as ProblemDetails;
    expect(prob.code).toBe("FORBIDDEN");
  });

  it("validates custom field definition payload", async () => {
    const dummyApp = db
      ? app
      : createApp({ sql: {} as unknown as Sql, authPort });

    const res = await dummyApp.request("/v1/custom-fields", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        // missing name and code
        fieldType: "invalid_type",
      }),
    });

    expect(res.status).toBe(400);
    const prob = (await res.json()) as ProblemDetails;
    expect(prob.code).toBe("VALIDATION_FAILED");
  });

  it("validates emergency contact creation payload", async () => {
    const dummyApp = db
      ? app
      : createApp({ sql: {} as unknown as Sql, authPort });

    const res = await dummyApp.request(
      "/v1/people/33333333-3333-3333-3333-333333333333/emergency-contacts",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          // missing fullName, relationship, phonePrimary
        }),
      },
    );

    expect(res.status).toBe(400);
    const prob = (await res.json()) as ProblemDetails;
    expect(prob.code).toBe("VALIDATION_FAILED");
  });

  it("requires authentication for employee self-service update", async () => {
    const dummyApp = db
      ? app
      : createApp({ sql: {} as unknown as Sql, authPort });

    const res = await dummyApp.request(
      "/v1/people/33333333-3333-3333-3333-333333333333/self-service",
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          phone: "+34 600 000 000",
        }),
      },
    );

    expect(res.status).toBe(401);
  });
});
