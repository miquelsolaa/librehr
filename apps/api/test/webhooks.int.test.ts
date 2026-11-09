import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  createRoleSeparatedDatabase,
  getTestDatabase,
  type RoleSeparatedDatabase,
  type TestDatabase,
} from "@librehr/testing";
import { runMigrations } from "@librehr/db/migrate";
import type { AuthUser, ProblemDetails, WebhookItem } from "@librehr/contracts";
import { createApp } from "../src/app.js";
import type { AuthPort, AuthSession } from "../src/ports/auth.js";

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

// ADM-006. Runs as librehr_app against a real database; the previous version
// used a hand-written fake `tx` that did not implement `tx.json()`.
describe("Outbound Webhooks API (ADM-006)", () => {
  let base: TestDatabase;
  let db: RoleSeparatedDatabase;
  let app: ReturnType<typeof createApp>;

  const orgId = "d1000000-0000-0000-0000-000000000001";
  const otherOrgId = "d2000000-0000-0000-0000-000000000002";
  const admin: AuthUser = {
    id: "d1000000-0000-0000-0000-0000000000a1",
    email: "admin@example.invalid",
    name: "Admin User",
    role: "admin",
    organizationId: orgId,
  };
  const employee: AuthUser = {
    id: "d1000000-0000-0000-0000-0000000000e1",
    email: "employee@example.invalid",
    name: "Employee User",
    role: "employee",
    organizationId: orgId,
  };
  const otherAdmin: AuthUser = {
    id: "d2000000-0000-0000-0000-0000000000a2",
    email: "other-admin@example.invalid",
    name: "Other Admin",
    role: "admin",
    organizationId: otherOrgId,
  };
  const authPort = new MockAuthPort();
  let createdId = "";

  const call = (
    method: string,
    path: string,
    user: AuthUser | null,
    body?: unknown,
  ) =>
    app.request(path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(user ? { Authorization: `Bearer token_${user.id}` } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database) throw new Error("Docker is required for integration tests");
    base = database;
    db = await createRoleSeparatedDatabase(base);
    await runMigrations(db.ownerConnectionString);

    const sql = db.adminSql;
    await sql`INSERT INTO organizations (id, name, slug) VALUES
      (${orgId}, 'Org Hooks', 'org-hooks'), (${otherOrgId}, 'Other', 'org-hooks-other')`;
    await sql`INSERT INTO users (id, email, name) VALUES
      (${admin.id}, ${admin.email}, ${admin.name}),
      (${employee.id}, ${employee.email}, ${employee.name}),
      (${otherAdmin.id}, ${otherAdmin.email}, ${otherAdmin.name})`;

    for (const user of [admin, employee, otherAdmin]) {
      await authPort.createSession(user);
    }

    app = createApp({ sql: db.appSql, authPort });
  }, 60000);

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    if (db) await db.close();
    if (base) await base.close();
  });

  it("GET /v1/webhooks requires authentication", async () => {
    const res = await call("GET", "/v1/webhooks", null);
    expect(res.status).toBe(401);
  });

  it("GET /v1/webhooks denies non-admin users with 403", async () => {
    const res = await call("GET", "/v1/webhooks", employee);
    expect(res.status).toBe(403);
    const body = (await res.json()) as ProblemDetails;
    expect(body.code).toBe("FORBIDDEN");
  });

  it("POST /v1/webhooks validates request payload", async () => {
    const res = await call("POST", "/v1/webhooks", admin, { name: "Test" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as ProblemDetails;
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("POST /v1/webhooks creates a webhook subscription", async () => {
    const res = await call("POST", "/v1/webhooks", admin, {
      name: "Slack Notifications",
      url: "https://hooks.slack.com/services/test",
      events: ["employee.created", "leave.approved"],
      enabled: true,
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as WebhookItem;
    createdId = body.id;
    expect(body.name).toBe("Slack Notifications");
    expect(body.organizationId).toBe(orgId);
    expect(body.secret).toMatch(/^whsec_/);
    expect(body.events).toContain("employee.created");
  });

  it("GET /v1/webhooks lists subscriptions", async () => {
    const res = await call("GET", "/v1/webhooks", admin);
    expect(res.status).toBe(200);
    const list = (await res.json()) as WebhookItem[];
    expect(list).toHaveLength(1);
    expect(list[0]?.name).toBe("Slack Notifications");
  });

  it("does not list or test another organization's webhooks", async () => {
    const list = await call("GET", "/v1/webhooks", otherAdmin);
    expect((await list.json()) as WebhookItem[]).toHaveLength(0);
    const test = await call(
      "POST",
      `/v1/webhooks/${createdId}/test`,
      otherAdmin,
    );
    expect(test.status).toBe(404);
  });

  it("POST /v1/webhooks/:id/test sends ping and records delivery", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("ok", { status: 200 })),
    );

    const res = await call("POST", `/v1/webhooks/${createdId}/test`, admin);
    expect(res.status).toBe(200);
    const result = (await res.json()) as {
      success: boolean;
      statusCode: number;
      durationMs: number;
    };
    expect(result.success).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);

    const [row] = await db.adminSql<
      { last_delivery_status: number | null }[]
    >`SELECT last_delivery_status FROM webhooks WHERE id = ${createdId}`;
    expect(row?.last_delivery_status).toBe(200);
  });

  it("DELETE /v1/webhooks/:id removes webhook subscription", async () => {
    const res = await call("DELETE", `/v1/webhooks/${createdId}`, admin);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean };
    expect(body.success).toBe(true);
  });
});
