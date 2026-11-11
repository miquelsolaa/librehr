import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import { getTestDatabase, type TestDatabase } from "@librehr/testing";
import { runMigrations } from "../src/migrate.js";
import { withTenant } from "../src/with-tenant.js";

// TIM-006: migration 0027 indexes the export reads of
// TimeRepository.getEventsForPeriod (the employee/period window and the
// correction links it follows).
describe("time_events export indexes (0027)", () => {
  let db: TestDatabase;
  let app: Sql;
  const orgId = randomUUID();

  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database) throw new Error("Docker is required for this suite");
    db = database;
    await runMigrations(db.connectionString);
    app = await db.appSql();
    await db.sql`
      INSERT INTO organizations (id, name, slug, timezone)
      VALUES (${orgId}, 'Index Org', ${`index-org-${orgId.slice(0, 8)}`}, 'Europe/Madrid')`;
  }, 60000);

  afterAll(async () => {
    if (db) await db.close();
  });

  it("creates both indexes with the expected definitions", async () => {
    const rows = await db.sql<{ indexname: string; indexdef: string }[]>`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'time_events'
        AND indexname IN ('time_events_employee_occurred_idx', 'time_events_ref_event_idx')
      ORDER BY indexname`;
    expect(rows).toEqual([
      {
        indexname: "time_events_employee_occurred_idx",
        indexdef:
          "CREATE INDEX time_events_employee_occurred_idx ON public.time_events USING btree (employee_id, occurred_at)",
      },
      {
        indexname: "time_events_ref_event_idx",
        indexdef:
          "CREATE INDEX time_events_ref_event_idx ON public.time_events USING btree (ref_event_id) WHERE (ref_event_id IS NOT NULL)",
      },
    ]);
  });

  it("drops the single-column employee index the composite covers (0028)", async () => {
    const rows = await db.sql<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'time_events'
        AND indexname = 'time_events_employee_idx'`;
    expect(rows).toEqual([]);
  });

  it("serves the export window (employee + occurred_at range) from the composite index", async () => {
    // With sequential scans disabled the planner must pick an index; among
    // the candidates only the composite one covers both predicates, so this
    // holds on an empty table. Whether the planner uses the partial
    // ref_event_id index in the recursive step depends on table statistics,
    // so that index is asserted by existence only (test above).
    const plan = await withTenant(
      app,
      { organizationId: orgId },
      async (tx) => {
        await tx`SET LOCAL enable_seqscan = off`;
        const rows = await tx<{ "QUERY PLAN": string }[]>`
        EXPLAIN SELECT id, ref_event_id FROM time_events
        WHERE employee_id = ${randomUUID()}
          AND occurred_at >= ${"2026-11-01T00:00:00Z"}::timestamptz
          AND occurred_at < ${"2026-12-01T00:00:00Z"}::timestamptz`;
        return rows.map((r) => r["QUERY PLAN"]).join("\n");
      },
    );
    expect(plan).toContain("time_events_employee_occurred_idx");
  });
});
