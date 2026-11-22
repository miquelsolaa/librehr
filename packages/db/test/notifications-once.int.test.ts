import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres, { type Sql } from "postgres";
import {
  createRoleSeparatedDatabase,
  getTestDatabase,
  type RoleSeparatedDatabase,
  type TestDatabase,
} from "@librehr/testing";
import { runMigrations } from "../src/migrate.js";
import { withTenant } from "../src/with-tenant.js";
import { NotificationRepository } from "../src/repositories/notification.repository.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_0032 = fs.readFileSync(
  path.resolve(__dirname, "../migrations/0032_notifications_once.sql"),
  "utf-8",
);

const CATEGORY = "time_missing_clock_out" as const;

// TIM-003: one missing clock-out reminder per user and day, enforced by the
// partial unique index of migration 0032.
describe("NotificationRepository.createOnce (0032)", () => {
  let base: TestDatabase;
  let db: RoleSeparatedDatabase;
  let owner: Sql;
  const repo = new NotificationRepository();
  const orgA = "a3200000-0000-0000-0000-00000000000a";
  const orgB = "b3200000-0000-0000-0000-00000000000b";
  const user = "c3200000-0000-0000-0000-00000000000c";

  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database) throw new Error("Docker is required for createOnce");
    base = database;
    db = await createRoleSeparatedDatabase(base);
    await runMigrations(db.ownerConnectionString);
    owner = postgres(db.ownerConnectionString, { max: 1, onnotice: () => {} });

    await db.adminSql`INSERT INTO organizations (id, name, slug) VALUES
      (${orgA}, 'Once A', 'once-a'), (${orgB}, 'Once B', 'once-b')`;
    await db.adminSql`INSERT INTO users (id, email, name)
      VALUES (${user}, 'once@example.invalid', 'Once')`;
  }, 60000);

  afterAll(async () => {
    if (owner) await owner.end();
    if (db) await db.close();
    if (base) await base.close();
  });

  const reminder = (link: string) => ({
    userId: user,
    title: "Missing clock-out",
    body: "Open",
    category: CATEGORY,
    link,
  });

  const countIn = (orgId: string, link: string) =>
    withTenant(db.appSql, { organizationId: orgId }, async (tx) => {
      const [row] = await tx<{ n: number }[]>`
        SELECT count(*)::int AS n FROM notifications
        WHERE user_id = ${user} AND category = ${CATEGORY} AND link = ${link}`;
      return row!.n;
    });

  it("creates the reminder once and returns null on a re-run", async () => {
    const link = "/time/corrections?date=2026-11-02";
    const first = await withTenant(db.appSql, { organizationId: orgA }, (tx) =>
      repo.createOnce(tx, reminder(link)),
    );
    expect(first).toMatchObject({ organizationId: orgA, link, read: false });
    const again = await withTenant(db.appSql, { organizationId: orgA }, (tx) =>
      repo.createOnce(tx, reminder(link)),
    );
    expect(again).toBeNull();
    expect(await countIn(orgA, link)).toBe(1);
  });

  it("inserts a single row under concurrent callers", async () => {
    const link = "/time/corrections?date=2026-11-03";
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        withTenant(db.appSql, { organizationId: orgA }, (tx) =>
          repo.createOnce(tx, reminder(link)),
        ),
      ),
    );
    expect(results.filter((r) => r !== null)).toHaveLength(1);
    expect(await countIn(orgA, link)).toBe(1);
  });

  it("keys the reminder per organization and leaves other categories free", async () => {
    const link = "/time/corrections?date=2026-11-04";
    for (const orgId of [orgA, orgB]) {
      const created = await withTenant(
        db.appSql,
        { organizationId: orgId },
        (tx) => repo.createOnce(tx, reminder(link)),
      );
      expect(created?.organizationId).toBe(orgId);
    }
    expect(await countIn(orgA, link)).toBe(1);
    expect(await countIn(orgB, link)).toBe(1);

    // The index is partial: other categories may repeat a link.
    await withTenant(db.appSql, { organizationId: orgA }, async (tx) => {
      for (let i = 0; i < 2; i++) {
        await repo.create(tx, {
          userId: user,
          title: "Decision",
          body: "Updated",
          category: "leave_decision",
          link: "/time-off/requests/1",
        });
      }
    });
    const [others] = await withTenant(
      db.appSql,
      { organizationId: orgA },
      (tx) => tx<{ n: number }[]>`
        SELECT count(*)::int AS n FROM notifications
        WHERE category = 'leave_decision' AND link = '/time-off/requests/1'`,
    );
    expect(others?.n).toBe(2);
  });

  it("dedupes existing reminders before creating the index, as the owner role", async () => {
    const link = "/time/corrections?date=2026-11-05";
    // Simulate a database from before 0032 that somehow holds duplicates.
    await owner`DROP INDEX notifications_missing_clock_out_once`;
    const ids = await withTenant(
      db.appSql,
      { organizationId: orgA },
      async (tx) => {
        const created: string[] = [];
        for (let i = 0; i < 3; i++) {
          const row = await repo.create(tx, {
            ...reminder(link),
            body: `#${i}`,
          });
          created.push(row.id);
        }
        return created;
      },
    );
    await withTenant(db.appSql, { organizationId: orgB }, (tx) =>
      repo.create(tx, reminder(link)),
    );
    expect(await countIn(orgA, link)).toBe(3);

    // The runner wraps each migration in a transaction; do the same.
    await owner.begin((tx) => tx.unsafe(MIGRATION_0032));

    const kept = await withTenant(
      db.appSql,
      { organizationId: orgA },
      (tx) => tx<{ id: string }[]>`
        SELECT id FROM notifications
        WHERE user_id = ${user} AND category = ${CATEGORY} AND link = ${link}`,
    );
    // All three share one transaction's created_at, so the id breaks the tie.
    expect(kept.map((r) => r.id)).toEqual([[...ids].sort()[0]]);
    expect(await countIn(orgB, link)).toBe(1);
    // Rows of other categories are untouched.
    const [others] = await withTenant(
      db.appSql,
      { organizationId: orgA },
      (tx) => tx<{ n: number }[]>`
        SELECT count(*)::int AS n FROM notifications WHERE category = 'leave_decision'`,
    );
    expect(others?.n).toBe(2);

    // The index is back and FORCE ROW LEVEL SECURITY is on again.
    const again = await withTenant(db.appSql, { organizationId: orgA }, (tx) =>
      repo.createOnce(tx, reminder(link)),
    );
    expect(again).toBeNull();
    const [rls] = await db.adminSql<{ forced: boolean }[]>`
      SELECT relforcerowsecurity AS forced FROM pg_class WHERE relname = 'notifications'`;
    expect(rls?.forced).toBe(true);
  });
});
