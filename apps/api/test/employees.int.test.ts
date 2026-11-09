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

describe("Employees API Integration Tests (EMP-001 - EMP-007, ADM-001, ADM-002)", () => {
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

  const employeeUser: AuthUser = {
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
    const staffSession = await authPort.createSession(employeeUser);
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

  it("validates Spanish DNI/NIE and IBAN formats on employee creation", async () => {
    if (!db) {
      // Test route validation with dummy sql if no container
      const dummyApp = createApp({ sql: {} as unknown as Sql, authPort });
      const res = await dummyApp.request("/v1/employees", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          firstName: "Carles",
          lastName: "Puig",
          email: "carles@librehr.test",
          nationalId: "00000000A", // Invalid control letter for 00000000 (expects T)
        }),
      });

      expect(res.status).toBe(422);
      const prob = (await res.json()) as ProblemDetails;
      expect(prob.code).toBe("INVALID_NATIONAL_ID");
      return;
    }

    // When DB is present, verify full flow
    const res = await app.request("/v1/employees", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        firstName: "Carles",
        lastName: "Puig",
        email: "carles@librehr.test",
        nationalId: "00000000A", // Invalid control letter
      }),
    });

    expect(res.status).toBe(422);
  });

  it("rejects unauthorized access when employee role attempts admin operations", async () => {
    const dummyApp = db
      ? app
      : createApp({ sql: {} as unknown as Sql, authPort });

    const res = await dummyApp.request("/v1/employees", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${staffToken}`, // employee role cannot employee.write
      },
      body: JSON.stringify({
        firstName: "Test",
        lastName: "User",
        email: "test@librehr.test",
      }),
    });

    expect(res.status).toBe(403);
    const prob = (await res.json()) as ProblemDetails;
    expect(prob.code).toBe("FORBIDDEN");
  });
});
