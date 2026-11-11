import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  getTestDatabase,
  seedScopedOrg,
  type ScopedOrgFixture,
  type TestDatabase,
} from "@librehr/testing";
import { runMigrations } from "@librehr/db/migrate";
import { createApp } from "../src/app.js";
import { as, fixtureAuthPort } from "./support/fixture-app.js";

const DIRECTORY_KEYS = [
  "departmentName",
  "email",
  "firstName",
  "id",
  "jobTitle",
  "lastName",
  "locationName",
  "managerName",
  "preferredName",
  "status",
].sort();

// EMP-001 directory, EMP-004 field-level visibility, EMP-002 emergency contacts.
describe("employees API scope", () => {
  let db: TestDatabase;
  let app: ReturnType<typeof createApp>;
  let a: ScopedOrgFixture;
  let b: ScopedOrgFixture;

  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database) throw new Error("Docker is required for this suite");
    db = database;
    await runMigrations(db.connectionString);
    a = await seedScopedOrg(db.sql, "emp-a");
    b = await seedScopedOrg(db.sql, "emp-b");
    await db.sql`
      UPDATE employees
      SET national_id_encrypted = 'v1:ciphertext', iban_encrypted = 'v1:ciphertext',
          address = 'Fixture street 1', birth_date = '1990-01-01'
      WHERE organization_id = ${a.orgId}
    `;
    await db.sql`
      INSERT INTO emergency_contacts (organization_id, employee_id, full_name, relationship, phone_primary)
      VALUES (${a.orgId}, ${a.peer.employeeId}, 'Fixture Contact', 'sibling', '+34000000000')
    `;
    app = createApp({
      sql: db.sql,
      authPort: fixtureAuthPort([
        a.admin,
        a.manager,
        a.report,
        a.peer,
        a.auditor,
      ]),
    });
  }, 60000);
  afterAll(async () => {
    if (db) await db.close();
  });

  describe("GET /v1/employees (directory)", () => {
    it("requires authentication", async () => {
      expect((await app.request("/v1/employees")).status).toBe(401);
    });

    it("gives employees the organization directory with directory fields only", async () => {
      const res = await app.request("/v1/employees?pageSize=100", {
        headers: as(a.report),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        items: Record<string, unknown>[];
        total: number;
      };
      expect(body.total).toBe(5);
      for (const item of body.items) {
        expect(Object.keys(item).sort()).toEqual(DIRECTORY_KEYS);
      }
      const ids = body.items.map((i) => i["id"]);
      expect(ids).not.toContain(b.report.employeeId);
    });

    it("forbids roles without any employee read permission", async () => {
      const res = await app.request("/v1/employees", {
        headers: as(a.auditor),
      });
      expect(res.status).toBe(403);
    });
  });

  describe("GET /v1/employees/:id", () => {
    const get = (id: string, who = a.admin) =>
      app.request(`/v1/employees/${id}`, { headers: as(who) });

    it("lets an employee read their own profile without ciphertext", async () => {
      const res = await get(a.report.employeeId, a.report);
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toMatchObject({
        id: a.report.employeeId,
        address: "Fixture street 1",
        hasNationalId: true,
        hasIban: true,
      });
      expect(body).not.toHaveProperty("nationalIdEncrypted");
      expect(body).not.toHaveProperty("ibanEncrypted");
      expect(JSON.stringify(body)).not.toContain("ciphertext");
    });

    it("never returns ciphertext to admins either", async () => {
      const res = await get(a.peer.employeeId);
      expect(res.status).toBe(200);
      expect(JSON.stringify(await res.json())).not.toContain("ciphertext");
    });

    it("gives a manager a report's profile without personal fields", async () => {
      const res = await get(a.report.employeeId, a.manager);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        id: a.report.employeeId,
        address: null,
        birthDate: null,
      });
    });

    it("shows the termination reason to HR/admin and self, never to the manager", async () => {
      await db.sql`UPDATE employees SET termination_reason = 'other'
        WHERE id = ${a.report.employeeId}`;
      const reasonFor = async (who: typeof a.admin) =>
        (
          (await (await get(a.report.employeeId, who)).json()) as {
            terminationReason: string | null;
          }
        ).terminationReason;
      expect(await reasonFor(a.manager)).toBeNull();
      expect(await reasonFor(a.admin)).toBe("other");
      expect(await reasonFor(a.report)).toBe("other");
      await db.sql`UPDATE employees SET termination_reason = NULL
        WHERE id = ${a.report.employeeId}`;
    });

    it("records the socket IP in the reveal audit, ignoring a forged X-Forwarded-For (TRUST_PROXY=0)", async () => {
      // No stored value, so the reveal returns null but is still audited.
      await db.sql`UPDATE employees SET national_id_encrypted = NULL
        WHERE id = ${a.auditor.employeeId}`;
      const res = await app.request(
        `/v1/employees/${a.auditor.employeeId}/reveal`,
        {
          method: "POST",
          headers: { ...as(a.admin, true), "X-Forwarded-For": "6.6.6.6" },
          body: JSON.stringify({ field: "nationalId" }),
        },
        // What @hono/node-server exposes as the connection.
        { incoming: { socket: { remoteAddress: "198.51.100.20" } } },
      );
      expect(res.status).toBe(200);
      const [entry] = await db.sql<{ metadata: { ip: string } }[]>`
        SELECT metadata FROM audit_log
        WHERE organization_id = ${a.orgId}
          AND action = 'employee.reveal_sensitive'
          AND resource_id = ${a.auditor.employeeId}
        ORDER BY created_at DESC LIMIT 1`;
      expect(entry?.metadata.ip).toBe("198.51.100.20");
    });

    it("forbids an employee reading a colleague's profile", async () => {
      expect((await get(a.peer.employeeId, a.report)).status).toBe(403);
    });

    it("forbids a manager reading a non-report's profile", async () => {
      expect((await get(a.peer.employeeId, a.manager)).status).toBe(403);
    });

    it("returns 404 for another tenant's employee", async () => {
      expect((await get(b.report.employeeId)).status).toBe(404);
    });
  });

  describe("emergency contacts", () => {
    const path = (id: string) => `/v1/people/${id}/emergency-contacts`;
    const contact = JSON.stringify({
      fullName: "Fixture Person",
      relationship: "parent",
      phonePrimary: "+34000000001",
    });

    it("lets an employee read their own contacts", async () => {
      const res = await app.request(path(a.peer.employeeId), {
        headers: as(a.peer),
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toHaveLength(1);
    });

    it("forbids reading a colleague's contacts", async () => {
      const res = await app.request(path(a.peer.employeeId), {
        headers: as(a.report),
      });
      expect(res.status).toBe(403);
    });

    it("forbids adding contacts to a colleague", async () => {
      const res = await app.request(path(a.peer.employeeId), {
        method: "POST",
        headers: as(a.report, true),
        body: contact,
      });
      expect(res.status).toBe(403);
    });

    it("lets an employee add their own contact", async () => {
      const res = await app.request(path(a.report.employeeId), {
        method: "POST",
        headers: as(a.report, true),
        body: contact,
      });
      expect(res.status).toBe(201);
    });

    it("does not delete a contact through another employee's path", async () => {
      const contacts = await db.sql<{ id: string }[]>`
        SELECT id FROM emergency_contacts WHERE employee_id = ${a.peer.employeeId}
      `;
      const res = await app.request(
        `${path(a.report.employeeId)}/${contacts[0]?.id}`,
        { method: "DELETE", headers: as(a.report) },
      );
      expect(res.status).toBe(404);
      const after = await db.sql`
        SELECT id FROM emergency_contacts WHERE employee_id = ${a.peer.employeeId}
      `;
      expect(after).toHaveLength(1);
    });

    it("returns 404 for another tenant's employee", async () => {
      const res = await app.request(path(b.report.employeeId), {
        headers: as(a.admin),
      });
      expect(res.status).toBe(404);
    });
  });
});
