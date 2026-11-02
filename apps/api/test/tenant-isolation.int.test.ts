import { describe, it, expect } from "vitest";
import type { Sql } from "postgres";
import { createApp } from "../src/app.js";
import type { AuthPort, AuthSession } from "../src/ports/auth.js";
import type { AuthUser, OrganizationResponse } from "@librehr/contracts";

class MultiTenantAuthPort implements AuthPort {
  private sessions = new Map<string, AuthSession>();

  constructor() {
    // Session for Org A Admin
    const userA: AuthUser = {
      id: "00000000-0000-0000-0000-00000000000a",
      email: "admin@orga.test",
      name: "Admin A",
      role: "admin",
      organizationId: "11111111-1111-1111-1111-111111111111",
    };
    this.sessions.set("token_org_a", {
      user: userA,
      token: "token_org_a",
      expiresAt: new Date(Date.now() + 3600000),
    });

    // Session for Org B Admin
    const userB: AuthUser = {
      id: "00000000-0000-0000-0000-00000000000b",
      email: "admin@orgb.test",
      name: "Admin B",
      role: "admin",
      organizationId: "22222222-2222-2222-2222-222222222222",
    };
    this.sessions.set("token_org_b", {
      user: userB,
      token: "token_org_b",
      expiresAt: new Date(Date.now() + 3600000),
    });
  }

  async verifyCredentials(): Promise<AuthUser | null> {
    return null;
  }
  async createSession(user: AuthUser): Promise<AuthSession> {
    return { user, token: "token", expiresAt: new Date() };
  }
  async getSession(token: string): Promise<AuthSession | null> {
    return this.sessions.get(token) ?? null;
  }
  async revokeSession(): Promise<void> {}
}

describe("API Cross-Tenant Isolation", () => {
  const orgAId = "11111111-1111-1111-1111-111111111111";
  const orgBId = "22222222-2222-2222-2222-222222222222";

  const fakeSql = (async (query: unknown, ...params: unknown[]) => {
    // If querying by org ID
    const queryString = String(query);
    if (queryString.includes("FROM organizations")) {
      const orgIdParam = params[0];
      if (orgIdParam === orgAId) {
        return [
          {
            id: orgAId,
            name: "Company Alpha",
            slug: "company-alpha",
            default_locale: "ca",
            timezone: "Europe/Madrid",
            created_at: new Date("2026-01-01"),
            updated_at: new Date("2026-01-01"),
          },
        ];
      }
      if (orgIdParam === orgBId) {
        return [
          {
            id: orgBId,
            name: "Company Beta",
            slug: "company-beta",
            default_locale: "es",
            timezone: "Europe/Madrid",
            created_at: new Date("2026-01-01"),
            updated_at: new Date("2026-01-01"),
          },
        ];
      }
    }
    return [];
  }) as unknown as Sql;

  const authPort = new MultiTenantAuthPort();
  const app = createApp({ sql: fakeSql, authPort });

  it("proves Tenant A gets Company Alpha data and never Company Beta data", async () => {
    const resA = await app.request("/v1/org", {
      headers: { Authorization: "Bearer token_org_a" },
    });

    expect(resA.status).toBe(200);
    const bodyA = (await resA.json()) as OrganizationResponse;
    expect(bodyA.id).toBe(orgAId);
    expect(bodyA.name).toBe("Company Alpha");
    expect(bodyA.name).not.toBe("Company Beta");

    const resB = await app.request("/v1/org", {
      headers: { Authorization: "Bearer token_org_b" },
    });

    expect(resB.status).toBe(200);
    const bodyB = (await resB.json()) as OrganizationResponse;
    expect(bodyB.id).toBe(orgBId);
    expect(bodyB.name).toBe("Company Beta");
  });
});
