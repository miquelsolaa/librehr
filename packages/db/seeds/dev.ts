import postgres from "postgres";

export async function seedDevDatabase(connectionUrl?: string): Promise<void> {
  const url =
    connectionUrl ||
    process.env["DATABASE_MIGRATION_URL"] ||
    process.env["DATABASE_URL"] ||
    "postgres://openhr_owner:openhr_dev_password@localhost:5432/openhr";

  const sql = postgres(url, { max: 1 });

  try {
    process.stdout.write("Seeding dev organization, locations, and users...\n");

    await sql.begin(async (tx) => {
      // 1. Create Dev Organization
      const orgRows = await tx`
        INSERT INTO "organizations" ("name", "slug", "default_locale", "timezone")
        VALUES ('Acme Serveis', 'acme-serveis', 'ca', 'Europe/Madrid')
        ON CONFLICT ("slug") DO UPDATE SET "name" = EXCLUDED."name"
        RETURNING "id"
      `;
      const orgId = orgRows[0]?.["id"] as string;

      // 2. Create Legal Entity
      const entityRows = await tx`
        INSERT INTO "legal_entities" ("organization_id", "name", "tax_id", "country")
        VALUES (${orgId}, 'Acme Serveis SL', 'B65432109', 'ES')
        RETURNING "id"
      `;
      const entityId = entityRows[0]?.["id"] as string;

      // 3. Create Location
      const locRows = await tx`
        INSERT INTO "locations" ("organization_id", "legal_entity_id", "name", "country", "region", "city", "timezone")
        VALUES (${orgId}, ${entityId}, 'Barcelona Diagonal', 'ES', 'CT', 'Barcelona', 'Europe/Madrid')
        RETURNING "id"
      `;
      const locationId = locRows[0]?.["id"] as string;

      // 4. Create Departments
      const deptRows = await tx<{ id: string; name: string }[]>`
        INSERT INTO "departments" ("organization_id", "name")
        VALUES (${orgId}, 'Engineering'), (${orgId}, 'Operations'), (${orgId}, 'People & Culture')
        RETURNING "id", "name"
      `;
      const engDeptId =
        deptRows.find((d) => d.name === "Engineering")?.id ?? "";

      // 5. Create Users & Employees (Admin, Manager, Employee)

      // Password hash for 'Password123!' (dummy dev hash or scrypt)
      const usersData = [
        { email: "admin@openhr.local", name: "Marta Soler", role: "admin" },
        { email: "manager@openhr.local", name: "Pere Vila", role: "manager" },
        { email: "employee@openhr.local", name: "Laia Puig", role: "employee" },
      ];

      let managerEmpId: string | null = null;

      for (const u of usersData) {
        const userRows = await tx`
          INSERT INTO "users" ("email", "name", "password_hash", "email_verified")
          VALUES (${u.email}, ${u.name}, '$2a$10$devPasswordHash1234567890abcdefghijklmnopqrstuv', true)
          ON CONFLICT ("email") DO UPDATE SET "name" = EXCLUDED."name"
          RETURNING "id"
        `;
        const userId = userRows[0]?.["id"] as string;

        // Membership
        await tx`
          INSERT INTO "memberships" ("organization_id", "user_id", "role")
          VALUES (${orgId}, ${userId}, ${u.role})
          ON CONFLICT ("organization_id", "user_id") DO UPDATE SET "role" = EXCLUDED."role"
        `;

        // Employee
        const nameParts = u.name.split(" ");
        const firstName = nameParts[0] ?? "User";
        const lastName = nameParts[1] ?? "";
        const managerId = u.role === "employee" ? managerEmpId : null;

        const empRows = await tx`
          INSERT INTO "employees" (
            "organization_id", "user_id", "department_id", "manager_id", "location_id",
            "first_name", "last_name", "email", "status"
          )
          VALUES (
            ${orgId}, ${userId}, ${engDeptId}, ${managerId}, ${locationId},
            ${firstName}, ${lastName}, ${u.email}, 'active'
          )
          RETURNING "id"
        `;
        const empId = empRows[0]?.["id"] as string;
        if (u.role === "manager") {
          managerEmpId = empId;
        }

        // Employment
        await tx`
          INSERT INTO "employments" ("organization_id", "employee_id", "job_title", "employment_type", "start_date")
          VALUES (${orgId}, ${empId}, ${u.role === "admin" ? "People & Ops Lead" : u.role === "manager" ? "Team Lead" : "Specialist"}, 'indefinido', '2024-01-01')
        `;

        // Initial 2026 Vacation Accrual
        await tx`
          INSERT INTO "leave_ledger" ("organization_id", "employee_id", "entry_type", "amount", "unit", "effective_date", "note")
          VALUES (${orgId}, ${empId}, 'accrual', 22.00, 'days', '2026-01-01', 'Annual vacation entitlement 2026')
        `;
      }

      // 6. Seed Leave Types & Policy
      const ltRows = await tx<{ id: string }[]>`
        INSERT INTO "leave_types" ("organization_id", "name", "code", "is_paid", "requires_approval", "color")
        VALUES 
          (${orgId}, 'Vacaciones', 'vacation', true, true, '#3b82f6'),
          (${orgId}, 'Asuntos Propios', 'personal_days', true, true, '#10b981'),
          (${orgId}, 'Baja Médica (IT)', 'sick_leave', true, false, '#f59e0b')
        ON CONFLICT DO NOTHING
        RETURNING "id"
      `;

      if (ltRows[0]) {
        await tx`
          INSERT INTO "leave_policies" (
            "organization_id", "leave_type_id", "name", "annual_allowance_days", "accrual_method"
          ) VALUES (
            ${orgId}, ${ltRows[0].id}, 'Convenio General', 22.00, 'monthly'
          )
        `;
      }

      // 7. Seed Holiday Calendar 2026 for Location
      const calRows = await tx<{ id: string }[]>`
        INSERT INTO "holiday_calendars" ("organization_id", "location_id", "year")
        VALUES (${orgId}, ${locationId}, 2026)
        ON CONFLICT DO NOTHING
        RETURNING "id"
      `;

      if (calRows[0]) {
        await tx`
          INSERT INTO "holidays" ("organization_id", "calendar_id", "date", "name", "scope")
          VALUES 
            (${orgId}, ${calRows[0].id}, '2026-01-01', 'Año Nuevo', 'national'),
            (${orgId}, ${calRows[0].id}, '2026-01-06', 'Epifanía del Señor', 'national'),
            (${orgId}, ${calRows[0].id}, '2026-04-03', 'Viernes Santo', 'national'),
            (${orgId}, ${calRows[0].id}, '2026-05-01', 'Fiesta del Trabajo', 'national'),
            (${orgId}, ${calRows[0].id}, '2026-06-24', 'Sant Joan', 'regional'),
            (${orgId}, ${calRows[0].id}, '2026-08-15', 'Asunción de la Virgen', 'national'),
            (${orgId}, ${calRows[0].id}, '2026-09-11', 'Diada Nacional de Catalunya', 'regional'),
            (${orgId}, ${calRows[0].id}, '2026-10-12', 'Fiesta Nacional de España', 'national'),
            (${orgId}, ${calRows[0].id}, '2026-12-08', 'Inmaculada Concepción', 'national'),
            (${orgId}, ${calRows[0].id}, '2026-12-25', 'Navidad', 'national')
        `;
      }

      // 8. Seed Default 40h Working Schedule & Rules (TIM-005)
      const schedRows = await tx<{ id: string }[]>`
        INSERT INTO "schedules" ("organization_id", "name", "type", "weekly_hours", "minimum_daily_rest_hours", "is_default")
        VALUES (${orgId}, 'General 40h (Mon-Fri)', 'fixed', 40.00, 12.0, true)
        RETURNING "id"
      `;

      if (schedRows[0]) {
        const schedId = schedRows[0].id;
        await tx`
          INSERT INTO "schedule_rules" ("organization_id", "schedule_id", "day_of_week", "expected_hours", "core_start_minutes", "core_end_minutes", "break_minutes")
          VALUES
            (${orgId}, ${schedId}, 1, 8.00, 540, 1020, 60),
            (${orgId}, ${schedId}, 2, 8.00, 540, 1020, 60),
            (${orgId}, ${schedId}, 3, 8.00, 540, 1020, 60),
            (${orgId}, ${schedId}, 4, 8.00, 540, 1020, 60),
            (${orgId}, ${schedId}, 5, 8.00, 540, 1020, 60)
        `;
      }

      // 9. Seed Standard Onboarding Checklist Template (ONB-001)
      const onbRows = await tx<{ id: string }[]>`
        INSERT INTO "checklist_templates" ("organization_id", "name", "type", "description")
        VALUES (${orgId}, 'Standard Employee Onboarding', 'onboarding', 'Essential tasks for welcoming new employees')
        RETURNING "id"
      `;

      if (onbRows[0]) {
        const onbId = onbRows[0].id;
        await tx`
          INSERT INTO "checklist_template_tasks" ("organization_id", "template_id", "title", "description", "assigned_role", "due_offset_days", "order_index")
          VALUES
            (${orgId}, ${onbId}, 'Upload signed employment contract', 'Sign and upload digital contract', 'employee', -3, 0),
            (${orgId}, ${onbId}, 'Prepare IT workstation and credentials', 'Configure laptop, email, and 2FA', 'admin', -2, 1),
            (${orgId}, ${onbId}, 'Team introduction and welcome coffee', 'Introduce to manager and direct teammates', 'manager', 0, 2),
            (${orgId}, ${onbId}, 'Review employee handbook and health & safety policy', 'Read and acknowledge handbook', 'employee', 3, 3)
        `;
      }
    });

    process.stdout.write("Dev database seeded successfully.\n");
  } finally {
    await sql.end();
  }
}

if (process.argv[1] && process.argv[1].endsWith("dev.ts")) {
  seedDevDatabase().catch((err) => {
    process.stderr.write(`Seed error: ${String(err)}\n`);
    process.exit(1);
  });
}
