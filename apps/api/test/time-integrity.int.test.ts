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
import { as, fixtureAuthPort } from "./support/fixture-app.js";

const KEY = "api_test_time_chain_key_at_least_32_chars";

describe("time-record integrity and kiosk (TIM-002, TIM-003, TIM-010)", () => {
  let db: TestDatabase;
  let appSql: Sql;
  let org: ScopedOrgFixture;
  let app: ReturnType<typeof createApp>;

  const build = (kiosk?: { maxFailuresPerIdentifier: number }) =>
    createApp({
      sql: appSql,
      authPort: fixtureAuthPort([
        org.admin,
        org.manager,
        org.report,
        org.peer,
        org.auditor,
      ]),
      timeChainKey: KEY,
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
