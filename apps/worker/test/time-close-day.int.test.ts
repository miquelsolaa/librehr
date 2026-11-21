import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getTestDatabase, type TestDatabase } from "@librehr/testing";
import { runMigrations } from "@librehr/db/migrate";
import {
  TimeRepository,
  withTenant,
  type Sql,
  type TimeEventKind,
} from "@librehr/db";
import { computeEventHashV2 } from "@librehr/core";
import {
  handleTimeCloseDay,
  MISSING_CLOCK_OUT_CATEGORY,
} from "../src/queues/time.close-day.js";

const KEY = "worker_test_time_chain_key_32_chars_min";
const DAY = "2026-11-02";

describe("time.close-day (TIM-003)", () => {
  let db: TestDatabase;
  let app: Sql;
  const repo = new TimeRepository();

  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database) throw new Error("Docker is required for close-day");
    db = database;
    await runMigrations(db.connectionString);
    app = await db.appSql();
  }, 90000);

  afterAll(async () => {
    if (db) await db.close();
  });

  async function newOrg(defaultLocale = "en") {
    const orgId = randomUUID();
    await db.sql`
      INSERT INTO organizations (id, name, slug, timezone, default_locale)
      VALUES (${orgId}, 'Close', ${`close-${orgId.slice(0, 8)}`}, 'Europe/Madrid', ${defaultLocale})
    `;
    return orgId;
  }

  async function addEmployee(
    orgId: string,
    opts: { withUser?: boolean; locationId?: string } = {},
  ) {
    const employeeId = randomUUID();
    let userId: string | null = null;
    if (opts.withUser !== false) {
      const [user] = await db.sql<{ id: string }[]>`
        INSERT INTO users (email, name)
        VALUES (${`${employeeId}@example.invalid`}, 'Close Worker')
        RETURNING id
      `;
      userId = user!.id;
    }
    await db.sql`
      INSERT INTO employees (id, organization_id, user_id, location_id, first_name, last_name, email)
      VALUES (${employeeId}, ${orgId}, ${userId}, ${opts.locationId ?? null},
              'Close', 'Worker', ${`${employeeId}@example.invalid`})
    `;
    return { employeeId, userId };
  }

  async function punch(
    orgId: string,
    employeeId: string,
    eventType: TimeEventKind,
    occurredAt: string,
  ) {
    await withTenant(app, { organizationId: orgId }, (tx) =>
      repo.appendEvent(tx, (link) => computeEventHashV2(KEY, link), {
        organizationId: orgId,
        employeeId,
        eventType,
        occurredAt: new Date(occurredAt),
        source: "web",
        actorId: employeeId,
      }),
    );
  }

  const run = (organizationId: string, closeDate = DAY) => {
    const logger = { info: vi.fn() };
    return {
      logger,
      result: handleTimeCloseDay(
        { id: "job-close", data: { organizationId, closeDate } },
        { sql: app, logger },
      ),
    };
  };

  const notificationsOf = (userId: string) =>
    db.sql<{ category: string; link: string; title: string; body: string }[]>`
      SELECT category, link, title, body FROM notifications
      WHERE user_id = ${userId}
    `;

  const eventCount = async (orgId: string) =>
    (
      await db.sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM time_events WHERE organization_id = ${orgId}
      `
    )[0]!.n;

  it("notifies only employees left clocked in that day, once", async () => {
    const orgId = await newOrg();
    const open = await addEmployee(orgId);
    const closed = await addEmployee(orgId);
    const otherDay = await addEmployee(orgId);
    const noUser = await addEmployee(orgId, { withUser: false });
    await punch(orgId, open.employeeId, "clock_in", "2026-11-02T08:00:00Z");
    await punch(orgId, open.employeeId, "break_start", "2026-11-02T12:00:00Z");
    await punch(orgId, closed.employeeId, "clock_in", "2026-11-02T08:00:00Z");
    await punch(orgId, closed.employeeId, "clock_out", "2026-11-02T16:00:00Z");
    await punch(orgId, otherDay.employeeId, "clock_in", "2026-11-03T08:00:00Z");
    await punch(orgId, noUser.employeeId, "clock_in", "2026-11-02T08:00:00Z");
    const eventsBefore = await eventCount(orgId);

    const { result, logger } = run(orgId);
    expect(await result).toEqual({
      organizationId: orgId,
      closeDate: DAY,
      employeesChecked: 2,
      open: 1,
      notified: 1,
    });
    expect(await notificationsOf(open.userId!)).toEqual([
      {
        category: MISSING_CLOCK_OUT_CATEGORY,
        link: `/time/corrections?date=${DAY}`,
        title: "Missing clock-out",
        body: `Your time record for ${DAY} is still open. Request a correction with the time you finished.`,
      },
    ]);
    expect(await notificationsOf(closed.userId!)).toEqual([]);
    expect(await notificationsOf(otherDay.userId!)).toEqual([]);
    // Logs carry ids and counts only.
    const logged = JSON.stringify(logger.info.mock.calls);
    expect(logged).not.toContain("example.invalid");
    expect(logged).not.toContain("Close");

    const again = await run(orgId).result;
    expect(again).toMatchObject({ open: 1, notified: 0 });
    expect(await notificationsOf(open.userId!)).toHaveLength(1);
    // Never writes time events.
    expect(await eventCount(orgId)).toBe(eventsBefore);
  });

  it("leaves another organization untouched under RLS", async () => {
    const orgA = await newOrg();
    const orgB = await newOrg();
    const a = await addEmployee(orgA);
    const b = await addEmployee(orgB);
    await punch(orgA, a.employeeId, "clock_in", "2026-11-02T08:00:00Z");
    await punch(orgB, b.employeeId, "clock_in", "2026-11-02T08:00:00Z");

    expect(await run(orgA).result).toMatchObject({
      employeesChecked: 1,
      notified: 1,
    });
    expect(await notificationsOf(a.userId!)).toHaveLength(1);
    expect(await notificationsOf(b.userId!)).toEqual([]);
  });

  it("uses the location time zone and the organization locale", async () => {
    const orgId = await newOrg("es");
    const [canary] = await db.sql<{ id: string }[]>`
      INSERT INTO locations (organization_id, name, city, timezone)
      VALUES (${orgId}, 'Las Palmas', 'Las Palmas', 'Atlantic/Canary')
      RETURNING id`;
    const madrid = await addEmployee(orgId);
    const islands = await addEmployee(orgId, { locationId: canary!.id });
    // 23:30 on 2 Nov in the Canaries, 00:30 on 3 Nov in Madrid.
    for (const p of [madrid, islands]) {
      await punch(orgId, p.employeeId, "clock_in", "2026-11-02T23:30:00Z");
    }

    expect(await run(orgId).result).toMatchObject({ notified: 1 });
    expect(await notificationsOf(madrid.userId!)).toEqual([]);
    const [notice] = await notificationsOf(islands.userId!);
    expect(notice?.title).toBe("Falta el fichaje de salida");

    // The Madrid employee's day is 3 Nov.
    expect(await run(orgId, "2026-11-03").result).toMatchObject({
      notified: 1,
    });
    expect(await notificationsOf(madrid.userId!)).toHaveLength(1);
  });
});
