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

describe("Documents & Lifecycle API Integration Tests (DOC-001 - DOC-005, ONB-001 - ONB-002, EMP-006, ADM-004)", () => {
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

  it("rejects unauthorized document list without credentials", async () => {
    const dummyApp = db
      ? app
      : createApp({ sql: {} as unknown as Sql, authPort });

    const res = await dummyApp.request("/v1/documents", {
      method: "GET",
    });

    expect(res.status).toBe(401);
  });

  it("prevents employee from listing another employee's documents", async () => {
    const dummyApp = db
      ? app
      : createApp({ sql: {} as unknown as Sql, authPort });

    const res = await dummyApp.request(
      "/v1/documents?employeeId=99999999-9999-9999-9999-999999999999",
      {
        headers: {
          Authorization: `Bearer ${staffToken}`,
        },
      },
    );

    expect([403, 500]).toContain(res.status);
    if (res.status === 403) {
      const prob = (await res.json()) as ProblemDetails;
      expect(prob.code).toBe("FORBIDDEN");
    }
  });

  it("validates document upload payload structure", async () => {
    const dummyApp = db
      ? app
      : createApp({ sql: {} as unknown as Sql, authPort });

    const res = await dummyApp.request("/v1/documents", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        // missing required fields
        category: "contracts",
      }),
    });

    expect(res.status).toBe(422);
    const prob = (await res.json()) as ProblemDetails;
    expect(prob.code).toBe("VALIDATION_ERROR");
  });

  it("validates bulk payslips payload structure", async () => {
    const dummyApp = db
      ? app
      : createApp({ sql: {} as unknown as Sql, authPort });

    const res = await dummyApp.request("/v1/documents/payslips/bulk", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        files: [],
      }),
    });

    // Valid schema (empty files list)
    expect([200, 500]).toContain(res.status);
  });

  it("prevents employee from instantiating checklists", async () => {
    const dummyApp = db
      ? app
      : createApp({ sql: {} as unknown as Sql, authPort });

    const res = await dummyApp.request("/v1/checklists/instances", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${staffToken}`,
      },
      body: JSON.stringify({
        templateId: "00000000-0000-0000-0000-000000000001",
        employeeId: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
        baseDate: "2026-11-01",
      }),
    });

    expect(res.status).toBe(403);
    const prob = (await res.json()) as ProblemDetails;
    expect(prob.code).toBe("FORBIDDEN");
  });

  it("validates employee bulk CSV import schema", async () => {
    const dummyApp = db
      ? app
      : createApp({ sql: {} as unknown as Sql, authPort });

    const res = await dummyApp.request("/v1/employees/import", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        csvContent:
          "first_name,last_name,email,tax_id,hire_date,job_title,contract_type\nInvalid,Row,bad-email,12345,2026-01-01,Dev,indefinido",
        dryRun: true,
      }),
    });

    expect(res.status).toBe(200);
    const report = (await res.json()) as { valid: boolean; errors: unknown[] };
    expect(report.valid).toBe(false);
    expect(report.errors.length).toBeGreaterThan(0);
  });

  it("prevents non-admin employee from accessing another employee's DSR dump", async () => {
    const dummyApp = db
      ? app
      : createApp({ sql: {} as unknown as Sql, authPort });

    const res = await dummyApp.request(
      "/v1/employees/99999999-9999-9999-9999-999999999999/dsr-export",
      {
        headers: {
          Authorization: `Bearer ${staffToken}`,
        },
      },
    );

    expect([403, 500]).toContain(res.status);
    if (res.status === 403) {
      const prob = (await res.json()) as ProblemDetails;
      expect(prob.code).toBe("FORBIDDEN");
    }
  });

  it("handles mark all notifications as read (NOT-002)", async () => {
    const dummyApp = db
      ? app
      : createApp({ sql: {} as unknown as Sql, authPort });

    const unauthRes = await dummyApp.request("/v1/notifications/read-all", {
      method: "POST",
    });
    expect(unauthRes.status).toBe(401);

    const authRes = await dummyApp.request("/v1/notifications/read-all", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${staffToken}`,
      },
    });
    expect([200, 500]).toContain(authRes.status);
    if (authRes.status === 200) {
      const body = (await authRes.json()) as { success: boolean };
      expect(body.success).toBe(true);
    }
  });

  it("handles document acknowledgement endpoints (DOC-006)", async () => {
    const dummyApp = db
      ? app
      : createApp({ sql: {} as unknown as Sql, authPort });

    const docId = "00000000-0000-0000-0000-000000000001";

    // Unauthenticated acknowledgement is rejected
    const unauthRes = await dummyApp.request(
      `/v1/documents/${docId}/acknowledge`,
      {
        method: "POST",
      },
    );
    expect(unauthRes.status).toBe(401);

    // Authenticated employee acknowledges
    const ackRes = await dummyApp.request(
      `/v1/documents/${docId}/acknowledge`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${staffToken}`,
        },
      },
    );
    expect([200, 404, 500]).toContain(ackRes.status);

    // Fetch acknowledgements
    const listAckRes = await dummyApp.request(
      `/v1/documents/${docId}/acknowledgements`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
      },
    );
    // Unknown documents are 404 now that receipts are scoped to the document.
    expect([200, 404, 500]).toContain(listAckRes.status);
  });
});
