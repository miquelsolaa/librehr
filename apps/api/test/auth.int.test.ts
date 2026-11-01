import { describe, it, expect } from "vitest";
import type { Sql } from "postgres";
import { createApp } from "../src/app.js";
import type { AuthPort, AuthSession } from "../src/ports/auth.js";
import type { AuthUser, ProblemDetails } from "@openhr/contracts";

class FakeAuthPort implements AuthPort {
  private sessions = new Map<string, AuthSession>();

  async verifyCredentials(
    email: string,
    password: string,
  ): Promise<AuthUser | null> {
    if (email === "admin@openhr.local" && password === "Password123!") {
      return {
        id: "00000000-0000-0000-0000-000000000001",
        email: "admin@openhr.local",
        name: "Marta Soler",
        role: "admin",
        organizationId: "10000000-0000-0000-0000-000000000001",
      };
    }
    return null;
  }

  async createSession(user: AuthUser): Promise<AuthSession> {
    const session: AuthSession = {
      user,
      token: "fake_valid_session_token_123",
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

describe("Authentication API Flow & Problem Details", () => {
  const fakeSql = (async () => [
    {
      id: "10000000-0000-0000-0000-000000000001",
      name: "Acme Serveis",
      slug: "acme-serveis",
      default_locale: "ca",
      timezone: "Europe/Madrid",
    },
  ]) as unknown as Sql;

  const authPort = new FakeAuthPort();
  const app = createApp({ sql: fakeSql, authPort });

  it("rejects invalid payload with 400 application/problem+json", async () => {
    const res = await app.request("/v1/auth/sign-in", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "not-an-email", password: "short" }),
    });

    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toContain(
      "application/problem+json",
    );
    const problem = (await res.json()) as ProblemDetails;
    expect(problem.status).toBe(400);
    expect(problem.code).toBe("VALIDATION_ERROR");
    expect(problem.errors?.length).toBeGreaterThan(0);
  });

  it("rejects bad credentials with 401 application/problem+json", async () => {
    const res = await app.request("/v1/auth/sign-in", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "unknown@user.com",
        password: "Password123!",
      }),
    });

    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain(
      "application/problem+json",
    );
    const problem = (await res.json()) as ProblemDetails;
    expect(problem.code).toBe("INVALID_CREDENTIALS");
  });

  it("signs in successfully with 200 and Set-Cookie header", async () => {
    const res = await app.request("/v1/auth/sign-in", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "admin@openhr.local",
        password: "Password123!",
      }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("openhr_session=");
    const body = (await res.json()) as { user: AuthUser };
    expect(body.user.email).toBe("admin@openhr.local");
    expect(body.user.role).toBe("admin");
  });

  it("blocks unauthenticated access to /v1/me with 401 problem+json", async () => {
    const res = await app.request("/v1/me");
    expect(res.status).toBe(401);
    const problem = (await res.json()) as ProblemDetails;
    expect(problem.code).toBe("UNAUTHORIZED");
  });

  it("returns current user session profile on /v1/me with valid Bearer token", async () => {
    const res = await app.request("/v1/me", {
      headers: {
        Authorization: "Bearer fake_valid_session_token_123",
      },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      user: AuthUser;
      organization: { name: string };
      permissions: string[];
    };
    expect(body.user.email).toBe("admin@openhr.local");
    expect(body.organization.name).toBe("Acme Serveis");
    expect(body.permissions).toContain("org.read");
  });
});
