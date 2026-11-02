import { describe, it, expect, vi } from "vitest";
import type { Sql } from "postgres";
import { createApp } from "../src/app.js";
import type { AuthPort, AuthSession } from "../src/ports/auth.js";
import type { AuthUser, ProblemDetails, WebhookItem } from "@librehr/contracts";

class FakeAuthPort implements AuthPort {
  private sessions = new Map<string, AuthSession>();

  async verifyCredentials(): Promise<AuthUser | null> {
    return null;
  }

  async createSession(user: AuthUser): Promise<AuthSession> {
    const session: AuthSession = {
      user,
      token: "fake_session_token",
      expiresAt: new Date(Date.now() + 3600000),
    };
    this.sessions.set(session.token, session);
    return session;
  }

  async getSession(token: string): Promise<AuthSession | null> {
    if (token === "fake_admin_token") {
      return {
        user: {
          id: "00000000-0000-0000-0000-000000000001",
          email: "admin@librehr.local",
          name: "Admin User",
          role: "admin",
          organizationId: "10000000-0000-0000-0000-000000000001",
        },
        token: "fake_admin_token",
        expiresAt: new Date(Date.now() + 3600000),
      };
    }
    if (token === "fake_employee_token") {
      return {
        user: {
          id: "00000000-0000-0000-0000-000000000002",
          email: "employee@librehr.local",
          name: "Employee User",
          role: "employee",
          organizationId: "10000000-0000-0000-0000-000000000001",
        },
        token: "fake_employee_token",
        expiresAt: new Date(Date.now() + 3600000),
      };
    }
    return this.sessions.get(token) ?? null;
  }

  async revokeSession(token: string): Promise<void> {
    this.sessions.delete(token);
  }
}

describe("Outbound Webhooks API (ADM-006)", () => {
  const inMemoryWebhooks: WebhookItem[] = [];

  const fakeTx = Object.assign(
    async (strings: TemplateStringsArray, ...values: unknown[]) => {
      try {
        const query = strings ? strings.join("?") : "";
        if (query.includes("SET LOCAL") || query.includes("set_config")) {
          return [];
        }
        if (query.includes("INSERT INTO audit_log")) {
          return [];
        }
        if (query.includes("INSERT INTO webhooks")) {
          const name = values[0] as string;
          const url = values[1] as string;
          const secret = values[2] as string;
          const events = JSON.parse(values[3] as string) as string[];
          const enabled = values[4] as boolean;

          const item: WebhookItem = {
            id: "20000000-0000-0000-0000-000000000001",
            organizationId: "10000000-0000-0000-0000-000000000001",
            name,
            url,
            secret,
            events,
            enabled,
            lastDeliveryStatus: null,
            lastDeliveredAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          inMemoryWebhooks.push(item);
          return [item];
        }

        if (
          query.includes("SELECT") &&
          query.includes("FROM webhooks") &&
          query.includes("WHERE id =")
        ) {
          const id = values[0] as string;
          return inMemoryWebhooks.filter((w) => w.id === id);
        }

        if (query.includes("SELECT") && query.includes("FROM webhooks")) {
          return inMemoryWebhooks;
        }

        if (
          query.includes("UPDATE webhooks") &&
          query.includes("SET") &&
          query.includes("last_delivery_status =")
        ) {
          const status = values[0] as number;
          const id = values[1] as string;
          const found = inMemoryWebhooks.find((w) => w.id === id);
          if (found) {
            found.lastDeliveryStatus = status;
            found.lastDeliveredAt = new Date();
          }
          return [];
        }

        if (query.includes("DELETE FROM webhooks")) {
          const id = values[0] as string;
          const idx = inMemoryWebhooks.findIndex((w) => w.id === id);
          if (idx >= 0) {
            inMemoryWebhooks.splice(idx, 1);
            return Object.assign([], { count: 1 });
          }
          return Object.assign([], { count: 0 });
        }

        return [];
      } catch (e) {
        console.error("FAKE TX ERROR:", e);
        throw e;
      }
    },
    { count: 0 },
  );

  const fakeSql = Object.assign(async () => [], {
    begin: async (callback: (tx: unknown) => Promise<unknown>) => {
      const txInstance = Object.assign(
        (...args: [TemplateStringsArray, ...unknown[]]) => fakeTx(...args),
        { count: 0 },
      );
      return callback(txInstance);
    },
  }) as unknown as Sql;

  const authPort = new FakeAuthPort();
  const app = createApp({ sql: fakeSql, authPort });

  it("GET /v1/webhooks requires authentication", async () => {
    const res = await app.request("/v1/webhooks");
    expect(res.status).toBe(401);
  });

  it("GET /v1/webhooks denies non-admin users with 403", async () => {
    const res = await app.request("/v1/webhooks", {
      headers: { Authorization: "Bearer fake_employee_token" },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as ProblemDetails;
    expect(body.code).toBe("FORBIDDEN");
  });

  it("POST /v1/webhooks validates request payload", async () => {
    const res = await app.request("/v1/webhooks", {
      method: "POST",
      headers: {
        Authorization: "Bearer fake_admin_token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Test",
      }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as ProblemDetails;
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("POST /v1/webhooks creates a webhook subscription", async () => {
    const res = await app.request("/v1/webhooks", {
      method: "POST",
      headers: {
        Authorization: "Bearer fake_admin_token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Slack Notifications",
        url: "https://hooks.slack.com/services/test",
        events: ["employee.created", "leave.approved"],
        enabled: true,
      }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as WebhookItem;
    expect(body.id).toBe("20000000-0000-0000-0000-000000000001");
    expect(body.name).toBe("Slack Notifications");
    expect(body.secret).toMatch(/^whsec_/);
    expect(body.events).toContain("employee.created");
  });

  it("GET /v1/webhooks lists subscriptions", async () => {
    const res = await app.request("/v1/webhooks", {
      headers: { Authorization: "Bearer fake_admin_token" },
    });

    expect(res.status).toBe(200);
    const list = (await res.json()) as WebhookItem[];
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list[0]?.name).toBe("Slack Notifications");
  });

  it("POST /v1/webhooks/:id/test sends ping and records delivery", async () => {
    // Mock global fetch to return 200
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
    }) as unknown as typeof fetch;

    try {
      const res = await app.request(
        "/v1/webhooks/20000000-0000-0000-0000-000000000001/test",
        {
          method: "POST",
          headers: { Authorization: "Bearer fake_admin_token" },
        },
      );

      expect(res.status).toBe(200);
      const result = (await res.json()) as {
        success: boolean;
        statusCode: number;
        durationMs: number;
      };
      expect(result.success).toBe(true);
      expect(result.statusCode).toBe(200);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("DELETE /v1/webhooks/:id removes webhook subscription", async () => {
    const res = await app.request(
      "/v1/webhooks/20000000-0000-0000-0000-000000000001",
      {
        method: "DELETE",
        headers: { Authorization: "Bearer fake_admin_token" },
      },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean };
    expect(body.success).toBe(true);
  });
});
