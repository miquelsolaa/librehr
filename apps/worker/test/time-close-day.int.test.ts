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
    return withTenant(app, { organizationId: orgId }, (tx) =>
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
    const logger = { info: vi.fn(), error: vi.fn() };
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
      overnight: 0,
      notified: 1,
      failed: 0,
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

  // Smoke test: the two runs share a pool and may serialize; the concurrent
  // proof is in packages/db/test/notifications-once.int.test.ts.
  it("creates one reminder for two overlapping runs (unique index, 0032)", async () => {
    const orgId = await newOrg();
    const open = await addEmployee(orgId);
    await punch(orgId, open.employeeId, "clock_in", "2026-11-02T08:00:00Z");

    const reports = await Promise.all([run(orgId).result, run(orgId).result]);
    expect(reports.map((r) => r.open)).toEqual([1, 1]);
    expect(reports.reduce((n, r) => n + r.notified, 0)).toBe(1);
    expect(await notificationsOf(open.userId!)).toHaveLength(1);
  });

  it("does not remind an employee on a rostered night shift", async () => {
    const orgId = await newOrg();
    const shift = async (
      code: string,
      type: string,
      startTime: string,
      endTime: string,
    ) =>
      (
        await db.sql<{ id: string }[]>`
          INSERT INTO shift_templates (organization_id, name, code, type, start_time, end_time)
          VALUES (${orgId}, ${code}, ${code}, ${type}, ${startTime}, ${endTime})
          RETURNING id`
      )[0]!.id;
    const night = await shift("N", "night", "22:00", "06:00");
    const afternoon = await shift("T", "afternoon", "14:00", "22:00");
    const assign = (employeeId: string, date: string, templateId: string) =>
      db.sql`
        INSERT INTO shift_assignments (organization_id, employee_id, date, shift_template_id)
        VALUES (${orgId}, ${employeeId}, ${date}, ${templateId})`;

    const onNight = await addEmployee(orgId);
    const onAfternoon = await addEmployee(orgId);
    const carriedOver = await addEmployee(orgId);
    await assign(onNight.employeeId, DAY, night);
    await assign(onAfternoon.employeeId, DAY, afternoon);
    await assign(carriedOver.employeeId, "2026-11-01", night);
    await assign(carriedOver.employeeId, DAY, night);
    // 22:00 local (CET) on the day, still open at midnight.
    await punch(orgId, onNight.employeeId, "clock_in", "2026-11-02T21:00:00Z");
    await punch(
      orgId,
      onAfternoon.employeeId,
      "clock_in",
      "2026-11-02T13:00:00Z",
    );
    // The 1 Nov night shift never clocked out; a break on 2 Nov keeps the
    // session the same one, so it is not the 2 Nov night shift.
    await punch(
      orgId,
      carriedOver.employeeId,
      "clock_in",
      "2026-11-01T21:00:00Z",
    );
    await punch(
      orgId,
      carriedOver.employeeId,
      "break_start",
      "2026-11-02T02:00:00Z",
    );

    expect(await run(orgId).result).toMatchObject({
      employeesChecked: 3,
      open: 2,
      overnight: 1,
      notified: 2,
    });
    expect(await notificationsOf(onNight.userId!)).toEqual([]);
    expect(await notificationsOf(onAfternoon.userId!)).toHaveLength(1);
    expect(await notificationsOf(carriedOver.userId!)).toHaveLength(1);

    // The night shift ends the next morning and the next day's run is quiet.
    await punch(orgId, onNight.employeeId, "clock_out", "2026-11-03T05:00:00Z");
    expect(await run(orgId, "2026-11-03").result).toMatchObject({
      open: 0,
      overnight: 0,
    });
    expect(await notificationsOf(onNight.userId!)).toEqual([]);
  });

  async function roster(orgId: string) {
    const template = async (type: string, startTime: string, endTime: string) =>
      (
        await db.sql<{ id: string }[]>`
          INSERT INTO shift_templates (organization_id, name, code, type, start_time, end_time)
          VALUES (${orgId}, ${type}, ${type.slice(0, 3)}, ${type}, ${startTime}, ${endTime})
          RETURNING id`
      )[0]!.id;
    const assign = (
      employeeId: string,
      date: string,
      templateId: string | null,
    ) =>
      db.sql`
        INSERT INTO shift_assignments (organization_id, employee_id, date, shift_template_id)
        VALUES (${orgId}, ${employeeId}, ${date}, ${templateId})`;
    return { template, assign };
  }

  it("reminds a night worker who never clocks out on the next day", async () => {
    const orgId = await newOrg();
    const { template, assign } = await roster(orgId);
    const night = await template("night", "22:00", "06:00");
    const worker = await addEmployee(orgId);
    await assign(worker.employeeId, DAY, night);
    await punch(orgId, worker.employeeId, "clock_in", "2026-11-02T21:00:00Z");

    expect(await run(orgId).result).toMatchObject({
      overnight: 1,
      notified: 0,
    });
    expect(await notificationsOf(worker.userId!)).toEqual([]);

    // No event at all on 3 Nov: still listed and reminded.
    expect(await run(orgId, "2026-11-03").result).toMatchObject({
      employeesChecked: 1,
      open: 1,
      overnight: 0,
      notified: 1,
    });
    const notices = await notificationsOf(worker.userId!);
    expect(notices.map((n) => n.link)).toEqual([
      "/time/corrections?date=2026-11-03",
    ]);
  });

  it("still reminds on a rest day or a day off in the roster", async () => {
    const orgId = await newOrg();
    const { template, assign } = await roster(orgId);
    // A rest template shaped like a night shift must not suppress anything.
    const rest = await template("rest", "22:00", "06:00");
    const onRest = await addEmployee(orgId);
    const dayOff = await addEmployee(orgId);
    await assign(onRest.employeeId, DAY, rest);
    await assign(dayOff.employeeId, DAY, null);
    for (const p of [onRest, dayOff]) {
      await punch(orgId, p.employeeId, "clock_in", "2026-11-02T21:00:00Z");
    }

    expect(await run(orgId).result).toMatchObject({
      open: 2,
      overnight: 0,
      notified: 2,
    });
  });

  it("falls back to ca for an unsupported organization locale", async () => {
    const orgId = await newOrg("fr");
    const p = await addEmployee(orgId);
    await punch(orgId, p.employeeId, "clock_in", "2026-11-02T08:00:00Z");

    expect(await run(orgId).result).toMatchObject({ notified: 1 });
    const [notice] = await notificationsOf(p.userId!);
    expect(notice?.title).toBe("Falta el fitxatge de sortida");
  });

  it("skips an employee with a malformed chain and still notifies the rest", async () => {
    const orgId = await newOrg();
    const broken = await addEmployee(orgId);
    const open = await addEmployee(orgId);
    await punch(orgId, broken.employeeId, "clock_in", "2026-11-02T08:00:00Z");
    const other = await punch(
      orgId,
      open.employeeId,
      "clock_in",
      "2026-11-02T08:00:00Z",
    );
    // A correction referencing another employee's event, which the write
    // path refuses. Stored as a legacy v1 row (no seq) with the append-only
    // trigger skipped, as only direct SQL could; the FK still holds.
    await db.sql.begin(async (tx) => {
      await tx`SET LOCAL session_replication_role = replica`;
      await tx`
        INSERT INTO time_events (organization_id, employee_id, event_type, occurred_at, actor_id, ref_event_id, reason, prev_hash, hash, hash_version)
        VALUES (${orgId}, ${broken.employeeId}, 'correction', '2026-11-02T09:00:00Z',
                ${broken.employeeId}, ${other.id}, 'note', NULL, 'forged', 1)
      `;
    });

    const { result, logger } = run(orgId);
    expect(await result).toMatchObject({ notified: 1, failed: 1 });
    expect(await notificationsOf(open.userId!)).toHaveLength(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ employeeId: broken.employeeId }),
    );
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
