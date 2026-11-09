import { describe, it, expect } from "vitest";
import type { Sql } from "postgres";
import { createApp } from "../src/app.js";
import type { AuthPort, AuthSession } from "../src/ports/auth.js";
import type { AuthUser, ProblemDetails } from "@librehr/contracts";
import { generateTotpSecret } from "@librehr/core";

class FakeAuthPort implements AuthPort {
  private sessions = new Map<string, AuthSession>();

  async verifyCredentials(
    email: string,
    password: string,
  ): Promise<AuthUser | null> {
    if (email === "admin@librehr.local" && password === "Password123!") {
      return {
        id: "00000000-0000-0000-0000-000000000001",
        email: "admin@librehr.local",
        name: "Admin User",
        role: "admin",
        organizationId: "10000000-0000-0000-0000-000000000001",
      };
    }
    return null;
  }

  async createSession(user: AuthUser): Promise<AuthSession> {
    const session: AuthSession = {
      user,
      token: "fake_session_token_security_test",
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

describe("Enterprise Auth & Security Hardening API (AUTH-003, AUTH-004, DOC-007)", () => {
  const fakeSql = (async () => []) as unknown as Sql;
  const authPort = new FakeAuthPort();
  const app = createApp({
    sql: fakeSql,
    authPort,
    config: { ssoEnabled: true },
  });

  it("does not issue a two-factor challenge without a configured signing secret", async () => {
    {
      const sql = (async () => [
        {
          id: "00000000-0000-0000-0000-000000000001",
          email: "admin@librehr.local",
          name: "Admin User",
          twoFactorEnabled: true,
          twoFactorSecret: "TESTSECRET",
          twoFactorRecoveryCodes: [],
        },
      ]) as unknown as Sql;
      const testApp = createApp({
        sql,
        authPort: new FakeAuthPort(),
        sessionSecret: "",
      });
      const res = await testApp.request("/v1/auth/sign-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "admin@librehr.local",
          password: "Password123!",
        }),
      });
      expect(res.status).toBe(503);
      expect(await res.json()).not.toHaveProperty("challengeToken");
    }
  });

  it("issues a challenge when a strong signing secret is configured", async () => {
    {
      const sql = (async () => [
        {
          id: "00000000-0000-0000-0000-000000000001",
          email: "admin@librehr.local",
          name: "Admin User",
          twoFactorEnabled: true,
          twoFactorSecret: "TESTSECRET",
          twoFactorRecoveryCodes: [],
        },
      ]) as unknown as Sql;
      const testApp = createApp({
        sql,
        authPort: new FakeAuthPort(),
        sessionSecret: "a-secure-test-secret-with-at-least-32-characters",
      });
      const res = await testApp.request("/v1/auth/sign-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "admin@librehr.local",
          password: "Password123!",
        }),
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toHaveProperty("challengeToken");
    }
  });

  it("POST /v1/auth/2fa/setup requires authentication", async () => {
    const res = await app.request("/v1/auth/2fa/setup", {
      method: "POST",
    });
    expect(res.status).toBe(401);
  });

  it("POST /v1/auth/2fa/setup returns TOTP secret and recovery codes when authenticated", async () => {
    // The pending setup is stored (UPDATE ... RETURNING id) before it is shown.
    const setupApp = createApp({
      sql: Object.assign(
        async () => [{ id: "00000000-0000-0000-0000-000000000001" }],
        { json: (value: unknown) => value },
      ) as unknown as Sql,
      authPort,
    });
    const res = await setupApp.request("/v1/auth/2fa/setup", {
      method: "POST",
      headers: {
        Authorization: "Bearer fake_admin_token",
      },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      secret: string;
      qrUri: string;
      recoveryCodes: string[];
    };

    expect(body.secret).toBeDefined();
    expect(body.qrUri).toContain("otpauth://totp/");
    expect(body.recoveryCodes).toHaveLength(8);
  });

  it("POST /v1/auth/2fa/enable rejects a client-supplied secret with 400", async () => {
    const secret = generateTotpSecret();
    const res = await app.request("/v1/auth/2fa/enable", {
      method: "POST",
      headers: {
        Authorization: "Bearer fake_admin_token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        secret,
        code: "000000",
        recoveryCodes: ["1234-5678"],
      }),
    });

    expect(res.status).toBe(400);
    const problem = (await res.json()) as ProblemDetails;
    expect(problem.code).toBe("VALIDATION_ERROR");
  });

  it("POST /v1/sso/authorize validates request and detects missing domain", async () => {
    const res = await app.request("/v1/sso/authorize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    const problem = (await res.json()) as ProblemDetails;
    expect(problem.code).toBe("MISSING_DOMAIN");
  });

  it("GET /v1/sso/config forbids non-admin users", async () => {
    const res = await app.request("/v1/sso/config", {
      headers: {
        Authorization: "Bearer fake_employee_token",
      },
    });

    expect(res.status).toBe(403);
  });

  it("POST /v1/documents/templates forbids non-admin users", async () => {
    const res = await app.request("/v1/documents/templates", {
      method: "POST",
      headers: {
        Authorization: "Bearer fake_employee_token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Test Template",
        category: "contract",
        content: "Hello {{employee.name}}",
      }),
    });

    expect(res.status).toBe(403);
  });
});
