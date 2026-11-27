import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  getTestDatabase,
  seedScopedOrg,
  type FixturePerson,
  type ScopedOrgFixture,
  type TestDatabase,
} from "@librehr/testing";
import { runMigrations } from "@librehr/db/migrate";
import {
  DepartmentRepository,
  EmployeeMembershipRepository,
  LeaveRepository,
  OrgGroupRepository,
  withTenant,
  type TenantTx,
} from "@librehr/db";
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

// ORG-007 (ADR 0008 decisions 8 and 9): the lead visibility setting and
// department documents reaching secondary members. `a.peer` leads the sales
// department and project Apollo. mia is a primary member of sales; a.report
// has active secondary memberships in sales and Apollo; olga's Apollo
// membership has ended; pete is unrelated.
describe("lead visibility and department documents (ORG-007)", () => {
  let db: TestDatabase;
  let app: ReturnType<typeof createApp>;
  let a: ScopedOrgFixture;
  let b: ScopedOrgFixture;
  let olga: FixturePerson;
  const emp: Record<string, string> = {};
  let salesDoc = "";
  let miaRequest = "";

  const tenant = <T>(orgId: string, fn: (tx: TenantTx) => Promise<T>) =>
    withTenant(db.sql, { organizationId: orgId }, fn);

  async function addPerson(
    label: string,
    departmentId: string | null,
  ): Promise<FixturePerson> {
    const id = randomUUID();
    const employeeId = randomUUID();
    const email = `${label}-${id.slice(0, 8)}@fixture.invalid`;
    await db.sql`INSERT INTO users (id, email, name) VALUES (${id}, ${email}, ${label})`;
    await db.sql`INSERT INTO memberships (organization_id, user_id, role) VALUES (${a.orgId}, ${id}, 'employee')`;
    await db.sql`
      INSERT INTO employees (id, organization_id, user_id, department_id, first_name, last_name, email, phone, address)
      VALUES (${employeeId}, ${a.orgId}, ${id}, ${departmentId}, 'Fixture', ${label}, ${email}, '+34 600 000 000', 'Street 1')
    `;
    return {
      id,
      email,
      name: label,
      role: "employee",
      organizationId: a.orgId,
      employeeId,
    };
  }

  const setVisibility = (value: unknown, who: FixturePerson = a.admin) =>
    app.request("/v1/settings/security", {
      method: "PATCH",
      headers: as(who, true),
      body: JSON.stringify({ secondaryLeadVisibility: value }),
    });
  const profile = (id: string | undefined, who: FixturePerson = a.peer) =>
    app.request(`/v1/employees/${id}`, { headers: as(who) });

  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database) throw new Error("Docker is required for this suite");
    db = database;
    await runMigrations(db.connectionString);
    a = await seedScopedOrg(db.sql, "lead-a");
    b = await seedScopedOrg(db.sql, "lead-b");
    const ids = await tenant(a.orgId, async (tx) => {
      const departments = new DepartmentRepository();
      const sales = await departments.create(tx, {
        name: "Sales",
        leadEmployeeId: a.peer.employeeId,
      });
      const other = await departments.create(tx, { name: "Support" });
      const apollo = await new OrgGroupRepository().create(tx, {
        kind: "project",
        name: "Apollo",
        leadEmployeeId: a.peer.employeeId,
      });
      return { sales: sales.id, other: other.id, apollo: apollo.id };
    });
    const mia = await addPerson("mia", ids.sales);
    olga = await addPerson("olga", ids.other);
    const pete = await addPerson("pete", ids.other);
    emp["mia"] = mia.employeeId;
    emp["olga"] = olga.employeeId;
    emp["pete"] = pete.employeeId;
    await db.sql`UPDATE employees SET department_id = ${ids.other} WHERE id = ${a.report.employeeId}`;
    await tenant(a.orgId, async (tx) => {
      const memberships = new EmployeeMembershipRepository();
      const base = { createdBy: a.admin.id, startDate: "2020-01-01" };
      for (const target of [
        { departmentId: ids.sales },
        { groupId: ids.apollo },
      ]) {
        await memberships.create(tx, {
          ...base,
          ...target,
          employeeId: a.report.employeeId,
        });
      }
      for (const target of [
        { departmentId: ids.sales },
        { groupId: ids.apollo },
      ]) {
        await memberships.create(tx, {
          ...base,
          ...target,
          employeeId: olga.employeeId,
          endDate: "2021-01-01",
        });
      }
      const leave = new LeaveRepository();
      const type = await leave.createLeaveType(tx, {
        name: "Vacation",
        code: "vacation",
        requiresApproval: true,
      });
      miaRequest = (
        await leave.createLeaveRequest(tx, {
          employeeId: mia.employeeId,
          leaveTypeId: type.id,
          startDate: "2030-07-08",
          endDate: "2030-07-08",
          workingDays: 1,
        })
      ).id;
    });
    app = createApp({
      sql: await db.appSql(),
      storagePort: new MemoryStorage(),
      authPort: fixtureAuthPort([
        a.admin,
        a.peer,
        a.report,
        a.manager,
        olga,
        pete,
        b.admin,
      ]),
    });
    const upload = await app.request("/v1/documents", {
      method: "POST",
      headers: as(a.admin, true),
      body: JSON.stringify({
        filename: "memo.pdf",
        mimeType: "application/pdf",
        fileDataBase64: Buffer.from("%PDF-1.4 fixture").toString("base64"),
        title: "Sales memo",
        category: "company_policies",
        audienceType: "department",
        targetDepartmentId: ids.sales,
      }),
    });
    expect(upload.status).toBe(201);
    salesDoc = ((await upload.json()) as { id: string }).id;
  }, 60000);
  afterAll(async () => {
    if (db) await db.close();
  });

  describe("the setting (PATCH /v1/settings/security)", () => {
    it("defaults to calendar", async () => {
      const res = await app.request("/v1/settings/security", {
        headers: as(a.admin),
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        secondaryLeadVisibility: "calendar",
      });
    });

    it("rejects anonymous callers, non-admins and unknown values", async () => {
      const anonymous = await app.request("/v1/settings/security", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secondaryLeadVisibility: "profile" }),
      });
      expect(anonymous.status).toBe(401);
      expect((await setVisibility("profile", a.manager)).status).toBe(403);
      expect((await setVisibility("everything")).status).toBe(400);
    });

    it("stores a value per organization and audits it", async () => {
      const res = await setVisibility("off");
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        secondaryLeadVisibility: "off",
      });
      const other = await app.request("/v1/settings/security", {
        headers: as(b.admin),
      });
      expect(await other.json()).toMatchObject({
        secondaryLeadVisibility: "calendar",
      });
      const rows = await db.sql<{ metadata: Record<string, unknown> }[]>`
        SELECT metadata FROM audit_log
        WHERE action = 'organization.security_updated'
          AND resource_id = ${a.orgId}
        ORDER BY created_at DESC LIMIT 1
      `;
      expect(rows[0]?.metadata).toEqual({ secondaryLeadVisibility: "off" });
    });
  });

  describe("GET /v1/employees/:id as a lead", () => {
    it("shows no member profile with off or calendar", async () => {
      for (const value of ["off", "calendar"]) {
        expect((await setVisibility(value)).status).toBe(200);
        expect((await profile(emp["mia"])).status).toBe(403);
        expect((await profile(a.report.employeeId)).status).toBe(403);
      }
    });

    it("shows directory fields of current members with profile", async () => {
      expect((await setVisibility("profile")).status).toBe(200);
      for (const id of [emp["mia"], a.report.employeeId]) {
        const res = await profile(id);
        expect(res.status).toBe(200);
        const text = await res.text();
        expect(text).not.toContain("Street 1");
        expect(text).not.toContain("+34 600");
        expect(JSON.parse(text)).toMatchObject({
          id,
          address: null,
          phone: null,
          birthDate: null,
          hasNationalId: false,
          hasIban: false,
        });
      }
    });

    it("never reaches ended members, non-members or other tenants", async () => {
      expect((await setVisibility("profile")).status).toBe(200);
      expect((await profile(emp["olga"])).status).toBe(403);
      expect((await profile(emp["pete"])).status).toBe(403);
      expect((await profile(b.peer.employeeId)).status).toBe(404);
    });

    // The profile page lists memberships, so a lead allowed the profile can
    // read them, in directory shape: no role label, no end reason.
    it("lists a member's memberships to a lead only with profile", async () => {
      await db.sql`
        UPDATE employee_memberships SET role = 'analyst'
        WHERE employee_id = ${a.report.employeeId}`;
      const list = (id: string | undefined) =>
        app.request(`/v1/employees/${id}/memberships`, { headers: as(a.peer) });
      for (const value of ["off", "calendar"]) {
        expect((await setVisibility(value)).status).toBe(200);
        expect((await list(a.report.employeeId)).status).toBe(403);
      }
      expect((await setVisibility("profile")).status).toBe(200);
      const res = await list(a.report.employeeId);
      expect(res.status).toBe(200);
      const rows = (await res.json()) as {
        targetName: string;
        role: string | null;
        endReason: string | null;
      }[];
      expect(rows.map((r) => r.targetName).sort()).toEqual(["Apollo", "Sales"]);
      for (const row of rows)
        expect(row).toMatchObject({ role: null, endReason: null });
      // Ended members, non-members and other tenants stay out of reach.
      expect((await list(emp["olga"])).status).toBe(403);
      expect((await list(emp["pete"])).status).toBe(403);
      expect((await list(b.peer.employeeId)).status).toBe(404);
      // An admin still sees the role label.
      const full = await app.request(
        `/v1/employees/${a.report.employeeId}/memberships`,
        { headers: as(a.admin) },
      );
      expect(JSON.stringify(await full.json())).toContain("analyst");
      // Reading never extends to writing.
      const add = await app.request(
        `/v1/employees/${a.report.employeeId}/memberships`,
        {
          method: "POST",
          headers: as(a.peer, true),
          body: JSON.stringify({
            groupId: randomUUID(),
            startDate: "2030-01-01",
          }),
        },
      );
      expect(add.status).toBe(403);
    });

    it("grants no write, approval or other read as a lead", async () => {
      expect((await setVisibility("profile")).status).toBe(200);
      const patch = await app.request(`/v1/employees/${emp["mia"]}`, {
        method: "PATCH",
        headers: as(a.peer, true),
        body: JSON.stringify({ jobTitle: "Changed" }),
      });
      expect(patch.status).toBe(403);
      const decide = await app.request(
        `/v1/leave/requests/${miaRequest}/decide`,
        {
          method: "POST",
          headers: as(a.peer, true),
          body: JSON.stringify({ decision: "approve" }),
        },
      );
      expect(decide.status).toBe(403);
      for (const path of [
        `/v1/leave/balance?employeeId=${emp["mia"]}`,
        `/v1/people/${emp["mia"]}/emergency-contacts`,
      ]) {
        const res = await app.request(path, { headers: as(a.peer) });
        expect(res.status, path).toBe(403);
      }
      const reveal = await app.request(`/v1/employees/${emp["mia"]}/reveal`, {
        method: "POST",
        headers: as(a.peer, true),
        body: JSON.stringify({ field: "iban" }),
      });
      expect(reveal.status).toBe(403);
    });
  });

  describe("department documents reach secondary members (DOC-002)", () => {
    const companyDocs = async (who: FixturePerson) => {
      const res = await app.request("/v1/documents?isCompanyWide=true", {
        headers: as(who),
      });
      expect(res.status).toBe(200);
      return ((await res.json()) as { id: string }[]).map((d) => d.id);
    };

    it("lists and opens the document for an active secondary member", async () => {
      expect(await companyDocs(a.report)).toContain(salesDoc);
      const res = await app.request(`/v1/documents/${salesDoc}/download`, {
        headers: as(a.report),
      });
      expect(res.status).toBe(200);
    });

    it("keeps it from ended members and other departments", async () => {
      for (const who of [olga, a.manager]) {
        expect(await companyDocs(who)).not.toContain(salesDoc);
        const res = await app.request(`/v1/documents/${salesDoc}/download`, {
          headers: as(who),
        });
        expect(res.status).toBe(403);
      }
    });

    it("hides it from another tenant", async () => {
      const res = await app.request(`/v1/documents/${salesDoc}/download`, {
        headers: as(b.admin),
      });
      expect(res.status).toBe(404);
    });
  });
});
