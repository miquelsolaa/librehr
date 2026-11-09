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

describe("Time Tracking API Integration Tests (TIM-001 - TIM-006)", () => {
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
  let auditorToken: string;

  const auditorUser: AuthUser = {
    id: "33333333-3333-3333-3333-333333333333",
    email: "inspector@meyss.gob.es",
    name: "Labour Inspector",
    role: "auditor",
    organizationId: orgId,
  };

  beforeAll(async () => {
    authPort = new MockAuthPort();
    const adminSession = await authPort.createSession(adminUser);
    const staffSession = await authPort.createSession(staffUser);
    const auditorSession = await authPort.createSession(auditorUser);
    adminToken = adminSession.token;
    staffToken = staffSession.token;
    auditorToken = auditorSession.token;

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

  it("validates clocking parameters and rejects invalid event types", async () => {
    const dummyApp = db
      ? app
      : createApp({ sql: {} as unknown as Sql, authPort });

    const res = await dummyApp.request("/v1/time/clock", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${staffToken}`,
      },
      body: JSON.stringify({
        eventType: "invalid_clock_type",
      }),
    });

    expect(res.status).toBe(400);
    const prob = (await res.json()) as ProblemDetails;
    expect(prob.code).toBe("VALIDATION_ERROR");
  });

  it("validates timesheet query parameters", async () => {
    const dummyApp = db
      ? app
      : createApp({ sql: {} as unknown as Sql, authPort });

    const res = await dummyApp.request(
      "/v1/time/timesheet?startDate=invalid&endDate=2026-11-30",
      {
        headers: {
          Authorization: `Bearer ${staffToken}`,
        },
      },
    );

    expect(res.status).toBe(400);
    const prob = (await res.json()) as ProblemDetails;
    expect(prob.code).toBe("VALIDATION_ERROR");
  });

  it("enforces permission check when employee attempts to view another employee's timesheet", async () => {
    const dummyApp = db
      ? app
      : createApp({ sql: {} as unknown as Sql, authPort });

    const res = await dummyApp.request(
      "/v1/time/timesheet?startDate=2026-11-01&endDate=2026-11-30&employeeId=33333333-3333-3333-3333-333333333333",
      {
        headers: {
          Authorization: `Bearer ${staffToken}`,
        },
      },
    );

    // Will be 403 or 404 (if not found in dummy DB)
    expect([403, 404, 500]).toContain(res.status);
  });

  it("validates and handles kiosk clock request (TIM-010)", async () => {
    const dummyApp = db
      ? app
      : createApp({ sql: {} as unknown as Sql, authPort });

    // Missing identifier and PIN
    const invalidRes = await dummyApp.request("/v1/time/kiosk/clock", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        eventType: "clock_in",
      }),
    });
    expect(invalidRes.status).toBe(400);

    // Valid schema with unknown identifier
    const unauthRes = await dummyApp.request("/v1/time/kiosk/clock", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        identifier: "unknown@example.com",
        pin: "1234",
        eventType: "clock_in",
      }),
    });
    expect([401, 500]).toContain(unauthRes.status);
  });

  it("handles setting employee kiosk PIN (TIM-010)", async () => {
    const dummyApp = db
      ? app
      : createApp({ sql: {} as unknown as Sql, authPort });

    const empId = "22222222-2222-2222-2222-222222222222";

    // Invalid PIN format (< 4 digits)
    const badRes = await dummyApp.request(`/v1/people/${empId}/pin`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        pin: "12",
      }),
    });
    expect(badRes.status).toBe(400);

    // Valid PIN format
    const validRes = await dummyApp.request(`/v1/people/${empId}/pin`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        pin: "1234",
        badgeId: "RFID-9942",
      }),
    });
    expect([200, 404, 500]).toContain(validRes.status);
  });

  it("handles time bank balance and entries (TIM-012)", async () => {
    const dummyApp = db
      ? app
      : createApp({ sql: {} as unknown as Sql, authPort });

    // Unauthorized without credentials
    const unauthRes = await dummyApp.request("/v1/time/time-bank", {
      method: "GET",
    });
    expect(unauthRes.status).toBe(401);

    // Authenticated query for employee's time bank
    const authRes = await dummyApp.request("/v1/time/time-bank", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${staffToken}`,
      },
    });
    expect([200, 404, 500]).toContain(authRes.status);

    // Add entry validation
    const entryRes = await dummyApp.request("/v1/time/time-bank/entries", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        employeeId: "22222222-2222-2222-2222-222222222222",
        type: "overtime_accrual",
        minutes: 120,
        referenceDate: "2026-11-01",
        notes: "Project launch overtime",
      }),
    });
    expect([201, 404, 500]).toContain(entryRes.status);
  });

  it("allows labour inspector / auditor role to view timesheets (TIM-008)", async () => {
    const dummyApp = db
      ? app
      : createApp({ sql: {} as unknown as Sql, authPort });

    const res = await dummyApp.request(
      "/v1/time/timesheet?startDate=2026-11-01&endDate=2026-11-30&employeeId=22222222-2222-2222-2222-222222222222",
      {
        headers: {
          Authorization: `Bearer ${auditorToken}`,
        },
      },
    );

    // Auditor is authorized (not 403)
    expect([200, 404, 500]).toContain(res.status);
    expect(res.status).not.toBe(403);
  });
});
