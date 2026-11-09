import { describe, expect, it } from "vitest";
import {
  CreatePersonalAccessTokenSchema,
  CreateWebhookRequestSchema,
  parsePatScopes,
  parseWebhookEvents,
  WEBHOOK_SUBSCRIBABLE_EVENTS,
} from "@librehr/contracts";
import { WEBHOOK_EVENTS } from "@librehr/core";

// ADM-006: stored jsonb arrays are validated, never cast. Writes reject
// unknown values; reads drop them (fail closed: fewer scopes or deliveries).
describe("parsePatScopes / parseWebhookEvents", () => {
  it("keeps known values from arrays and legacy JSON strings", () => {
    expect(parsePatScopes(["read", "write"])).toEqual(["read", "write"]);
    expect(parsePatScopes('["admin"]')).toEqual(["admin"]);
    expect(parseWebhookEvents(["leave.approved"])).toEqual(["leave.approved"]);
    expect(parseWebhookEvents('["employee.created"]')).toEqual([
      "employee.created",
    ]);
  });

  it("drops junk elements instead of casting them", () => {
    const junk = [
      "read",
      "superuser",
      42,
      null,
      { scope: "admin" },
      ["admin"],
      "ADMIN",
      "read",
    ];
    expect(parsePatScopes(junk)).toEqual(["read"]);
    expect(
      parseWebhookEvents(["leave.approved", "test.ping", 1, {}, "x"]),
    ).toEqual(["leave.approved"]);
  });

  it("returns an empty list for non-array or malformed values", () => {
    for (const value of [null, undefined, 1, "admin", "{", '{"a":1}', {}]) {
      expect(parsePatScopes(value)).toEqual([]);
      expect(parseWebhookEvents(value)).toEqual([]);
    }
  });

  it("rejects unknown values on write", () => {
    expect(
      CreatePersonalAccessTokenSchema.safeParse({
        name: "ci",
        scopes: ["read", "root"],
      }).success,
    ).toBe(false);
    expect(
      CreateWebhookRequestSchema.safeParse({
        name: "hook",
        url: "https://hooks.example.com",
        events: ["employee.created", "everything"],
      }).success,
    ).toBe(false);
  });

  it("only offers events the core engine knows", () => {
    for (const event of WEBHOOK_SUBSCRIBABLE_EVENTS) {
      expect(WEBHOOK_EVENTS).toContain(event);
    }
  });
});
