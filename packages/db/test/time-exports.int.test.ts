import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres, { type Sql } from "postgres";
import {
  createRoleSeparatedDatabase,
  getTestDatabase,
  type RoleSeparatedDatabase,
  type TestDatabase,
} from "@librehr/testing";
import { runMigrations } from "../src/migrate.js";
import { withTenant, type TenantTx } from "../src/with-tenant.js";
import { TimeExportRepository } from "../src/repositories/time-export.repository.js";

// TIM-006 (#38): background export rows (migration 0045). The API role
// requests and reads; only the worker's owner role updates and stores the
// file bytes (time_export_files, under RLS); the dispatch function is the
// owner's only cross-tenant read and returns ids only.
describe("time_exports (0045)", () => {
  let base: TestDatabase;
  let db: RoleSeparatedDatabase;
  let owner: Sql;
  const repo = new TimeExportRepository();
  const orgA = "a4500000-0000-4000-8000-00000000000a";
  const orgB = "b4500000-0000-4000-8000-00000000000b";
  const alice = "c4500000-0000-4000-8000-00000000000c";
  const bob = "d4500000-0000-4000-8000-00000000000d";
  const hash = "a".repeat(64);

  const request = (requestedBy: string) => ({
    requestedBy,
    format: "csv" as const,
    locale: "es" as const,
    periodStart: "2026-01-01",
    periodEnd: "2026-12-31",
    employeeDays: 120_000,
  });
  const asApp = <T>(org: string, fn: (tx: TenantTx) => Promise<T>) =>
    withTenant(db.appSql, { organizationId: org }, fn);
  const asOwner = <T>(org: string, fn: (tx: TenantTx) => Promise<T>) =>
    withTenant(owner, { organizationId: org }, fn);

  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database) throw new Error("Docker is required for time_exports");
    base = database;
    db = await createRoleSeparatedDatabase(base);
    await runMigrations(db.ownerConnectionString);
    owner = postgres(db.ownerConnectionString, { max: 2, onnotice: () => {} });
    await db.adminSql`INSERT INTO organizations (id, name, slug) VALUES
      (${orgA}, 'Exports A', 'exports-a'), (${orgB}, 'Exports B', 'exports-b')`;
  }, 60000);

  afterAll(async () => {
    if (owner) await owner.end();
    if (db) await db.close();
    if (base) await base.close();
  });

  it("queues one active export per requester and shows it only to that requester", async () => {
    const created = await asApp(orgA, (tx) => repo.create(tx, request(alice)));
    expect(created).toMatchObject({
      organizationId: orgA,
      requestedBy: alice,
      scope: "organization",
      status: "queued",
      attempts: 0,
      periodStart: "2026-01-01",
      periodEnd: "2026-12-31",
      contentHash: null,
      byteSize: null,
    });
    const id = created!.id;

    // A second request while the first is queued is refused, not queued.
    expect(
      await asApp(orgA, (tx) => repo.create(tx, request(alice))),
    ).toBeNull();
    expect(await asApp(orgA, (tx) => repo.countActive(tx))).toBe(1);

    expect(
      await asApp(orgA, (tx) => repo.findForRequester(tx, id, alice)),
    ).toMatchObject({ id });
    expect(
      await asApp(orgA, (tx) => repo.findForRequester(tx, id, bob)),
    ).toBeNull();
    expect(
      (await asApp(orgA, (tx) => repo.listForRequester(tx, alice, 10))).map(
        (row) => row.id,
      ),
    ).toEqual([id]);
  });

  it("hides another tenant's exports and refuses writes into it", async () => {
    const [row] = await asApp(orgA, (tx) =>
      repo.listForRequester(tx, alice, 1),
    );
    expect(
      await asApp(orgB, (tx) => repo.findForRequester(tx, row!.id, alice)),
    ).toBeNull();
    expect(await asApp(orgB, (tx) => repo.countActive(tx))).toBe(0);
    expect(await asOwner(orgB, (tx) => repo.claim(tx, row!.id))).toBeNull();

    await expect(
      asApp(
        orgB,
        (tx) => tx`
        INSERT INTO time_exports (organization_id, requested_by, format, locale,
          period_start, period_end, employee_days)
        VALUES (${orgA}, ${bob}, 'csv', 'es', '2026-01-01', '2026-01-31', 10)`,
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("does not let the runtime role update or delete rows", async () => {
    const [row] = await asApp(orgA, (tx) =>
      repo.listForRequester(tx, alice, 1),
    );
    await expect(asApp(orgA, (tx) => repo.claim(tx, row!.id))).rejects.toThrow(
      /permission denied/i,
    );
    await expect(
      asApp(orgA, (tx) => tx`DELETE FROM time_exports WHERE id = ${row!.id}`),
    ).rejects.toThrow(/permission denied/i);
  });

  it("dispatches queued ids across tenants to the owner only, ids and nothing else", async () => {
    const queuedB = await asApp(orgB, (tx) => repo.create(tx, request(bob)));
    const [rowA] = await asApp(orgA, (tx) =>
      repo.listForRequester(tx, alice, 1),
    );

    expect(await repo.listQueued(owner, 50)).toEqual([
      { exportId: rowA!.id, organizationId: orgA },
      { exportId: queuedB!.id, organizationId: orgB },
    ]);
    expect(await repo.listQueued(owner, 1)).toHaveLength(1);
    const [raw] = await owner<Record<string, unknown>[]>`
      SELECT * FROM librehr_queued_time_exports(1)`;
    expect(Object.keys(raw!).sort()).toEqual(["export_id", "organization_id"]);

    // Outside the function the owner sees no rows without a tenant context,
    // and the setting gives the runtime role nothing.
    const [own] = await owner<{ n: number }[]>`
      SELECT count(*)::int AS n FROM time_exports`;
    expect(own?.n).toBe(0);
    const appCount = await db.appSql.begin(async (tx) => {
      await tx`SELECT set_config('librehr.export_dispatch', 'on', true)`;
      return tx<{ n: number }[]>`SELECT count(*)::int AS n FROM time_exports`;
    });
    expect(appCount[0]?.n).toBe(0);
    await expect(
      db.appSql`SELECT * FROM librehr_queued_time_exports(10)`,
    ).rejects.toThrow(/permission denied/i);

    const [fn] = await db.adminSql<
      {
        prosecdef: boolean;
        proconfig: string[];
        owner: string;
        public_exec: boolean;
      }[]
    >`
      SELECT p.prosecdef, p.proconfig, pg_get_userbyid(p.proowner) AS owner,
             has_function_privilege('public', p.oid, 'EXECUTE') AS public_exec
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'librehr_queued_time_exports'`;
    expect(fn).toEqual({
      prosecdef: true,
      proconfig: ["search_path=pg_catalog, public"],
      owner: "librehr_owner",
      public_exec: false,
    });
  });

  it("runs claim, ready, expiry and failure for the owner, idempotently", async () => {
    const [rowA] = await asApp(orgA, (tx) =>
      repo.listForRequester(tx, alice, 1),
    );
    const id = rowA!.id;

    const claimed = await asOwner(orgA, (tx) => repo.claim(tx, id));
    expect(claimed).toMatchObject({ status: "running", attempts: 1 });
    expect(claimed?.startedAt).toBeInstanceOf(Date);
    // A redelivered job may claim a running row again (re-drive).
    expect(await asOwner(orgA, (tx) => repo.claim(tx, id))).toMatchObject({
      attempts: 2,
    });

    const expiresAt = new Date("2026-02-01T00:00:00Z");
    const content = new TextEncoder().encode("a;b\n1;2\n");
    const ready = await asOwner(orgA, (tx) =>
      repo.markReady(tx, id, {
        contentHash: hash,
        employeeCount: 330,
        content,
        expiresAt,
      }),
    );
    expect(ready).toMatchObject({
      status: "ready",
      contentHash: hash,
      employeeCount: 330,
      byteSize: content.byteLength,
      expiresAt,
    });

    // The bytes are readable by the requester only, before expiry, and only
    // in the export's own tenant.
    const before = new Date("2026-01-31T23:59:59Z");
    expect(
      await asApp(orgA, (tx) => repo.readFile(tx, id, alice, before)),
    ).toEqual(content);
    expect(
      await asApp(orgA, (tx) => repo.readFile(tx, id, bob, before)),
    ).toBeNull();
    expect(
      await asApp(orgB, (tx) => repo.readFile(tx, id, alice, before)),
    ).toBeNull();
    expect(
      await asApp(orgA, (tx) => repo.readFile(tx, id, alice, expiresAt)),
    ).toBeNull();
    const [otherTenant] = await asApp(
      orgB,
      (tx) => tx<{ n: number }[]>`
        SELECT count(*)::int AS n FROM time_export_files`,
    );
    expect(otherTenant?.n).toBe(0);
    // Ready is final for the job: no second claim, ready or failure.
    expect(await asOwner(orgA, (tx) => repo.claim(tx, id))).toBeNull();
    expect(
      await asOwner(orgA, (tx) => repo.markFailed(tx, id, "EXPORT_FAILED")),
    ).toBeNull();
    // The requester may queue another one now.
    expect(
      await asApp(orgA, (tx) => repo.create(tx, request(alice))),
    ).not.toBeNull();

    expect(
      await asOwner(orgA, (tx) =>
        repo.listExpired(tx, new Date("2026-01-31T23:59:59Z"), 10),
      ),
    ).toEqual([]);
    expect(
      await asOwner(orgA, (tx) => repo.listExpired(tx, expiresAt, 10)),
    ).toEqual([id]);
    expect(await asOwner(orgA, (tx) => repo.markExpired(tx, id))).toBe(true);
    expect(await asOwner(orgA, (tx) => repo.markExpired(tx, id))).toBe(false);
    expect(
      await asApp(orgA, (tx) => repo.findForRequester(tx, id, alice)),
    ).toMatchObject({ status: "expired", contentHash: hash });
    // Expiry removed the bytes in the same transaction.
    const [left] = await asOwner(
      orgA,
      (tx) => tx<{ n: number }[]>`
        SELECT count(*)::int AS n FROM time_export_files WHERE export_id = ${id}`,
    );
    expect(left?.n).toBe(0);
  });

  it("keeps file bytes read-only for the runtime role and inside their tenant", async () => {
    const created = await asApp(orgB, (tx) =>
      repo.create(tx, request(randomUUID())),
    );
    const id = created!.id;
    await asOwner(orgB, (tx) => repo.claim(tx, id));
    await asOwner(orgB, (tx) =>
      repo.markReady(tx, id, {
        contentHash: hash,
        employeeCount: 1,
        content: new Uint8Array([1, 2, 3]),
        expiresAt: new Date("2030-01-01T00:00:00Z"),
      }),
    );

    await expect(
      asApp(
        orgB,
        (tx) => tx`
        UPDATE time_export_files SET content = '\\x00' WHERE export_id = ${id}`,
      ),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      asApp(
        orgB,
        (tx) => tx`DELETE FROM time_export_files WHERE export_id = ${id}`,
      ),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      asApp(
        orgB,
        (tx) => tx`
        INSERT INTO time_export_files (export_id, content)
        VALUES (${randomUUID()}, '\\x00')`,
      ),
    ).rejects.toThrow(/permission denied/i);
    // Even the owner cannot attach bytes to another tenant's export.
    await expect(
      asOwner(
        orgA,
        (tx) => tx`
        INSERT INTO time_export_files (export_id, organization_id, content)
        VALUES (${id}, ${orgB}, '\\x00')`,
      ),
    ).rejects.toThrow(/row-level security/i);

    const [grants] = await db.adminSql<{ privileges: string[] }[]>`
      SELECT array_agg(privilege_type::text ORDER BY privilege_type) AS privileges
      FROM information_schema.role_table_grants
      WHERE table_name = 'time_export_files' AND grantee = 'librehr_app'`;
    expect(grants?.privileges).toEqual(["SELECT"]);
    const [rls] = await db.adminSql<
      { relrowsecurity: boolean; relforcerowsecurity: boolean }[]
    >`
      SELECT relrowsecurity, relforcerowsecurity FROM pg_class
      WHERE relname = 'time_export_files'`;
    expect(rls).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });

  it("fails exports stuck in running and records a coarse error code", async () => {
    const [queued] = await asApp(orgA, (tx) =>
      repo.listForRequester(tx, alice, 1),
    );
    await asOwner(orgA, (tx) => repo.claim(tx, queued!.id));
    expect(
      await asOwner(orgA, (tx) =>
        repo.failStale(tx, new Date(Date.now() - 60_000), "EXPORT_TIMEOUT"),
      ),
    ).toEqual([]);
    expect(
      await asOwner(orgA, (tx) =>
        repo.failStale(tx, new Date(Date.now() + 60_000), "EXPORT_TIMEOUT"),
      ),
    ).toMatchObject([{ id: queued!.id, requestedBy: alice, locale: "es" }]);
    expect(
      await asApp(orgA, (tx) => repo.findForRequester(tx, queued!.id, alice)),
    ).toMatchObject({ status: "failed", errorCode: "EXPORT_TIMEOUT" });
  });

  it("rejects an incomplete ready row and a free-text error code", async () => {
    const created = await asApp(orgB, (tx) =>
      repo.create(tx, { ...request(randomUUID()), format: "pdf" }),
    );
    const id = created!.id;
    await asOwner(orgB, (tx) => repo.claim(tx, id));
    await expect(
      asOwner(
        orgB,
        (tx) => tx`
        UPDATE time_exports SET status = 'ready' WHERE id = ${id}`,
      ),
    ).rejects.toThrow(/time_exports_ready_check/);
    await expect(
      asOwner(orgB, (tx) => repo.markFailed(tx, id, "not a code")),
    ).rejects.toThrow(/time_exports_error_code_check/);
  });
});
