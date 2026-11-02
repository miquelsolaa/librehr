import { TENANT_TABLES } from "./helpers.js";

/**
 * Generates SQL statements to enable and force Row-Level Security
 * and apply tenant isolation policies to all tables with organization_id.
 */
export function generateRlsPoliciesSql(): string[] {
  const statements: string[] = [];

  for (const table of TENANT_TABLES) {
    statements.push(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY;`);
    statements.push(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY;`);

    // Drop existing policy if present for idempotency
    statements.push(
      `DROP POLICY IF EXISTS "${table}_tenant_isolation" ON "${table}";`,
    );

    // Create policy for all operations (SELECT, INSERT, UPDATE, DELETE)
    statements.push(
      `
      CREATE POLICY "${table}_tenant_isolation" ON "${table}"
      FOR ALL
      USING (
        organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid
      )
      WITH CHECK (
        organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid
      );
    `.trim(),
    );
  }

  return statements;
}

/**
 * SQL for append-only tables (REVOKE UPDATE and DELETE + trigger guard)
 */
export function generateAppendOnlySql(): string[] {
  const appendOnlyTables = ["time_events", "audit_log", "leave_ledger"];
  const statements: string[] = [
    `
    CREATE OR REPLACE FUNCTION librehr_prevent_modification()
    RETURNS TRIGGER AS $$
    BEGIN
      RAISE EXCEPTION 'Table % is append-only. UPDATE and DELETE operations are strictly prohibited.', TG_TABLE_NAME;
    END;
    $$ LANGUAGE plpgsql;
    `.trim(),
  ];

  for (const table of appendOnlyTables) {
    statements.push(`REVOKE UPDATE, DELETE ON "${table}" FROM librehr_app;`);
    statements.push(
      `DROP TRIGGER IF EXISTS "prevent_mod_${table}" ON "${table}";`,
    );
    statements.push(
      `
      CREATE TRIGGER "prevent_mod_${table}"
      BEFORE UPDATE OR DELETE ON "${table}"
      FOR EACH ROW EXECUTE FUNCTION librehr_prevent_modification();
    `.trim(),
    );
  }

  return statements;
}
