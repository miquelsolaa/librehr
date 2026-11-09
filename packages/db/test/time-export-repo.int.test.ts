import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import { getTestDatabase, type TestDatabase } from "@librehr/testing";
import { runMigrations } from "../src/migrate.js";
import { withTenant } from "../src/with-tenant.js";
import { EmployeeRepository } from "../src/repositories/employee.repository.js";
import {
  TimeRepository,
  type TimeChainSigner,
} from "../src/repositories/time.repository.js";

// TIM-006 reads: who an organization export lists, and the bounded event
// window with its TIM-003 correction links. Run on the app role (RLS on).
const sign: TimeChainSigner = (link) =>
  createHash("sha256").update(JSON.stringify(link)).digest("hex");

describe("TIM-006 export repositories", () => {
  let db: TestDatabase;
  let app: Sql;
  const employees = new EmployeeRepository();
  const time = new TimeRepository();
  const orgId = randomUUID();
  const ids: Record<string, string> = {};

  const addEmployee = async (
    label: string,
    opts: { terminationDate?: string; locationId?: string } = {},
  ) => {
    const id = randomUUID();
    ids[label] = id;
    await db.sql`
      INSERT INTO employees (id, organization_id, first_name, last_name, email, termination_date, location_id)
      VALUES (${id}, ${orgId}, 'Repo', ${label}, ${`${label}@fixture.invalid`},
              ${opts.terminationDate ?? null}, ${opts.locationId ?? null})`;
    return id;
  };
  const employment = (employeeId: string, start: string, end: string | null) =>
    db.sql`
      INSERT INTO employments (organization_id, employee_id, job_title, start_date, end_date)
      VALUES (${orgId}, ${employeeId}, 'Clerk', ${start}, ${end})`;
  const punch = (
    employeeId: string,
    at: string,
    eventType: "clock_in" | "clock_out" = "clock_in",
    refEventId?: string,
  ) =>
    withTenant(app, { organizationId: orgId }, (tx) =>
      time.appendEvent(tx, sign, {
        organizationId: orgId,
        employeeId,
        eventType,
        occurredAt: new Date(at),
        source: refEventId ? "manual" : "web",
        actorId: employeeId,
        refEventId,
        reason: refEventId ? "Wrong time" : undefined,
      }),
    );

  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database) throw new Error("Docker is required for this suite");
    db = database;
    await runMigrations(db.connectionString);
    app = await db.appSql();
    await db.sql`
      INSERT INTO organizations (id, name, slug, timezone)
      VALUES (${orgId}, 'Export Repo Org', ${`export-repo-${orgId.slice(0, 8)}`}, 'Europe/Madrid')`;
    const [canary] = await db.sql<{ id: string }[]>`
      INSERT INTO locations (organization_id, name, city, timezone)
      VALUES (${orgId}, 'Las Palmas', 'Las Palmas', 'Atlantic/Canary') RETURNING id`;

    // Period: 2026-11-02 to 2026-11-04.
    await employment(await addEmployee("current"), "2026-01-01", null);
    await employment(await addEmployee("hiredAfter"), "2026-11-05", null);
    await employment(await addEmployee("lastDayOnly"), "2026-11-04", null);
    await employment(
      await addEmployee("leftOnStart", { terminationDate: "2026-11-02" }),
      "2025-01-01",
      "2026-11-02",
    );
    // Re-hired: the stale termination date predates the period.
    const rehired = await addEmployee("rehired", {
      terminationDate: "2025-06-30",
    });
    await employment(rehired, "2024-01-01", "2025-06-30");
    await employment(rehired, "2026-10-01", null);
    await employment(
      await addEmployee("leftBefore", { terminationDate: "2026-10-31" }),
      "2025-01-01",
      "2026-10-31",
    );
    await addEmployee("noRecord");
    await addEmployee("noRecordLeft", { terminationDate: "2026-11-01" });
    // HR data says "not yet hired", but work was recorded in the period:
    // 23:30 UTC on 1 Nov is 00:30 on 2 Nov in Madrid.
    const punchedMadrid = await addEmployee("punchedMadrid");
    await employment(punchedMadrid, "2026-12-01", null);
    await punch(punchedMadrid, "2026-11-01T23:30:00Z");
    // ...and still 1 Nov in Canary: outside the period there.
    const punchedCanary = await addEmployee("punchedCanary", {
      locationId: canary!.id,
    });
    await employment(punchedCanary, "2026-12-01", null);
    await punch(punchedCanary, "2026-11-01T23:30:00Z");
  }, 60000);

  afterAll(async () => {
    if (db) await db.close();
  });

  it("lists who was employed or worked during the period", async () => {
    const rows = await withTenant(app, { organizationId: orgId }, (tx) =>
      employees.listEmployedDuring(tx, "2026-11-02", "2026-11-04"),
    );
    const listed = new Set(rows.map((r) => r.lastName));
    const expected = {
      current: true,
      hiredAfter: false,
      lastDayOnly: true,
      leftOnStart: true,
      rehired: true,
      leftBefore: false,
      noRecord: true,
      noRecordLeft: false,
      punchedMadrid: true,
      punchedCanary: false,
    };
    for (const [label, included] of Object.entries(expected)) {
      expect([label, listed.has(label)]).toEqual([label, included]);
    }
    expect(rows.find((r) => r.lastName === "current")?.id).toBe(ids["current"]);
  });

  it("loads the window plus the corrections linked to it, in both directions", async () => {
    const employeeId = await addEmployee("window");
    const before = await punch(employeeId, "2026-11-10T16:00:00Z", "clock_out");
    const inside = await punch(employeeId, "2026-11-12T08:00:00Z");
    const insideOut = await punch(
      employeeId,
      "2026-11-12T16:00:00Z",
      "clock_out",
    );
    await punch(employeeId, "2026-11-20T08:00:00Z"); // unrelated, outside
    // A correction inside the window of an original before it.
    const fixesBefore = await punch(
      employeeId,
      "2026-11-12T17:00:00Z",
      "clock_out",
      before.id,
    );
    // A correction after the window of an original inside it, and its own
    // correction (a chain of two).
    const movesOut = await punch(
      employeeId,
      "2026-11-21T16:00:00Z",
      "clock_out",
      insideOut.id,
    );
    const movesOutAgain = await punch(
      employeeId,
      "2026-11-22T16:00:00Z",
      "clock_out",
      movesOut.id,
    );

    const rows = await withTenant(app, { organizationId: orgId }, (tx) =>
      time.getEventsForPeriod(
        tx,
        employeeId,
        "2026-11-11T23:00:00Z",
        "2026-11-12T23:00:00Z",
      ),
    );
    expect(rows.map((r) => r.id)).toEqual([
      before.id,
      inside.id,
      insideOut.id,
      fixesBefore.id,
      movesOut.id,
      movesOutAgain.id,
    ]);
  });

  it("returns nothing for another employee's window", async () => {
    const rows = await withTenant(app, { organizationId: orgId }, (tx) =>
      time.getEventsForPeriod(
        tx,
        randomUUID(),
        "2026-11-01T00:00:00Z",
        "2026-12-01T00:00:00Z",
      ),
    );
    expect(rows).toEqual([]);
  });
});
