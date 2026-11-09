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

  // No real DNS in tests: a fixed table stands in for the resolver.
  const dnsTable: Record<string, string[]> = {
    "hooks.slack.com": ["93.184.216.34"],
    "hooks.example.com": ["93.184.216.35"],
    "intranet.example.com": ["192.168.10.20"],
  };
  const resolveHost = async (hostname: string) => {
    const addresses = dnsTable[hostname];
    if (!addresses) throw new Error("ENOTFOUND");
    return addresses;
  };

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

    app = createApp({
      sql: db.appSql,
      authPort,
      config: { nodeEnv: "production", resolveHost },
    });
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

  it("never returns the signing secret when listing", async () => {
    const res = await call("GET", "/v1/webhooks", admin);
    const raw = await res.text();
    expect(raw).not.toContain("whsec_");
    const list = JSON.parse(raw) as Record<string, unknown>[];
    expect(list.length).toBeGreaterThan(0);
    for (const item of list) expect(item).not.toHaveProperty("secret");
  });

  it("returns the secret on update only when it is rotated", async () => {
    const plain = await call("PATCH", `/v1/webhooks/${createdId}`, admin, {
      name: "Renamed",
    });
    expect(plain.status).toBe(200);
    expect((await plain.json()) as WebhookItem).not.toHaveProperty("secret");

    const rotated = await call("PATCH", `/v1/webhooks/${createdId}`, admin, {
      rotateSecret: true,
    });
    expect(rotated.status).toBe(200);
    expect(((await rotated.json()) as WebhookItem).secret).toMatch(/^whsec_/);
  });

  it.each([
    "http://169.254.169.254/latest/meta-data",
    "https://169.254.169.254/latest/meta-data",
    "https://localhost/hook",
    "https://10.0.0.1/hook",
    "https://[::ffff:10.0.0.1]/hook",
    "https://intranet.example.com/hook",
  ])("rejects creating a webhook targeting %s", async (url) => {
    const res = await call("POST", "/v1/webhooks", admin, {
      name: "SSRF",
      url,
      events: ["employee.created"],
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as ProblemDetails;
    expect(body.code).toBe("OUTBOUND_URL_NOT_ALLOWED");
    expect(body.detail).toBe("The URL must be a public https:// address");

    const [count] = await db.adminSql<
      { n: number }[]
    >`SELECT count(*)::int AS n FROM webhooks WHERE name = 'SSRF'`;
    expect(count?.n).toBe(0);
  });

  it("rejects updating a webhook to a private URL", async () => {
    const res = await call("PATCH", `/v1/webhooks/${createdId}`, admin, {
      url: "https://intranet.example.com/hook",
    });
    expect(res.status).toBe(400);
    const [row] = await db.adminSql<
      { url: string }[]
    >`SELECT url FROM webhooks WHERE id = ${createdId}`;
    expect(row?.url).toBe("https://hooks.slack.com/services/test");
  });

  it("re-checks the URL before sending and never fetches a private target", async () => {
    // A row stored before the guard existed (or whose DNS changed since).
    const [legacy] = await db.adminSql<{ id: string }[]>`
      INSERT INTO webhooks (organization_id, name, url, secret, events)
      VALUES (${orgId}, 'Legacy', 'http://169.254.169.254/latest', 'whsec_legacy',
              '["employee.created"]'::jsonb)
      RETURNING id`;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const res = await call("POST", `/v1/webhooks/${legacy!.id}/test`, admin);
    expect(res.status).toBe(400);
    expect(((await res.json()) as ProblemDetails).code).toBe(
      "OUTBOUND_URL_NOT_ALLOWED",
    );
    expect(fetchSpy).not.toHaveBeenCalled();

    await db.adminSql`DELETE FROM webhooks WHERE id = ${legacy!.id}`;
  });

  it("does not follow redirects and keeps errors generic", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { Location: "http://169.254.169.254/" },
      }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const res = await call("POST", `/v1/webhooks/${createdId}/test`, admin);
    expect(res.status).toBe(200);
    const result = (await res.json()) as { success: boolean; error: string };
    expect(result.success).toBe(false);
    expect(result.error).not.toContain("169.254");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({ redirect: "manual" });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED 10.1.2.3:443")),
    );
    const failed = await call("POST", `/v1/webhooks/${createdId}/test`, admin);
    const failure = (await failed.json()) as { error: string };
    expect(failure.error).toBe("The endpoint could not be reached");
  });

  it("drops unknown stored events instead of returning them", async () => {
    await db.adminSql`UPDATE webhooks
      SET events = '["employee.created", 42, {"x": 1}, "not.an.event"]'::jsonb
      WHERE id = ${createdId}`;
    const res = await call("GET", "/v1/webhooks", admin);
    const list = (await res.json()) as WebhookItem[];
    expect(list.find((w) => w.id === createdId)?.events).toEqual([
      "employee.created",
    ]);
  });

  it("DELETE /v1/webhooks/:id removes webhook subscription", async () => {
    const res = await call("DELETE", `/v1/webhooks/${createdId}`, admin);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean };
    expect(body.success).toBe(true);
  });
});
