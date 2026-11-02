import { describe, it, expect, beforeAll } from "vitest";
import { createApp } from "../src/app.js";
import type { AuthPort, AuthSession } from "../src/ports/auth.js";
import type { AuthUser } from "@librehr/contracts";

import type { Sql } from "postgres";

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

describe("Shifts & Municipal Holidays API (LEA-003, TIM-004, TIM-005)", () => {
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

    // Use a lightweight mock SQL adapter for route verification
    const fakeSql = (async () => []) as unknown as Sql;

    app = createApp({
      sql: fakeSql,
      authPort,
    });
  });

  it("requires authentication for shift endpoints", async () => {
    const res = await app.request("/v1/shifts/templates", {
      method: "GET",
    });
    expect(res.status).toBe(401);
  });

  it("forbids regular employees from creating shift templates", async () => {
    const res = await app.request("/v1/shifts/templates", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${staffToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Morning Shift",
        code: "M",
        type: "morning",
        startTime: "06:00",
        endTime: "14:00",
      }),
    });
    expect(res.status).toBe(403);
  });

  it("forbids regular employees from configuring municipal holidays", async () => {
    const res = await app.request("/v1/calendar/holidays", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${staffToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        locationId: "00000000-0000-0000-0000-000000000001",
        date: "2026-09-24",
        name: "La Mercè",
        scope: "local",
      }),
    });
    expect(res.status).toBe(403);
  });

  it("validates request payload when adding local holiday", async () => {
    const res = await app.request("/v1/calendar/holidays", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        // Missing locationId and name
        date: "invalid-date",
      }),
    });
    expect(res.status).toBe(400);
  });

  it("validates request payload when creating shift swap", async () => {
    const res = await app.request("/v1/shifts/swaps", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${staffToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        // Missing targetEmployeeId and dates
        reason: "Family event",
      }),
    });
    expect(res.status).toBe(400);
  });
});
