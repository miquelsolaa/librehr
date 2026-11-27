import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import {
  getTestDatabase,
  seedScopedOrg,
  type ScopedOrgFixture,
  type TestDatabase,
} from "@librehr/testing";
import { runMigrations } from "@librehr/db/migrate";
import { legacyKioskPinHashForTests, hashKioskPin } from "@librehr/core";
import { createApp } from "../src/app.js";
import { isolatedRateLimitStore } from "./support/rate-limit.js";
import { as, fixtureAuthPort } from "./support/fixture-app.js";

const KEY = "api_test_time_chain_key_at_least_32_chars";

describe("time-record integrity and kiosk (TIM-002, TIM-003, TIM-010)", () => {
  let db: TestDatabase;
  let appSql: Sql;
  let org: ScopedOrgFixture;
  let app: ReturnType<typeof createApp>;

  // `prefix`: apps built with the same one act as replicas of one deployment.
  const build = (
    kiosk?: { maxFailuresPerIdentifier?: number; maxFailuresPerIp?: number },
    prefix?: string,
  ) =>
    createApp({
      sql: appSql,
      // Fresh counters and lockouts per app, as each app had before issue #35.
      rateLimitStore: isolatedRateLimitStore(appSql, prefix ? { prefix } : {}),
      authPort: fixtureAuthPort([
        org.admin,
        org.manager,
        org.report,
        org.peer,
        org.auditor,
      ]),
      timeChainKey: KEY,
      // app.request has no socket: trust one hop so X-Forwarded-For is the client.
      trustProxy: 1,
      ...(kiosk ? { timeTracking: { kiosk } } : {}),
    });

  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database) throw new Error("Docker is required for time tests");
    db = database;
    await runMigrations(db.connectionString);
    appSql = await db.appSql();
    org = await seedScopedOrg(db.sql, "time-integrity");
    app = build();
  }, 90000);

  afterAll(async () => {
    if (db) await db.close();
  });

  const clock = (body: Record<string, unknown>, person = org.report) =>
    app.request("/v1/time/clock", {
      method: "POST",
      headers: as(person, true),
      body: JSON.stringify(body),
    });

  const chainOf = (employeeId: string) =>
    db.sql<
      { seq: number; prevHash: string | null; hash: string; source: string }[]
    >`
      SELECT seq::int as seq, prev_hash as "prevHash", hash, source
      FROM time_events WHERE employee_id = ${employeeId} AND seq IS NOT NULL
      ORDER BY seq
    `;

  it("refuses an auditor with a legacy employee row and writes nothing (#107)", async () => {
    // seedScopedOrg gives the auditor an employee row, as older invitations did.
    const res = await clock({ eventType: "clock_in" }, org.auditor);
    expect(res.status).toBe(403);
    expect((await res.json()) as { code: string }).toMatchObject({
      code: "FORBIDDEN",
    });
    expect(await chainOf(org.auditor.employeeId)).toHaveLength(0);
  });

  it("asks for a session before checking the clock permission", async () => {
    const res = await app.request("/v1/time/clock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventType: "clock_in" }),
    });
    expect(res.status).toBe(401);
  });

  it("concurrent clock-ins produce one linear chain", async () => {
    const responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        clock({ eventType: "clock_in" }, org.peer),
      ),
    );
    expect(responses.map((r) => r.status)).toEqual(Array(8).fill(201));

    const chain = await chainOf(org.peer.employeeId);
    expect(chain.map((r) => r.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    chain.forEach((row, i) => {
      expect(row.prevHash).toBe(i === 0 ? null : chain[i - 1]!.hash);
      expect(row.source).toBe("web");
    });
  });

  it("rejects occurredAt 10 minutes in the past with a correction pointer", async () => {
    const res = await clock({
      eventType: "clock_in",
      occurredAt: new Date(Date.now() - 10 * 60_000).toISOString(),
    });
    expect(res.status).toBe(422);
    expect(res.headers.get("content-type")).toContain(
      "application/problem+json",
    );
    const problem = (await res.json()) as {
      type: string;
      code: string;
      detail: string;
    };
    expect(problem.type).toBe("/problems/time-event-out-of-window");
    expect(problem.code).toBe("TIME_EVENT_OUT_OF_WINDOW");
    expect(problem.detail).toContain("/v1/time/corrections");
  });

  it("rejects occurredAt 10 minutes in the future", async () => {
    const res = await clock({
      eventType: "clock_in",
      occurredAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    });
    expect(res.status).toBe(422);
  });

  it("accepts occurredAt 30 seconds in the past", async () => {
    const occurredAt = new Date(Date.now() - 30_000).toISOString();
    const res = await clock({ eventType: "clock_in", occurredAt });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { occurredAt: string; source: string };
    expect(body.occurredAt).toBe(occurredAt);
    expect(body.source).toBe("web");
  });

  it("does not let a client choose source=kiosk", async () => {
    const before = await chainOf(org.report.employeeId);
    const res = await clock({ eventType: "clock_in", source: "kiosk" });
    expect(res.status).toBe(400);
    const after = await chainOf(org.report.employeeId);
    expect(after.length).toBe(before.length);
    expect(after.some((r) => r.source === "kiosk")).toBe(false);
  });

  // A lone surrogate is signed as an escape but stored as U+FFFD (and NUL is
  // refused by Postgres), so such text would make a genuine row fail
  // verification. It is rejected at the boundary instead.
  it.each([
    ["a lone high surrogate", "late \ud800 train"],
    ["a lone low surrogate", "\udc00"],
    ["NUL", "bus\u0000"],
  ])("rejects notes with %s (400) and writes nothing", async (_, notes) => {
    const before = await chainOf(org.report.employeeId);
    const res = await clock({ eventType: "clock_in", notes });
    expect(res.status).toBe(400);
    expect(await chainOf(org.report.employeeId)).toHaveLength(before.length);

    const correction = await app.request("/v1/time/corrections", {
      method: "POST",
      headers: as(org.report, true),
      body: JSON.stringify({
        proposedEventType: "clock_in",
        proposedOccurredAt: new Date(Date.now() - 3_600_000).toISOString(),
        reason: `forgot ${notes}`,
      }),
    });
    expect(correction.status).toBe(400);
  });

  it("still accepts paired surrogates (emoji) in notes", async () => {
    const res = await clock({
      eventType: "clock_in",
      notes: "on site \u{1F44D}",
    });
    expect(res.status).toBe(201);
  });

  const kioskClock = (
    target: ReturnType<typeof createApp>,
    person: ScopedOrgFixture["admin"],
    identifier: string,
    pin: string,
    ip: string,
  ) =>
    target.request("/v1/time/kiosk/clock", {
      method: "POST",
      headers: { ...as(person, true), "X-Forwarded-For": ip },
      body: JSON.stringify({ identifier, pin, eventType: "clock_in" }),
    });

  it("requires the time.kiosk permission", async () => {
    for (const person of [org.report, org.manager, org.auditor]) {
      const res = await kioskClock(
        app,
        person,
        org.peer.email,
        "1234",
        "10.0.0.1",
      );
      expect(res.status).toBe(403);
    }
    const anonymous = await app.request("/v1/time/kiosk/clock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        identifier: org.peer.email,
        pin: "1234",
        eventType: "clock_in",
      }),
    });
    expect(anonymous.status).toBe(401);
  });

  it("clocks with a valid PIN and returns the name only on success", async () => {
    await db.sql`UPDATE employees SET pin_hash = ${await hashKioskPin("2468")}, pin_salt = NULL WHERE id = ${org.manager.employeeId}`;

    const bad = await kioskClock(
      app,
      org.admin,
      org.manager.email,
      "0000",
      "10.0.0.2",
    );
    expect(bad.status).toBe(401);
    const badText = await bad.text();
    expect(badText).not.toContain("manager");
    const unknown = await kioskClock(
      app,
      org.admin,
      "nobody@example.invalid",
      "0000",
      "10.0.0.2",
    );
    expect(unknown.status).toBe(401);
    expect(await unknown.json()).toEqual(JSON.parse(badText));

    const ok = await kioskClock(
      app,
      org.admin,
      org.manager.email,
      "2468",
      "10.0.0.2",
    );
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({
      success: true,
      employeeName: "Fixture",
      newStatus: "clocked_in",
    });
    const chain = await chainOf(org.manager.employeeId);
    expect(chain.at(-1)?.source).toBe("kiosk");
  });

  it("locks out an identifier after N failed PINs, even for the right PIN", async () => {
    await db.sql`UPDATE employees SET pin_hash = ${await hashKioskPin("1357")}, pin_salt = NULL WHERE id = ${org.auditor.employeeId}`;
    const strict = build({ maxFailuresPerIdentifier: 3 });

    for (let i = 0; i < 3; i++) {
      const res = await kioskClock(
        strict,
        org.admin,
        org.auditor.email,
        "9999",
        `10.0.1.${i}`,
      );
      expect(res.status).toBe(401);
    }
    const locked = await kioskClock(
      strict,
      org.admin,
      org.auditor.email,
      "1357",
      "10.0.1.99",
    );
    expect(locked.status).toBe(429);
    expect(Number(locked.headers.get("retry-after"))).toBeGreaterThan(0);

    // Another identifier from another IP is unaffected.
    await db.sql`UPDATE employees SET pin_hash = ${await hashKioskPin("8642")}, pin_salt = NULL WHERE id = ${org.report.employeeId}`;
    const other = await kioskClock(
      strict,
      org.admin,
      org.report.email,
      "8642",
      "10.0.2.1",
    );
    expect(other.status).toBe(200);
  });

  it("checks at most N concurrent PINs for an identifier across two replicas (#35)", async () => {
    await db.sql`UPDATE employees SET pin_hash = ${await hashKioskPin("8642")}, pin_salt = NULL WHERE id = ${org.report.employeeId}`;
    const prefix = crypto.randomUUID();
    const replicas = [
      build({ maxFailuresPerIdentifier: 3 }, prefix),
      build({ maxFailuresPerIdentifier: 3 }, prefix),
    ];
    const statuses = await Promise.all(
      Array.from(
        { length: 10 },
        async (_, i) =>
          (
            await kioskClock(
              replicas[i % 2]!,
              org.admin,
              org.report.email,
              "0000",
              `10.0.4.${i}`,
            )
          ).status,
      ),
    );
    expect(statuses.filter((s) => s === 401)).toHaveLength(3);
    expect(statuses.filter((s) => s === 429)).toHaveLength(7);
    // The lockout holds on the other replica, even for the right PIN.
    const locked = await kioskClock(
      replicas[1]!,
      org.admin,
      org.report.email,
      "8642",
      "10.0.4.99",
    );
    expect(locked.status).toBe(429);
    expect(((await locked.json()) as { code: string }).code).toBe(
      "KIOSK_LOCKED",
    );
  });

  it("checks at most maxFailuresPerIp concurrent PINs from one IP across two replicas (#178)", async () => {
    await db.sql`UPDATE employees SET pin_hash = ${await hashKioskPin("8642")}, pin_salt = NULL WHERE id = ${org.report.employeeId}`;
    const prefix = crypto.randomUUID();
    const replicas = [
      build({ maxFailuresPerIp: 5 }, prefix),
      build({ maxFailuresPerIp: 5 }, prefix),
    ];
    // Distinct unknown identifiers: the per-identifier limit never applies,
    // and each one still checks a PIN (against the decoy hash).
    const statuses = await Promise.all(
      Array.from(
        { length: 40 },
        async (_, i) =>
          (
            await kioskClock(
              replicas[i % 2]!,
              org.admin,
              `nobody-${i}@example.test`,
              "0000",
              "10.0.6.1",
            )
          ).status,
      ),
    );
    expect(statuses.filter((s) => s === 401)).toHaveLength(5);
    expect(statuses.filter((s) => s === 429)).toHaveLength(35);
    // The IP lockout holds on both replicas, even for a correct PIN.
    const locked = await kioskClock(
      replicas[0]!,
      org.admin,
      org.report.email,
      "8642",
      "10.0.6.1",
    );
    expect(locked.status).toBe(429);
    expect(((await locked.json()) as { code: string }).code).toBe(
      "KIOSK_LOCKED",
    );
  });

  it("does not count correct PINs against the IP, even the one reaching the limit (#178)", async () => {
    await db.sql`UPDATE employees SET pin_hash = ${await hashKioskPin("2468")}, pin_salt = NULL WHERE id = ${org.manager.employeeId}`;
    const kiosk = build({ maxFailuresPerIp: 3 });
    const attempt = async (identifier: string, pin: string) =>
      (await kioskClock(kiosk, org.admin, identifier, pin, "10.0.7.1")).status;
    expect([
      await attempt("nobody-a@example.test", "0000"),
      await attempt("nobody-b@example.test", "0000"),
    ]).toEqual([401, 401]);
    // The first of these reaches the limit and lifts the lock it set.
    for (let i = 0; i < 5; i++) {
      expect([401, 429]).not.toContain(
        await attempt(org.manager.email, "2468"),
      );
    }
    // Still two failures counted: the third locks the IP.
    expect(await attempt("nobody-c@example.test", "0000")).toBe(401);
    expect(await attempt("nobody-d@example.test", "0000")).toBe(429);
  });

  it("does not count a locked identifier's refusals against the IP (#178)", async () => {
    await db.sql`UPDATE employees SET pin_hash = ${await hashKioskPin("1357")}, pin_salt = NULL WHERE id = ${org.auditor.employeeId}`;
    const kiosk = build({ maxFailuresPerIdentifier: 2, maxFailuresPerIp: 3 });
    const attempt = async (identifier: string, ip: string) =>
      (await kioskClock(kiosk, org.admin, identifier, "0000", ip)).status;
    expect([
      await attempt(org.auditor.email, "10.0.8.1"),
      await attempt(org.auditor.email, "10.0.8.2"),
    ]).toEqual([401, 401]);
    for (let i = 0; i < 10; i++) {
      expect(await attempt(org.auditor.email, "10.0.8.9")).toBe(429);
    }
    // No PIN was checked from 10.0.8.9, so its budget is untouched.
    expect(await attempt("nobody-e@example.test", "10.0.8.9")).toBe(401);
  });

  it("sends a short Retry-After while an IP lock is fresh (#178)", async () => {
    const kiosk = build({ maxFailuresPerIp: 1 });
    const attempt = (identifier: string) =>
      kioskClock(kiosk, org.admin, identifier, "0000", "10.0.9.1");
    expect((await attempt("nobody-f@example.test")).status).toBe(401);
    // The lock was set milliseconds ago: it may be a correct PIN's, about to
    // be lifted, so a client is not told to wait the whole 15 minutes.
    const refused = await attempt("nobody-g@example.test");
    expect(refused.status).toBe(429);
    const retryAfter = Number(refused.headers.get("Retry-After"));
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(3);
  });

  it("clears an identifier's failures after a correct PIN", async () => {
    await db.sql`UPDATE employees SET pin_hash = ${await hashKioskPin("2468")}, pin_salt = NULL WHERE id = ${org.manager.employeeId}`;
    const prefix = crypto.randomUUID();
    const [a, b] = [
      build({ maxFailuresPerIdentifier: 3 }, prefix),
      build({ maxFailuresPerIdentifier: 3 }, prefix),
    ];
    const attempt = async (target: typeof a, pin: string, i: number) =>
      (
        await kioskClock(
          target,
          org.admin,
          org.manager.email,
          pin,
          `10.0.5.${i}`,
        )
      ).status;
    expect([await attempt(a, "0000", 1), await attempt(b, "0000", 2)]).toEqual([
      401, 401,
    ]);
    // Accepted (the clock event itself may conflict): never a PIN refusal.
    expect([401, 429]).not.toContain(await attempt(b, "2468", 3));
    // Without the reset the second of these would be the 4th failure.
    expect([await attempt(a, "0000", 4), await attempt(b, "0000", 5)]).toEqual([
      401, 401,
    ]);
  });

  it("accepts a legacy SHA-256 PIN once and re-stores it as scrypt", async () => {
    const salt = "00112233445566778899aabbccddeeff";
    await db.sql`
      UPDATE employees
      SET pin_hash = ${legacyKioskPinHashForTests("4321", salt)}, pin_salt = ${salt}
      WHERE id = ${org.peer.employeeId}
    `;

    const first = await kioskClock(
      app,
      org.admin,
      org.peer.email,
      "4321",
      "10.0.3.1",
    );
    expect(first.status).toBe(200);

    const [stored] = await db.sql<
      { pinHash: string; pinSalt: string | null }[]
    >`SELECT pin_hash as "pinHash", pin_salt as "pinSalt" FROM employees WHERE id = ${org.peer.employeeId}`;
    expect(stored?.pinHash).toMatch(/^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
    expect(stored?.pinSalt).toBeNull();

    const second = await kioskClock(
      app,
      org.admin,
      org.peer.email,
      "4321",
      "10.0.3.1",
    );
    expect(second.status).toBe(200);
  });
});
