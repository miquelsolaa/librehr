import type { AuthUser } from "@librehr/contracts";
import type { FixturePerson } from "@librehr/testing";
import type { AuthPort } from "../../src/ports/auth.js";

/** Auth port whose session token for each fixture person is their user id. */
export function fixtureAuthPort(people: FixturePerson[]): AuthPort {
  const byToken = new Map<string, AuthUser>(
    people.map((p) => [
      p.id,
      {
        id: p.id,
        email: p.email,
        name: p.name,
        role: p.role,
        organizationId: p.organizationId,
      },
    ]),
  );
  return {
    async verifyCredentials() {
      return null;
    },
    async createSession(user) {
      return { user, token: user.id, expiresAt: new Date(Date.now() + 60000) };
    },
    async getSession(token) {
      const user = byToken.get(token);
      return user
        ? { user, token, expiresAt: new Date(Date.now() + 60000) }
        : null;
    },
    async revokeSession() {},
  };
}

/** Request headers authenticating as a fixture person. */
export function as(
  person: FixturePerson,
  json = false,
): Record<string, string> {
  return {
    Authorization: `Bearer ${person.id}`,
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}
