import { describe, expect, it } from "vitest";
import type { AuthUser } from "@librehr/contracts";
import { createApp } from "../src/app.js";
import { fixtureAuthPort, as } from "./support/fixture-app.js";
import { isPolicyIdentityQuery, scriptedSql } from "./support/scripted-sql.js";

// Docker-free checks of EMP-001/EMP-004 response shaping. The same paths run
// against Postgres in employees-scope.int.test.ts.
const org = "30000000-0000-0000-0000-000000000001";
const person = (n: number, role: AuthUser["role"]) => ({
  id: `30000000-0000-0000-0000-00000000010${n}`,
  employeeId: `30000000-0000-0000-0000-00000000020${n}`,
  email: `p${n}@scope.invalid`,
  name: `Person ${n}`,
  role: role as "admin" | "manager" | "employee" | "auditor",
  organizationId: org,
});
const admin = person(1, "admin");
const employee = person(2, "employee");

const profileRow = (p: typeof employee) => ({
  id: p.employeeId,
  organizationId: org,
  userId: p.id,
  departmentId: null,
  managerId: null,
  locationId: null,
  firstName: "Fixture",
  lastName: "Person",
  preferredName: null,
  email: p.email,
  phone: null,
  address: "Street 1",
  birthDate: "1990-01-01",
  status: "active",
  terminationDate: null,
  terminationReason: null,
  nationalIdEncrypted: "v1:ciphertext",
  ibanEncrypted: "v1:ciphertext",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  departmentName: null,
  locationName: null,
  managerName: null,
  jobTitle: "Engineer",
  employmentType: null,
  startDate: null,
});

const sql = scriptedSql((text, params) => {
  if (isPolicyIdentityQuery(text)) {
    const caller = [admin, employee].find((p) => params.includes(p.id));
    return caller
      ? [
          {
            employeeId: caller.employeeId,
            departmentId: null,
            locationId: null,
            reports: [],
          },
        ]
      : [];
  }
  if (text.includes("FROM employees e") && text.includes("WHERE e.id = ?")) {
    const target = [admin, employee].find((p) => params.includes(p.employeeId));
    return target ? [profileRow(target)] : [];
  }
  if (text.includes("COUNT(*)::text as count")) return [{ count: "1" }];
  if (text.includes("FROM employees e") && text.includes("LIMIT ? OFFSET ?")) {
    return [
      {
        ...profileRow(admin),
        departmentName: null,
        managerName: null,
      },
    ];
  }
  return [];
});

const app = createApp({ sql, authPort: fixtureAuthPort([admin, employee]) });

describe("employees response shaping (no database)", () => {
  it("never returns sensitive ciphertext from GET /employees/:id", async () => {
    for (const who of [admin, employee]) {
      const res = await app.request(`/v1/employees/${employee.employeeId}`, {
        headers: as(who),
      });
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).not.toContain("ciphertext");
      expect(JSON.parse(text)).toMatchObject({
        hasNationalId: true,
        hasIban: true,
      });
    }
  });

  it("forbids an employee reading a colleague's profile", async () => {
    const res = await app.request(`/v1/employees/${admin.employeeId}`, {
      headers: as(employee),
    });
    expect(res.status).toBe(403);
  });

  it("returns directory fields only from GET /employees", async () => {
    const res = await app.request("/v1/employees", { headers: as(employee) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Record<string, unknown>[] };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).not.toHaveProperty("address");
    expect(body.items[0]).not.toHaveProperty("nationalIdEncrypted");
    expect(body.items[0]).not.toHaveProperty("birthDate");
  });
});
