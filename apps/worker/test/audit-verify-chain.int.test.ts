import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getTestDatabase, type TestDatabase } from "@librehr/testing";
import { runMigrations } from "@librehr/db/migrate";
import { TimeRepository, withTenant, type Sql } from "@librehr/db";
import { computeEventHashV2 } from "@librehr/core";
import { handleAuditVerifyChain } from "../src/queues/audit.verify-chain.js";

const KEY = "worker_test_time_chain_key_32_chars_min";

describe("audit.verify-chain (TIM-002)", () => {
  let db: TestDatabase;
  let app: Sql;
  const repo = new TimeRepository();

  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database) throw new Error("Docker is required for chain verification");
    db = database;
    await runMigrations(db.connectionString);
    app = await db.appSql();
  }, 90000);

  afterAll(async () => {
    if (db) await db.close();
  });

  async function newOrgWithEmployee() {
    const orgId = randomUUID();
    const employeeId = randomUUID();
    await db.sql`INSERT INTO organizations (id, name, slug) VALUES (${orgId}, 'Verify', ${`verify-${orgId.slice(0, 8)}`})`;
    await db.sql`
      INSERT INTO employees (id, organization_id, first_name, last_name, email)
      VALUES (${employeeId}, ${orgId}, 'Verify', 'Worker', ${`${employeeId}@example.invalid`})
    `;
    return { orgId, employeeId };
  }

  async function clock(orgId: string, employeeId: string, count: number) {
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const row = await withTenant(app, { organizationId: orgId }, (tx) =>
        repo.appendEvent(tx, (link) => computeEventHashV2(KEY, link), {
          organizationId: orgId,
          employeeId,
          eventType: i % 2 === 0 ? "clock_in" : "clock_out",
          source: "web",
          actorId: employeeId,
          reason: i === 1 ? "note" : null,
        }),
      );
      ids.push(row.id);
    }
    return ids;
  }

  const run = (organizationId: string, batchSize = 2) => {
    const logger = { info: vi.fn(), error: vi.fn() };
    return {
      logger,
      result: handleAuditVerifyChain(
        {
          id: "job-1",
          data: { organizationId, runDate: "2026-11-09", batchSize },
        },
        { sql: app, timeChainKey: KEY, logger },
      ),
    };
  };

  it("reports fresh v2 events as verified, across batches", async () => {
    const { orgId, employeeId } = await newOrgWithEmployee();
    await clock(orgId, employeeId, 5);

    const { result, logger } = run(orgId);
    const report = await result;
    expect(report).toMatchObject({
      status: "verified",
      employeesChecked: 1,
      tamperedEmployees: 0,
      events: { verified: 5, tampered: 0, legacy: 0 },
      issues: [],
    });
    expect(logger.error).not.toHaveBeenCalled();
    // Logs carry ids and counts only.
    const logged = JSON.stringify(logger.info.mock.calls);
    expect(logged).not.toContain("example.invalid");
    expect(logged).not.toContain("Verify");
  });

  it("reports v1 rows as legacy, never verified or tampered", async () => {
    const { orgId, employeeId } = await newOrgWithEmployee();
    // New v1 rows are refused since 0025; these stand for rows written before
    // it, so the insert trigger is skipped for this transaction only.
    await withTenant(db.sql, { organizationId: orgId }, async (tx) => {
      await tx`SET LOCAL session_replication_role = replica`;
      await tx`
      INSERT INTO time_events (organization_id, employee_id, event_type, occurred_at, actor_id, prev_hash, hash, hash_version)
      VALUES (${orgId}, ${employeeId}, 'clock_in', now(), ${employeeId}, NULL, 'v1-hash', 1),
             (${orgId}, ${employeeId}, 'clock_out', now(), ${employeeId}, 'v1-hash', 'v1-hash-2', 1)
    `;
    });

    const onlyLegacy = await run(orgId).result;
    expect(onlyLegacy).toMatchObject({
      status: "legacy_only",
      events: { verified: 0, tampered: 0, legacy: 2 },
    });

    await clock(orgId, employeeId, 2);
    const mixed = await run(orgId).result;
    expect(mixed).toMatchObject({
      status: "verified",
      events: { verified: 2, tampered: 0, legacy: 2 },
    });
  });

  it("reports tampered when a stored row is mutated", async () => {
    const { orgId, employeeId } = await newOrgWithEmployee();
    const ids = await clock(orgId, employeeId, 4);

    // Simulates an attacker with superuser access: the append-only trigger is
    // bypassed for this transaction only.
    await db.sql.begin(async (tx) => {
      await tx`SET LOCAL session_replication_role = replica`;
      await tx`
        UPDATE time_events
        SET occurred_at = occurred_at - interval '2 hours'
        WHERE id = ${ids[2]!}
      `;
    });

    const { result, logger } = run(orgId);
    const report = await result;
    expect(report.status).toBe("tampered");
    expect(report.events).toEqual({ verified: 3, tampered: 1, legacy: 0 });
    expect(report.tamperedEmployees).toBe(1);
    expect(report.issues).toEqual([
      { employeeId, eventId: ids[2], seq: 3, kind: "hash_mismatch" },
    ]);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ status: "tampered", tampered: 1 }),
    );
  });

  it("reports tampered for a forged row and for a v2 row downgraded to v1", async () => {
    const { orgId, employeeId } = await newOrgWithEmployee();
    const ids = await clock(orgId, employeeId, 2);

    await withTenant(
      db.sql,
      { organizationId: orgId },
      (tx) => tx`
      INSERT INTO time_events (organization_id, employee_id, event_type, occurred_at, actor_id, prev_hash, hash, hash_version, seq)
      SELECT ${orgId}, ${employeeId}, 'clock_out', now(), ${employeeId}, hash, repeat('0', 64), 2, 3
      FROM time_events WHERE id = ${ids[1]!}
    `,
    );
    await db.sql.begin(async (tx) => {
      await tx`SET LOCAL session_replication_role = replica`;
      await tx`UPDATE time_events SET hash_version = 1 WHERE id = ${ids[0]!}`;
    });

    const report = await run(orgId).result;
    expect(report.status).toBe("tampered");
    expect(report.events.tampered).toBe(2);
    expect(report.events.legacy).toBe(0);
    expect(report.issues.map((i) => i.kind).sort()).toEqual([
      "hash_mismatch",
      "unknown_version",
    ]);
  });

  /** Removes the newest chained rows as an owner/superuser could. */
  const truncate = (orgId: string, ids: string[], moveAnchorTo?: number) =>
    db.sql.begin(async (tx) => {
      await tx`SET LOCAL session_replication_role = replica`;
      await tx`DELETE FROM time_events WHERE id IN ${tx(ids)}`;
      if (moveAnchorTo !== undefined) {
        await tx`
          UPDATE time_event_chain_heads h
          SET last_seq = te.seq, last_hash = te.hash
          FROM time_events te
          WHERE h.organization_id = ${orgId}
            AND te.employee_id = h.employee_id AND te.seq = ${moveAnchorTo}
        `;
      }
    });

  it("reports a truncated chain tail as tampered", async () => {
    const { orgId, employeeId } = await newOrgWithEmployee();
    const ids = await clock(orgId, employeeId, 4);
    expect((await run(orgId).result).status).toBe("verified");

    await truncate(orgId, [ids[3]!]);

    const report = await run(orgId).result;
    expect(report.status).toBe("tampered");
    // Every remaining row still verifies on its own.
    expect(report.events).toEqual({ verified: 3, tampered: 0, legacy: 0 });
    expect(report.headIssues).toBeGreaterThan(0);
    expect(report.issues).toContainEqual({
      employeeId,
      eventId: ids[2],
      seq: 3,
      kind: "head_mismatch",
    });
  });

  it("detects rows and anchor rewound together against the previous run", async () => {
    const { orgId, employeeId } = await newOrgWithEmployee();
    const ids = await clock(orgId, employeeId, 3);
    expect((await run(orgId).result).status).toBe("verified");

    await truncate(orgId, [ids[2]!], 2);

    const report = await run(orgId).result;
    expect(report.status).toBe("tampered");
    expect(report.issues.map((i) => i.kind)).toEqual(["head_regressed"]);

    // The run records heads by id, seq and hash only.
    const [entry] = await withTenant(
      db.sql,
      { organizationId: orgId },
      (tx) => tx<{ metadata: { heads: unknown[] } }[]>`
        SELECT metadata FROM audit_log
        WHERE action = 'time.chain_verified' ORDER BY created_at DESC LIMIT 1`,
    );
    expect(entry?.metadata.heads).toEqual([
      { employeeId, seq: 2, hash: expect.stringMatching(/^[0-9a-f]{64}$/) },
    ]);
  });

  it("reports chained rows without an anchor as tampered", async () => {
    const { orgId, employeeId } = await newOrgWithEmployee();
    await clock(orgId, employeeId, 2);
    await db.sql.begin(async (tx) => {
      await tx`SET LOCAL session_replication_role = replica`;
      await tx`DELETE FROM time_event_chain_heads WHERE organization_id = ${orgId}`;
    });

    const report = await run(orgId).result;
    expect(report.status).toBe("tampered");
    expect(report.issues.map((i) => i.kind)).toEqual(["head_missing"]);
  });
});
