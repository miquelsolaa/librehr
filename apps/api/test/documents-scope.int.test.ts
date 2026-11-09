import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  getTestDatabase,
  seedScopedOrg,
  type FixturePerson,
  type ScopedOrgFixture,
  type TestDatabase,
} from "@librehr/testing";
import { runMigrations } from "@librehr/db/migrate";
import { createApp } from "../src/app.js";
import type { StoragePort } from "../src/ports/storage.js";
import { as, fixtureAuthPort } from "./support/fixture-app.js";

class MemoryStorage implements StoragePort {
  private files = new Map<string, Buffer>();
  async put(key: string, data: Buffer) {
    this.files.set(key, data);
    return key;
  }
  async get(key: string) {
    return this.files.get(key) ?? null;
  }
  async delete(key: string) {
    this.files.delete(key);
  }
}

// DOC-003 download permissions, DOC-006 acknowledgements, DOC-007 template
// rendering, ADM-002 download audit.
describe("documents API scope", () => {
  let db: TestDatabase;
  let app: ReturnType<typeof createApp>;
  let a: ScopedOrgFixture;
  let b: ScopedOrgFixture;
  const docs: Record<string, string> = {};
  let templateId = "";

  async function upload(
    who: FixturePerson,
    body: Record<string, unknown>,
  ): Promise<string> {
    const res = await app.request("/v1/documents", {
      method: "POST",
      headers: as(who, true),
      body: JSON.stringify({
        filename: "file.pdf",
        mimeType: "application/pdf",
        fileDataBase64: Buffer.from("%PDF-1.4 fixture").toString("base64"),
        ...body,
      }),
    });
    if (res.status !== 201) throw new Error(`upload failed: ${res.status}`);
    return ((await res.json()) as { id: string }).id;
  }

  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database) throw new Error("Docker is required for this suite");
    db = database;
    await runMigrations(db.connectionString);
    a = await seedScopedOrg(db.sql, "docs-a");
    b = await seedScopedOrg(db.sql, "docs-b");
    app = createApp({
      sql: await db.appSql(),
      storagePort: new MemoryStorage(),
      authPort: fixtureAuthPort([
        a.admin,
        a.manager,
        a.report,
        a.peer,
        a.auditor,
        b.admin,
      ]),
    });
    docs["contract"] = await upload(a.admin, {
      employeeId: a.report.employeeId,
      title: "Contract",
      category: "contracts",
    });
    docs["payslip"] = await upload(a.admin, {
      employeeId: a.report.employeeId,
      title: "Payslip",
      category: "payslips",
    });
    docs["policy"] = await upload(a.admin, {
      title: "Handbook",
      category: "company_policies",
      audienceType: "company",
    });
    docs["otherDepartment"] = await upload(a.admin, {
      title: "Department memo",
      category: "company_policies",
      audienceType: "department",
      targetDepartmentId: "6f1c2a4e-8b3d-4c5e-9f7a-1b2c3d4e5f60",
    });
    docs["otherTenant"] = await upload(b.admin, {
      title: "Other handbook",
      category: "company_policies",
      audienceType: "company",
    });
    const tpl = await app.request("/v1/documents/templates", {
      method: "POST",
      headers: as(a.admin, true),
      body: JSON.stringify({
        name: "Certificate",
        category: "certificates",
        content: "Certifies {{employee.name}} at {{employee.address}}",
      }),
    });
    templateId = ((await tpl.json()) as { id: string }).id;
  }, 60000);
  afterAll(async () => {
    if (db) await db.close();
  });

  const download = (doc: string | undefined, who: FixturePerson) =>
    app.request(`/v1/documents/${doc}/download`, { headers: as(who) });

  describe("GET /v1/documents/:id/download", () => {
    it("requires authentication", async () => {
      const res = await app.request(
        `/v1/documents/${docs["contract"]}/download`,
      );
      expect(res.status).toBe(401);
    });

    it("lets an employee download their own document and audits it", async () => {
      const res = await download(docs["contract"], a.report);
      expect(res.status).toBe(200);
      const rows = await db.sql<{ actor_id: string; metadata: unknown }[]>`
        SELECT actor_id, metadata FROM audit_log
        WHERE action = 'document.download' AND resource_id = ${docs["contract"] ?? ""}
      `;
      expect(rows.map((r) => r.actor_id)).toContain(a.report.id);
      expect(JSON.stringify(rows[0]?.metadata)).not.toContain("Contract");
    });

    it("forbids a colleague, a manager and an auditor", async () => {
      for (const who of [a.peer, a.manager, a.auditor]) {
        expect((await download(docs["contract"], who)).status).toBe(403);
      }
    });

    it("lets HR/admin download personal documents in scope", async () => {
      expect((await download(docs["contract"], a.admin)).status).toBe(200);
    });

    it("lets the employee and HR/admin open a payslip, not managers or auditors", async () => {
      expect((await download(docs["payslip"], a.report)).status).toBe(200);
      expect((await download(docs["payslip"], a.admin)).status).toBe(200);
      expect((await download(docs["payslip"], a.manager)).status).toBe(403);
      expect((await download(docs["payslip"], a.auditor)).status).toBe(403);
      expect((await download(docs["payslip"], a.peer)).status).toBe(403);
    });

    it("audits every payslip open with ids only", async () => {
      const rows = await db.sql<{ actor_id: string; metadata: unknown }[]>`
        SELECT actor_id, metadata FROM audit_log
        WHERE action = 'document.download' AND resource_id = ${docs["payslip"] ?? ""}
      `;
      expect(rows.map((r) => r.actor_id).sort()).toEqual(
        [a.admin.id, a.report.id].sort(),
      );
      for (const row of rows) {
        const meta = JSON.stringify(row.metadata);
        expect(meta).not.toContain("Payslip");
        expect(meta).not.toContain("file.pdf");
        expect(meta).not.toContain("@fixture.invalid");
      }
    });

    it("serves company documents to their audience only", async () => {
      expect((await download(docs["policy"], a.peer)).status).toBe(200);
      expect((await download(docs["otherDepartment"], a.peer)).status).toBe(
        403,
      );
    });

    it("returns 404 for another tenant's document", async () => {
      expect((await download(docs["otherTenant"], a.admin)).status).toBe(404);
    });
  });

  describe("acknowledgements", () => {
    const ack = (doc: string | undefined, who: FixturePerson) =>
      app.request(`/v1/documents/${doc}/acknowledge`, {
        method: "POST",
        headers: as(who),
      });

    it("lets an employee acknowledge a document addressed to them", async () => {
      expect((await ack(docs["policy"], a.peer)).status).toBe(200);
    });

    it("forbids acknowledging documents not addressed to you", async () => {
      expect((await ack(docs["contract"], a.peer)).status).toBe(403);
      expect((await ack(docs["otherDepartment"], a.peer)).status).toBe(403);
    });

    it("returns 404 for another tenant's document", async () => {
      expect((await ack(docs["otherTenant"], a.peer)).status).toBe(404);
    });

    it("shows HR every receipt and employees only their own", async () => {
      await ack(docs["policy"], a.report);
      const list = async (who: FixturePerson) => {
        const res = await app.request(
          `/v1/documents/${docs["policy"]}/acknowledgements`,
          { headers: as(who) },
        );
        expect(res.status).toBe(200);
        return ((await res.json()) as { employeeId: string }[]).map(
          (r) => r.employeeId,
        );
      };
      expect((await list(a.admin)).sort()).toEqual(
        [a.peer.employeeId, a.report.employeeId].sort(),
      );
      expect(await list(a.peer)).toEqual([a.peer.employeeId]);
    });

    it("forbids listing receipts of a document you cannot read", async () => {
      const res = await app.request(
        `/v1/documents/${docs["contract"]}/acknowledgements`,
        { headers: as(a.peer) },
      );
      expect(res.status).toBe(403);
    });
  });

  describe("POST /v1/documents/templates/:id/render", () => {
    const render = (employeeId: string, who: FixturePerson) =>
      app.request(`/v1/documents/templates/${templateId}/render`, {
        method: "POST",
        headers: as(who, true),
        body: JSON.stringify({ employeeId }),
      });

    it("lets HR/admin render for an employee in scope", async () => {
      expect((await render(a.report.employeeId, a.admin)).status).toBe(200);
    });

    it("forbids employees and managers, even for themselves", async () => {
      expect((await render(a.peer.employeeId, a.report)).status).toBe(403);
      expect((await render(a.report.employeeId, a.manager)).status).toBe(403);
      expect((await render(a.report.employeeId, a.report)).status).toBe(403);
    });

    it("returns 404 for another tenant's employee", async () => {
      expect((await render(b.report.employeeId, a.admin)).status).toBe(404);
    });
  });
});
