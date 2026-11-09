import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import { getTestDatabase, type TestDatabase } from "@librehr/testing";
import { runMigrations } from "../src/migrate.js";
import { withTenant, type TenantTx } from "../src/with-tenant.js";
import {
  TimeRepository,
  type TimeChainSigner,
} from "../src/repositories/time.repository.js";

// The real HMAC lives in @librehr/core; the repository only needs a signer
// that is a pure function of the link it is given.
const sign: TimeChainSigner = (link) =>
  createHash("sha256").update(JSON.stringify(link)).digest("hex");

describe("time_events v2 chain (TIM-002)", () => {
  let db: TestDatabase;
  let app: Sql;
  const repo = new TimeRepository();
  const orgId = "d0000000-0000-4000-8000-000000000001";
  const empId = "d1111111-1111-4111-8111-111111111111";
  const otherEmpId = "d2222222-2222-4222-8222-222222222222";

  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database) throw new Error("Docker is required for chain tests");
    db = database;
    await runMigrations(db.connectionString);
    app = await db.appSql();
    await db.sql`INSERT INTO organizations (id, name, slug) VALUES (${orgId}, 'Chain Org', 'chain-org')`;
    await db.sql`
      INSERT INTO employees (id, organization_id, first_name, last_name, email) VALUES
        (${empId}, ${orgId}, 'Chain', 'One', 'chain.one@example.invalid'),
        (${otherEmpId}, ${orgId}, 'Chain', 'Two', 'chain.two@example.invalid')
    `;
  }, 60000);

  afterAll(async () => {
    if (db) await db.close();
  });

  const append = (employeeId: string, occurredAt?: Date) =>
    withTenant(app, { organizationId: orgId }, (tx) =>
      repo.appendEvent(tx, sign, {
        organizationId: orgId,
        employeeId,
        eventType: "clock_in",
        occurredAt,
        source: "web",
        actorId: employeeId,
      }),
    );

  it("stores the exact recordedAt and seq that were signed", async () => {
    let signed: Parameters<TimeChainSigner>[0] | undefined;
    const row = await withTenant(app, { organizationId: orgId }, (tx) =>
      repo.appendEvent(
        tx,
        (link) => {
          signed = link;
          return sign(link);
        },
        {
          organizationId: orgId,
          employeeId: otherEmpId,
          eventType: "clock_in",
          source: "web",
          actorId: otherEmpId,
        },
      ),
    );
    expect(signed).toBeDefined();
    expect(row.id).toBe(signed!.id);
    expect(row.recordedAt.toISOString()).toBe(signed!.recordedAt);
    expect(row.occurredAt.toISOString()).toBe(signed!.occurredAt);
    expect(row.seq).toBe(1);
    expect(row.hashVersion).toBe(2);
    expect(row.prevHash).toBeNull();
    expect(row.hash).toBe(sign(signed!));
  });

  it("serializes concurrent appends into one linear chain (no fork)", async () => {
    const n = 12;
    await Promise.all(Array.from({ length: n }, () => append(empId)));

    const rows = await withTenant(app, { organizationId: orgId }, (tx) =>
      repo.listChainPage(tx, empId, 0, 100),
    );
    expect(rows.map((r) => r.seq)).toEqual(
      Array.from({ length: n }, (_, i) => i + 1),
    );
    rows.forEach((row, i) => {
      expect(row.prevHash).toBe(i === 0 ? null : rows[i - 1]!.hash);
    });
  });

  it("links a backdated event by seq, not by occurred_at", async () => {
    const before = await withTenant(app, { organizationId: orgId }, (tx) =>
      repo.listChainPage(tx, empId, 0, 1000),
    );
    const last = before[before.length - 1]!;
    const backdated = await append(empId, new Date("2020-01-01T08:00:00Z"));
    expect(backdated.seq).toBe(last.seq! + 1);
    expect(backdated.prevHash).toBe(last.hash);
  });

  it("rejects a second row at the same chain position", async () => {
    await expect(
      withTenant(
        db.sql,
        { organizationId: orgId },
        (tx) => tx`
        INSERT INTO time_events (organization_id, employee_id, event_type, occurred_at, actor_id, hash, hash_version, seq)
        VALUES (${orgId}, ${empId}, 'clock_out', now(), ${empId}, 'forged', 2, 1)
      `,
      ),
    ).rejects.toThrow(/time_events_chain_seq_uidx/);
  });

  it("rejects a v2 row without a chain position", async () => {
    await expect(
      withTenant(
        db.sql,
        { organizationId: orgId },
        (tx) => tx`
        INSERT INTO time_events (organization_id, employee_id, event_type, occurred_at, actor_id, hash, hash_version)
        VALUES (${orgId}, ${empId}, 'clock_out', now(), ${empId}, 'forged', 2)
      `,
      ),
    ).rejects.toThrow(/only chained v2 rows/);
  });

  it("rejects new legacy (v1) rows, by default and explicitly", async () => {
    for (const sqlRole of [app, db.sql]) {
      await expect(
        withTenant(
          sqlRole,
          { organizationId: orgId },
          (tx) => tx`
          INSERT INTO time_events (organization_id, employee_id, event_type, occurred_at, actor_id, hash)
          VALUES (${orgId}, ${empId}, 'clock_in', now(), ${empId}, 'unsigned')
        `,
        ),
      ).rejects.toThrow(/only chained v2 rows/);
      await expect(
        withTenant(
          sqlRole,
          { organizationId: orgId },
          (tx) => tx`
          INSERT INTO time_events (organization_id, employee_id, event_type, occurred_at, actor_id, hash, hash_version)
          VALUES (${orgId}, ${empId}, 'clock_in', now(), ${empId}, 'unsigned', 1)
        `,
        ),
      ).rejects.toThrow(/only chained v2 rows/);
    }
  });

  it("keeps existing legacy rows append-only", async () => {
    // A row written before 0025 (the insert trigger is skipped to create it).
    const [legacy] = await db.sql.begin(async (tx) => {
      await tx`SET LOCAL session_replication_role = replica`;
      return tx<{ id: string; hashVersion: number; seq: string | null }[]>`
        INSERT INTO time_events (organization_id, employee_id, event_type, occurred_at, actor_id, hash, hash_version)
        VALUES (${orgId}, ${empId}, 'clock_in', now(), ${empId}, 'legacy', 1)
        RETURNING id, hash_version as "hashVersion", seq
      `;
    });
    expect(legacy).toMatchObject({ hashVersion: 1, seq: null });

    await expect(
      withTenant(
        app,
        { organizationId: orgId },
        (tx) => tx`
        UPDATE time_events SET seq = 999, hash_version = 2 WHERE id = ${legacy!.id}
      `,
      ),
    ).rejects.toThrow(/permission denied|append-only/i);
  });

  it("anchors the newest link and lets the runtime role only move it forward", async () => {
    const latest = await append(empId);
    const head = await withTenant(app, { organizationId: orgId }, (tx) =>
      repo.getChainHead(tx, empId),
    );
    expect(head).toEqual({ seq: latest.seq, hash: latest.hash });

    const tamper = (statement: (tx: TenantTx) => Promise<unknown>) =>
      withTenant(app, { organizationId: orgId }, statement);
    // Back to an older link, to a made-up link, or deleted: all refused.
    await expect(
      tamper(
        (tx) =>
          tx`UPDATE time_event_chain_heads SET last_seq = 1 WHERE employee_id = ${empId}`,
      ),
    ).rejects.toThrow(/only move forward/);
    await expect(
      tamper(
        (tx) =>
          tx`UPDATE time_event_chain_heads SET last_seq = last_seq + 1, last_hash = 'forged' WHERE employee_id = ${empId}`,
      ),
    ).rejects.toThrow(/newest stored link/);
    await expect(
      tamper(
        (tx) =>
          tx`DELETE FROM time_event_chain_heads WHERE employee_id = ${empId}`,
      ),
    ).rejects.toThrow(/permission denied|append-only/i);
  });
});
