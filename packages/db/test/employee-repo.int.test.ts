import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDatabase, type TestDatabase } from "@openhr/testing";
import { runMigrations } from "../src/migrate.js";
import { withTenant } from "../src/with-tenant.js";
import { EmployeeRepository } from "../src/repositories/employee.repository.js";
import { DepartmentRepository } from "../src/repositories/department.repository.js";

describe("Employee & Department Repositories Integration Tests", () => {
  let db: TestDatabase | null = null;
  const employeeRepo = new EmployeeRepository();
  const departmentRepo = new DepartmentRepository();

  beforeAll(async () => {
    db = await getTestDatabase();
    if (db) {
      await runMigrations(db.connectionString);
    }
  });

  afterAll(async () => {
    if (db) {
      await db.close();
    }
  });

  it("creates, queries, updates, reveals, and terminates an employee within tenant context", async () => {
    if (!db) {
      return; // Skip if database is not available in environment
    }

    const orgId = "e1000000-0000-0000-0000-000000000001";
    await db.sql`
      INSERT INTO "organizations" ("id", "name", "slug")
      VALUES (${orgId}, 'Acme Iberia', 'acme-iberia')
      ON CONFLICT ("id") DO NOTHING
    `;

    await withTenant(db.sql, { organizationId: orgId }, async (tx) => {
      // 1. Create Department
      const dept = await departmentRepo.create(tx, {
        name: "Engineering",
      });
      expect(dept.name).toBe("Engineering");

      // 2. Create Employee with sensitive data
      const created = await employeeRepo.create(tx, {
        firstName: "Joan",
        lastName: "Martí",
        email: "joan.marti@acme.test",
        departmentId: dept.id,
        jobTitle: "Senior TypeScript Engineer",
        nationalId: "12345678Z",
        iban: "ES9121000418450200051332",
      });

      expect(created.id).toBeDefined();
      expect(created.firstName).toBe("Joan");
      expect(created.hasNationalId).toBe(true);
      expect(created.hasIban).toBe(true);
      expect(created.departmentName).toBe("Engineering");

      // 3. List employees
      const list = await employeeRepo.list(tx, {
        departmentId: dept.id,
        search: "Joan",
      });
      expect(list.items.length).toBe(1);
      expect(list.items[0]?.email).toBe("joan.marti@acme.test");

      // 4. Reveal sensitive field
      const revealedDni = await employeeRepo.revealSensitiveField(
        tx,
        created.id,
        "nationalId",
      );
      expect(revealedDni).toBe("12345678Z");

      const revealedIban = await employeeRepo.revealSensitiveField(
        tx,
        created.id,
        "iban",
      );
      expect(revealedIban).toBe("ES9121000418450200051332");

      // 5. Update employee
      const updated = await employeeRepo.update(tx, created.id, {
        preferredName: "Jan",
      });
      expect(updated.preferredName).toBe("Jan");

      // 6. Terminate employee (EMP-007)
      const terminated = await employeeRepo.terminate(tx, created.id, {
        terminationDate: "2026-06-30",
        terminationReason: "voluntary_resignation",
      });
      expect(terminated.status).toBe("terminated");
      expect(terminated.terminationDate).toBe("2026-06-30");
      expect(terminated.terminationReason).toBe("voluntary_resignation");
    });
  });
});
