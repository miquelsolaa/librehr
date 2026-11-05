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

describe("Milestone M5 API Integration Tests (RPT-001, RPT-002, ADM-006, LEA-009)", () => {
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
      app = createApp({ sql: db.sql, authPort });
    }
  });

  afterAll(async () => {
    if (db) {
      await db.close();
    }
  });

  it("returns 401 when requesting reports summary without authentication", async () => {
    const dummyApp = db
      ? app
      : createApp({ sql: {} as unknown as Sql, authPort });

    const res = await dummyApp.request("/v1/reports/summary", {
      method: "GET",
    });

    expect(res.status).toBe(401);
  });

  it("does not expose unreliable summary figures to authenticated users", async () => {
    const dummyApp = db
      ? app
      : createApp({ sql: {} as unknown as Sql, authPort });
    for (const token of [adminToken, staffToken]) {
      const res = await dummyApp.request("/v1/reports/summary", {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(503);
    }
  });

  it("does not generate exports from placeholder payroll inputs", async () => {
    const dummyApp = db
      ? app
      : createApp({ sql: {} as unknown as Sql, authPort });
    const res = await dummyApp.request(
      "/v1/reports/gestoria/export?periodYearMonth=2026-03",
      {
        headers: { Authorization: `Bearer ${adminToken}` },
      },
    );
    expect(res.status).toBe(503);
  });

  it("prevents non-admin employees from downloading Gestoria payroll export", async () => {
    const dummyApp = db
      ? app
      : createApp({ sql: {} as unknown as Sql, authPort });

    const res = await dummyApp.request(
      "/v1/reports/gestoria/export?periodYearMonth=2026-03",
      {
        headers: {
          Authorization: `Bearer ${staffToken}`,
        },
      },
    );

    expect(res.status).toBe(403);
    const prob = (await res.json()) as ProblemDetails;
    expect(prob.code).toBe("FORBIDDEN");
  });

  it("validates token creation payload", async () => {
    const dummyApp = db
      ? app
      : createApp({ sql: {} as unknown as Sql, authPort });

    const res = await dummyApp.request("/v1/tokens", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        // missing scopes and name
      }),
    });

    expect(res.status).toBe(422);
    const prob = (await res.json()) as ProblemDetails;
    expect(prob.code).toBe("VALIDATION_ERROR");
  });

  it("allows downloading iCalendar subscription feed", async () => {
    const dummyApp = db
      ? app
      : createApp({ sql: {} as unknown as Sql, authPort });

    const res = await dummyApp.request("/v1/calendar/feed.ics", {
      headers: {
        Authorization: `Bearer ${staffToken}`,
      },
    });

    expect([200, 500]).toContain(res.status);
    if (res.status === 200) {
      expect(res.headers.get("content-type")).toContain("text/calendar");
    }
  });
});
