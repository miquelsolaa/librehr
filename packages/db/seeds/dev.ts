import crypto from "node:crypto";
import postgres from "postgres";

export async function seedDevDatabase(connectionUrl?: string): Promise<void> {
  const url =
    connectionUrl ||
    process.env["DATABASE_MIGRATION_URL"] ||
    process.env["DATABASE_URL"] ||
    "postgres://librehr_owner:librehr_dev_password@localhost:5432/librehr";

  const sql = postgres(url, { max: 1 });

  try {
    process.stdout.write(
      "Seeding realistic dev organization, locations, employees, and records...\n",
    );

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

      // 3. Create Locations
      const locRows = await tx<{ id: string; name: string }[]>`
        INSERT INTO "locations" ("organization_id", "legal_entity_id", "name", "country", "region", "city", "timezone")
        VALUES 
          (${orgId}, ${entityId}, 'Barcelona Diagonal', 'ES', 'CT', 'Barcelona', 'Europe/Madrid'),
          (${orgId}, ${entityId}, 'Madrid Castellana', 'ES', 'MD', 'Madrid', 'Europe/Madrid')
        RETURNING "id", "name"
      `;
      const bcnLocId =
        locRows.find((l) => l.name.includes("Barcelona"))?.id ??
        locRows[0]?.id ??
        "";
      const madLocId =
        locRows.find((l) => l.name.includes("Madrid"))?.id ?? bcnLocId;

      // 4. Create Departments
      const deptRows = await tx<{ id: string; name: string }[]>`
        INSERT INTO "departments" ("organization_id", "name")
        VALUES 
          (${orgId}, 'Direcció Executiva'),
          (${orgId}, 'Engineering'),
          (${orgId}, 'Product & Design'),
          (${orgId}, 'People & Culture'),
          (${orgId}, 'Operations & Finance')
        RETURNING "id", "name"
      `;
      const execDeptId =
        deptRows.find((d) => d.name === "Direcció Executiva")?.id ?? "";
      const engDeptId =
        deptRows.find((d) => d.name === "Engineering")?.id ?? "";
      const prodDeptId =
        deptRows.find((d) => d.name === "Product & Design")?.id ?? "";
      const peopleDeptId =
        deptRows.find((d) => d.name === "People & Culture")?.id ?? "";
      const opsDeptId =
        deptRows.find((d) => d.name === "Operations & Finance")?.id ?? "";

      // 5. Define rich employees dataset (14 people forming a complete 3-tier hierarchy)
      interface SeedUser {
        email: string;
        name: string;
        role: "admin" | "manager" | "employee";
        jobTitle: string;
        deptId: string;
        locId: string;
        managerEmail: string | null;
        startDate: string;
        status: "active" | "on_leave";
        phone: string;
      }

      const usersList: SeedUser[] = [
        // Level 1: Leadership
        {
          email: "admin@librehr.local",
          name: "Marta Soler",
          role: "admin",
          jobTitle: "Chief Executive Officer",
          deptId: execDeptId,
          locId: bcnLocId,
          managerEmail: null,
          startDate: "2023-01-15",
          status: "active",
          phone: "+34 611 234 567",
        },
        // Level 2: Department Heads
        {
          email: "manager@librehr.local",
          name: "Pere Vila",
          role: "manager",
          jobTitle: "VP of Engineering",
          deptId: engDeptId,
          locId: bcnLocId,
          managerEmail: "admin@librehr.local",
          startDate: "2023-03-01",
          status: "active",
          phone: "+34 622 345 678",
        },
        {
          email: "hr@librehr.local",
          name: "Helena Bosch",
          role: "admin",
          jobTitle: "Head of People & Culture",
          deptId: peopleDeptId,
          locId: bcnLocId,
          managerEmail: "admin@librehr.local",
          startDate: "2023-04-15",
          status: "active",
          phone: "+34 633 456 789",
        },
        {
          email: "product@librehr.local",
          name: "Joan Castells",
          role: "manager",
          jobTitle: "Head of Product & Design",
          deptId: prodDeptId,
          locId: madLocId,
          managerEmail: "admin@librehr.local",
          startDate: "2023-06-01",
          status: "active",
          phone: "+34 644 567 890",
        },
        {
          email: "ops@librehr.local",
          name: "Carles Duran",
          role: "manager",
          jobTitle: "Head of Operations & Finance",
          deptId: opsDeptId,
          locId: madLocId,
          managerEmail: "admin@librehr.local",
          startDate: "2023-09-01",
          status: "active",
          phone: "+34 655 678 901",
        },
        // Level 3: Individual Contributors - Engineering
        {
          email: "employee@librehr.local",
          name: "Laia Puig",
          role: "employee",
          jobTitle: "Staff Frontend Engineer",
          deptId: engDeptId,
          locId: bcnLocId,
          managerEmail: "manager@librehr.local",
          startDate: "2024-01-10",
          status: "active",
          phone: "+34 666 789 012",
        },
        {
          email: "marc.font@librehr.local",
          name: "Marc Font",
          role: "employee",
          jobTitle: "Senior Backend Engineer",
          deptId: engDeptId,
          locId: bcnLocId,
          managerEmail: "manager@librehr.local",
          startDate: "2024-02-15",
          status: "active",
          phone: "+34 677 890 123",
        },
        {
          email: "nuria.riera@librehr.local",
          name: "Núria Riera",
          role: "employee",
          jobTitle: "DevOps & Platform Lead",
          deptId: engDeptId,
          locId: madLocId,
          managerEmail: "manager@librehr.local",
          startDate: "2024-03-01",
          status: "active",
          phone: "+34 688 901 234",
        },
        {
          email: "pau.casals@librehr.local",
          name: "Pau Casals",
          role: "employee",
          jobTitle: "Full-Stack Engineer",
          deptId: engDeptId,
          locId: bcnLocId,
          managerEmail: "manager@librehr.local",
          startDate: "2024-07-01",
          status: "active",
          phone: "+34 699 012 345",
        },
        // Level 3: People & Culture
        {
          email: "clara.valls@librehr.local",
          name: "Clara Valls",
          role: "employee",
          jobTitle: "People Operations Specialist",
          deptId: peopleDeptId,
          locId: bcnLocId,
          managerEmail: "hr@librehr.local",
          startDate: "2024-04-01",
          status: "active",
          phone: "+34 612 345 678",
        },
        {
          email: "oriol.mas@librehr.local",
          name: "Oriol Mas",
          role: "employee",
          jobTitle: "Talent Acquisition Specialist",
          deptId: peopleDeptId,
          locId: madLocId,
          managerEmail: "hr@librehr.local",
          startDate: "2024-08-15",
          status: "active",
          phone: "+34 623 456 789",
        },
        // Level 3: Product & Design
        {
          email: "silvia.ramos@librehr.local",
          name: "Silvia Ramos",
          role: "employee",
          jobTitle: "Senior Product Designer",
          deptId: prodDeptId,
          locId: bcnLocId,
          managerEmail: "product@librehr.local",
          startDate: "2024-05-01",
          status: "on_leave",
          phone: "+34 634 567 890",
        },
        {
          email: "david.moreno@librehr.local",
          name: "David Moreno",
          role: "employee",
          jobTitle: "UX Researcher",
          deptId: prodDeptId,
          locId: madLocId,
          managerEmail: "product@librehr.local",
          startDate: "2024-09-01",
          status: "active",
          phone: "+34 645 678 901",
        },
        // Level 3: Operations
        {
          email: "mireia.roca@librehr.local",
          name: "Mireia Roca",
          role: "employee",
          jobTitle: "Finance & Operations Specialist",
          deptId: opsDeptId,
          locId: bcnLocId,
          managerEmail: "ops@librehr.local",
          startDate: "2024-06-15",
          status: "active",
          phone: "+34 656 789 012",
        },
      ];

      // Insert users and create employee records map
      const empIdByEmail = new Map<string, string>();
      const userIdByEmail = new Map<string, string>();

      // First pass: create users & base employees (without managerId to allow arbitrary order)
      for (const u of usersList) {
        const userRows = await tx`
          INSERT INTO "users" ("email", "name", "password_hash", "email_verified")
          VALUES (${u.email}, ${u.name}, '$2a$10$devPasswordHash1234567890abcdefghijklmnopqrstuv', true)
          ON CONFLICT ("email") DO UPDATE SET "name" = EXCLUDED."name"
          RETURNING "id"
        `;
        const userId = userRows[0]?.["id"] as string;
        userIdByEmail.set(u.email, userId);

        await tx`
          INSERT INTO "memberships" ("organization_id", "user_id", "role")
          VALUES (${orgId}, ${userId}, ${u.role})
          ON CONFLICT ("organization_id", "user_id") DO UPDATE SET "role" = EXCLUDED."role"
        `;

        const nameParts = u.name.split(" ");
        const firstName = nameParts[0] ?? "User";
        const lastName = nameParts.slice(1).join(" ") || "";

        const empRows = await tx`
          INSERT INTO "employees" (
            "organization_id", "user_id", "department_id", "location_id",
            "first_name", "last_name", "email", "phone", "status"
          )
          VALUES (
            ${orgId}, ${userId}, ${u.deptId}, ${u.locId},
            ${firstName}, ${lastName}, ${u.email}, ${u.phone}, ${u.status}
          )
          RETURNING "id"
        `;
        const empId = empRows[0]?.["id"] as string;
        empIdByEmail.set(u.email, empId);

        await tx`
          INSERT INTO "employments" ("organization_id", "employee_id", "job_title", "employment_type", "start_date")
          VALUES (${orgId}, ${empId}, ${u.jobTitle}, 'indefinido', ${u.startDate})
        `;

        // Emergency contact
        await tx`
          INSERT INTO "emergency_contacts" ("organization_id", "employee_id", "full_name", "relationship", "phone_primary", "is_primary")
          VALUES (${orgId}, ${empId}, 'Contacte d''Urgència (${firstName})', 'partner', '+34 600 000 000', true)
        `;

        // Leave ledger accrual & carryover
        await tx`
          INSERT INTO "leave_ledger" ("organization_id", "employee_id", "entry_type", "amount", "unit", "effective_date", "note")
          VALUES 
            (${orgId}, ${empId}, 'accrual', 22.00, 'days', '2026-01-01', 'Annual vacation entitlement 2026'),
            (${orgId}, ${empId}, 'carryover', 3.00, 'days', '2026-01-01', 'Approved carryover from 2025')
        `;
      }

      // Second pass: set manager_id to establish the org chart hierarchy
      for (const u of usersList) {
        if (u.managerEmail) {
          const empId = empIdByEmail.get(u.email);
          const managerEmpId = empIdByEmail.get(u.managerEmail);
          if (empId && managerEmpId) {
            await tx`
              UPDATE "employees"
              SET "manager_id" = ${managerEmpId}
              WHERE "id" = ${empId}
            `;
          }
        }
      }

      // 6. Custom Fields & Employee values (ORG-005)
      const cfdRows = await tx<{ id: string; code: string }[]>`
        INSERT INTO "custom_field_definitions" ("organization_id", "name", "code", "field_type", "options", "required", "visibility")
        VALUES
          (${orgId}, 'T-Shirt Size', 't_shirt_size', 'select', '["XS", "S", "M", "L", "XL", "XXL"]', false, 'employee'),
          (${orgId}, 'Workstation Setup', 'workstation_setup', 'select', '["MacBook Pro 16", "MacBook Pro 14", "ThinkPad X1 Carbon", "Dual Monitor Setup"]', false, 'employee'),
          (${orgId}, 'LinkedIn Profile', 'linkedin_profile', 'text', null, false, 'public')
        RETURNING "id", "code"
      `;
      const tShirtDefId = cfdRows.find((c) => c.code === "t_shirt_size")?.id;
      const setupDefId = cfdRows.find(
        (c) => c.code === "workstation_setup",
      )?.id;

      for (const [, empId] of empIdByEmail.entries()) {
        if (tShirtDefId) {
          await tx`
            INSERT INTO "custom_field_values" ("organization_id", "field_definition_id", "employee_id", "value")
            VALUES (${orgId}, ${tShirtDefId}, ${empId}, 'M')
          `;
        }
        if (setupDefId) {
          await tx`
            INSERT INTO "custom_field_values" ("organization_id", "field_definition_id", "employee_id", "value")
            VALUES (${orgId}, ${setupDefId}, ${empId}, 'MacBook Pro 16')
          `;
        }
      }

      // 7. Seed Statutory Leave Types (Estatuto de los Trabajadores & RDL 5/2023)
      const ltRows = await tx<{ id: string; code: string }[]>`
        INSERT INTO "leave_types" (
          "organization_id", "name", "code", "is_paid", "requires_approval",
          "requires_attachment", "legal_reference", "description",
          "half_days_allowed", "counts_working_days", "color"
        )
        VALUES 
          (${orgId}, 'Vacaciones Anuales', 'vacation', true, true, false, 'ET art. 38', 'Período legal de descanso retribuido (mínimo 30 días naturales o 22 laborables).', true, true, '#3b82f6'),
          (${orgId}, 'Asuntos Propios', 'personal_days', true, true, false, 'Convenio colectivo', 'Días de libre disposición según convenio colectivo.', true, true, '#10b981'),
          (${orgId}, 'Baja Médica (IT)', 'sick_leave', true, false, true, 'LGSS art. 169 & ET art. 45.1.c', 'Incapacidad temporal con parte médico oficial (sin diagnóstico, GDPR art. 9).', false, false, '#f59e0b'),
          (${orgId}, 'Matrimonio o Pareja de Hecho', 'marriage', true, true, true, 'ET art. 37.3.a', '15 días naturales por matrimonio o constitución formal de pareja de hecho.', false, false, '#ec4899'),
          (${orgId}, 'Hospitalización o Enfermedad Grave Familiar', 'hospitalization_family', true, true, true, 'ET art. 37.3.b (RDL 5/2023)', '5 días laborables por accidente, enfermedad grave, hospitalización o reposo de familiar o conviviente.', true, true, '#8b5cf6'),
          (${orgId}, 'Fallecimiento de Familiar', 'bereavement', true, true, true, 'ET art. 37.3.b bis', '2 días por defunción de familiar hasta 2º grado (4 días si requiere desplazamiento).', false, false, '#64748b'),
          (${orgId}, 'Traslado de Domicilio Habitual', 'moving', true, true, true, 'ET art. 37.3.c', '1 día de permiso retribuido por mudanza.', false, false, '#06b6d4'),
          (${orgId}, 'Deber Inexcusable Público y Personal', 'public_duty', true, true, true, 'ET art. 37.3.d', 'Tiempo indispensable para el cumplimiento de un deber público y personal oficial.', true, true, '#6366f1'),
          (${orgId}, 'Exámenes Prenatales y Preparación al Parto', 'prenatal_exams', true, true, true, 'ET art. 37.3.f', 'Tiempo indispensable para exámenes médicos prenatales y preparación al parto o adopción.', true, true, '#14b8a6'),
          (${orgId}, 'Fuerza Mayor Familiar Urgente', 'family_force_majeure', true, true, true, 'ET art. 37.9 (RDL 5/2023)', 'Hasta 4 días al año retribuidos por urgencias familiares imprevisibles.', true, true, '#ef4444'),
          (${orgId}, 'Permiso Parental (hasta 8 años)', 'parental_leave_unpaid', false, true, true, 'ET art. 48 bis (RDL 5/2023)', 'Permiso no retribuido de hasta 8 semanas para el cuidado de hijo o hija hasta cumplir 8 años.', false, true, '#f97316'),
          (${orgId}, 'Nacimiento y Cuidado del Menor', 'birth_childcare', true, true, true, 'ET art. 48.4 & LGSS', 'Suspensión de 16 semanas retribuida por la Seguridad Social con reserva de puesto.', false, false, '#a855f7'),
          (${orgId}, 'Exámenes Oficiales y Formación', 'education_exams', true, true, true, 'ET art. 23.1.a', 'Permiso retribuido necesario para concurrir a exámenes académicos o profesionales oficiales.', true, true, '#0284c7')
        ON CONFLICT DO NOTHING
        RETURNING "id", "code"
      `;
      const vacTypeId = ltRows.find((t) => t.code === "vacation")?.id;
      const personalTypeId = ltRows.find((t) => t.code === "personal_days")?.id;

      if (vacTypeId) {
        await tx`
          INSERT INTO "leave_policies" (
            "organization_id", "leave_type_id", "name", "annual_allowance_days", "accrual_method", "carryover_max_days"
          ) VALUES (
            ${orgId}, ${vacTypeId}, 'Convenio General', 22.00, 'monthly', 5.00
          )
        `;
      }

      // 8. Seed Realistic Leave Requests
      const laiaEmpId = empIdByEmail.get("employee@librehr.local");
      const pereEmpId = empIdByEmail.get("manager@librehr.local");
      const pauEmpId = empIdByEmail.get("pau.casals@librehr.local");
      const silviaEmpId = empIdByEmail.get("silvia.ramos@librehr.local");

      if (vacTypeId && laiaEmpId && pereEmpId) {
        // Laia: past approved vacation
        await tx`
          INSERT INTO "leave_requests" (
            "organization_id", "employee_id", "leave_type_id", "start_date", "end_date",
            "working_days", "status", "notes", "approver_id", "decided_at"
          )
          VALUES (
            ${orgId}, ${laiaEmpId}, ${vacTypeId}, '2026-02-16', '2026-02-18',
            3.00, 'approved', 'Vacances d''hivern en família', ${pereEmpId}, '2026-02-02 10:00:00+01'
          )
        `;
        // Deduct from ledger
        await tx`
          INSERT INTO "leave_ledger" ("organization_id", "employee_id", "entry_type", "amount", "unit", "effective_date", "note")
          VALUES (${orgId}, ${laiaEmpId}, 'usage', -3.00, 'days', '2026-02-16', 'Vacances d''hivern en família')
        `;
      }

      if (personalTypeId && laiaEmpId) {
        // Laia: upcoming pending request
        await tx`
          INSERT INTO "leave_requests" (
            "organization_id", "employee_id", "leave_type_id", "start_date", "end_date",
            "working_days", "status", "notes"
          )
          VALUES (
            ${orgId}, ${laiaEmpId}, ${personalTypeId}, '2026-04-10', '2026-04-10',
            1.00, 'pending', 'Tràmits administratius i renovació DNI'
          )
        `;
      }

      if (vacTypeId && pauEmpId && pereEmpId) {
        await tx`
          INSERT INTO "leave_requests" (
            "organization_id", "employee_id", "leave_type_id", "start_date", "end_date",
            "working_days", "status", "notes"
          )
          VALUES (
            ${orgId}, ${pauEmpId}, ${vacTypeId}, '2026-07-20', '2026-07-31',
            10.00, 'pending', 'Vacances d''estiu'
          )
        `;
      }

      if (vacTypeId && silviaEmpId && pereEmpId) {
        await tx`
          INSERT INTO "leave_requests" (
            "organization_id", "employee_id", "leave_type_id", "start_date", "end_date",
            "working_days", "status", "notes", "approver_id", "decided_at"
          )
          VALUES (
            ${orgId}, ${silviaEmpId}, ${vacTypeId}, '2026-03-02', '2026-03-06',
            5.00, 'approved', 'Setmana de descans', ${pereEmpId}, '2026-02-20 12:00:00+01'
          )
        `;
      }

      // 9. Seed Time Events with valid Hash Chain (Real Decreto-ley 8/2019)
      if (laiaEmpId) {
        let prevHash = "0".repeat(64);
        const punches = [
          { type: "clock_in", time: "2026-11-02T08:31:00.000Z" },
          { type: "break_start", time: "2026-11-02T13:45:00.000Z" },
          { type: "break_end", time: "2026-11-02T14:40:00.000Z" },
        ];

        for (const p of punches) {
          const canonical = JSON.stringify({
            employeeId: laiaEmpId,
            eventType: p.type,
            occurredAt: p.time,
            prevHash,
          });
          const hash = crypto
            .createHash("sha256")
            .update(canonical)
            .digest("hex");

          await tx`
            INSERT INTO "time_events" (
              "organization_id", "employee_id", "event_type", "occurred_at", "recorded_at",
              "source", "actor_id", "prev_hash", "hash"
            )
            VALUES (
              ${orgId}, ${laiaEmpId}, ${p.type}, ${p.time}, ${p.time},
              'web', ${laiaEmpId}, ${prevHash}, ${hash}
            )
          `;
          prevHash = hash;
        }
      }

      // 10. Seed Notifications
      const martaUserId = userIdByEmail.get("admin@librehr.local");
      const laiaUserId = userIdByEmail.get("employee@librehr.local");

      if (martaUserId) {
        await tx`
          INSERT INTO "notifications" ("organization_id", "user_id", "title", "body", "category", "link", "read")
          VALUES
            (${orgId}, ${martaUserId}, 'Nova sol·licitud de vacances', 'Laia Puig ha sol·licitat 1 dia d''assumptes propis.', 'leave_request', '/ca/time-off', false),
            (${orgId}, ${martaUserId}, 'Informe mensual llest', 'L''exportació per a la gestoria de febrer 2026 ja està disponible.', 'system', '/ca/reports', false),
            (${orgId}, ${martaUserId}, 'Auditoria d''integritat completada', 'Verificació de cadena SHA-256 de jornada 100% íntegra.', 'system', '/ca/time', true)
        `;
      }

      if (laiaUserId) {
        await tx`
          INSERT INTO "notifications" ("organization_id", "user_id", "title", "body", "category", "link", "read")
          VALUES
            (${orgId}, ${laiaUserId}, 'Vacances aprovades', 'Pere Vila ha aprovat les teves vacances de febrer.', 'leave_decision', '/ca/time-off', true),
            (${orgId}, ${laiaUserId}, 'Nou document per revisar', 'S''ha publicat l''Acord de Teletreball 2026.', 'system', '/ca/documents', false)
        `;
      }

      // 11. Seed Documents (DOC-001)
      if (laiaEmpId) {
        await tx`
          INSERT INTO "documents" ("organization_id", "title", "category", "description", "audience_type", "created_by_id")
          VALUES
            (${orgId}, 'Manual del Treballador i Codi de Conducta 2026', 'company_policies', 'Guia general de convivència, beneficis i cultura.', 'company', ${laiaEmpId}),
            (${orgId}, 'Protocol de Desconnexió Digital i Teletreball', 'company_policies', 'Acord marc regulador del treball a distància.', 'company', ${laiaEmpId}),
            (${orgId}, 'Calendari Laboral Oficial Catalunya 2026', 'certificates', 'Publicat al DOGC amb festius autonòmics i locals.', 'company', ${laiaEmpId})
        `;
      }

      // 12. Seed Holiday Calendar 2026 for Locations
      for (const loc of locRows) {
        const calRows = await tx<{ id: string }[]>`
          INSERT INTO "holiday_calendars" ("organization_id", "location_id", "year")
          VALUES (${orgId}, ${loc.id}, 2026)
          ON CONFLICT DO NOTHING
          RETURNING "id"
        `;

        if (calRows[0]) {
          await tx`
            INSERT INTO "holidays" ("organization_id", "calendar_id", "date", "name", "scope")
            VALUES 
              (${orgId}, ${calRows[0].id}, '2026-01-01', 'Cap d''Any', 'national'),
              (${orgId}, ${calRows[0].id}, '2026-01-06', 'Reis', 'national'),
              (${orgId}, ${calRows[0].id}, '2026-04-03', 'Divendres Sant', 'national'),
              (${orgId}, ${calRows[0].id}, '2026-05-01', 'Festa del Treball', 'national'),
              (${orgId}, ${calRows[0].id}, '2026-06-24', 'Sant Joan', 'regional'),
              (${orgId}, ${calRows[0].id}, '2026-08-15', 'L''Assumpció', 'national'),
              (${orgId}, ${calRows[0].id}, '2026-09-11', 'Diada Nacional de Catalunya', 'regional'),
              (${orgId}, ${calRows[0].id}, '2026-10-12', 'Festa Nacional d''Espanya', 'national'),
              (${orgId}, ${calRows[0].id}, '2026-12-08', 'La Puríssima', 'national'),
              (${orgId}, ${calRows[0].id}, '2026-12-25', 'Nadal', 'national')
          `;
        }
      }

      // 13. Seed Default 40h Working Schedule & Rules
      const schedRows = await tx<{ id: string }[]>`
        INSERT INTO "schedules" ("organization_id", "name", "type", "weekly_hours", "minimum_daily_rest_hours", "is_default")
        VALUES (${orgId}, 'General 40h (Dilluns - Divendres)', 'fixed', 40.00, 12.0, true)
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

      // 14. Seed Standard Onboarding Checklist Template
      const onbRows = await tx<{ id: string }[]>`
        INSERT INTO "checklist_templates" ("organization_id", "name", "type", "description")
        VALUES (${orgId}, 'Acollida i Onboarding Estàndard', 'onboarding', 'Procés complet d''incorporació de nous companys')
        RETURNING "id"
      `;

      if (onbRows[0]) {
        const onbId = onbRows[0].id;
        await tx`
          INSERT INTO "checklist_template_tasks" ("organization_id", "template_id", "title", "description", "assigned_role", "due_offset_days", "order_index")
          VALUES
            (${orgId}, ${onbId}, 'Signatura digital del contracte laboral', 'Signar el contracte i annex de confidencialitat', 'employee', -3, 0),
            (${orgId}, ${onbId}, 'Preparació de l''ordinador portàtil i credencials', 'Configurar MacBook/ThinkPad, correu i 2FA', 'admin', -2, 1),
            (${orgId}, ${onbId}, 'Benvinguda amb l''equip i cafè inicial', 'Presentació als companys i assignació de buddy', 'manager', 0, 2),
            (${orgId}, ${onbId}, 'Revisió del Manual del Treballador i PRL', 'Llegir i signar recepció de polítiques', 'employee', 3, 3)
        `;
      }
    });

    process.stdout.write("Realistic dev database seeded successfully.\n");
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
