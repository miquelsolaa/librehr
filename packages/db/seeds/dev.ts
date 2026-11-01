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
      await tx`
        INSERT INTO "locations" ("organization_id", "legal_entity_id", "name", "country", "region", "city", "timezone")
        VALUES (${orgId}, ${entityId}, 'Barcelona Diagonal', 'ES', 'CT', 'Barcelona', 'Europe/Madrid')
      `;

      // 4. Create Users (Admin, Manager, Employee)
      // Password hash for 'Password123!' (dummy dev hash or scrypt)
      const usersData = [
        { email: "admin@openhr.local", name: "Marta Soler", role: "admin" },
        { email: "manager@openhr.local", name: "Pere Vila", role: "manager" },
        { email: "employee@openhr.local", name: "Laia Puig", role: "employee" },
      ];

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
        const empRows = await tx`
          INSERT INTO "employees" ("organization_id", "user_id", "first_name", "last_name", "email", "status")
          VALUES (${orgId}, ${userId}, ${firstName}, ${lastName}, ${u.email}, 'active')
          RETURNING "id"
        `;
        const empId = empRows[0]?.["id"] as string;

        // Employment
        await tx`
          INSERT INTO "employments" ("organization_id", "employee_id", "job_title", "employment_type", "start_date")
          VALUES (${orgId}, ${empId}, ${u.role === "admin" ? "People & Ops Lead" : u.role === "manager" ? "Team Lead" : "Specialist"}, 'indefinido', '2024-01-01')
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
